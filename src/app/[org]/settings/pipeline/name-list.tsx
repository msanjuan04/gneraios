"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Archive, ArrowDown, ArrowUp, Pencil, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/settings/confirm-dialog";
import { useValidationMessage } from "@/components/settings/form-field";
import { SettingsCard } from "@/components/settings/settings-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { archiveNameItem, moveNameItem, saveNameItem } from "./actions";
import type { Direction } from "./positions";
import { RowAction } from "./row-action";
import { type NameItem, type NameItemInput, nameItemSchema, type NameListKind } from "./schema";

/**
 * Tarjeta de una lista con nombre y orden (fuentes de adquisición o motivos de
 * pérdida). Añadir y renombrar se hace en la propia fila.
 */
export function NameListCard({
  slug,
  list,
  items,
  canEdit,
}: {
  slug: string;
  list: NameListKind;
  items: NameItem[];
  canEdit: boolean;
}) {
  const t = useTranslations("settings.pipeline");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  // Perder un deal exige motivo: el último no se archiva.
  const archiveBlocked = list === "reasons" && items.length <= 1 ? t("reasons.lastOne") : undefined;

  return (
    <SettingsCard
      title={t(`${list}.title`)}
      description={t(`${list}.description`)}
      actions={
        canEdit && !adding ? (
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
            <Plus data-icon="inline-start" />
            {t(`${list}.add`)}
          </Button>
        ) : undefined
      }
      bodyClassName="p-0"
    >
      {items.length === 0 && !adding ? (
        <p className="px-5 py-8 text-center text-muted-foreground">{t(`${list}.empty`)}</p>
      ) : (
        <ul className="divide-y">
          {items.map((item, index) => (
            <li key={item.id} className="flex min-h-11 items-center gap-3 px-5 py-1.5">
              {editingId === item.id ? (
                <NameForm slug={slug} list={list} item={item} onDone={() => setEditingId(null)} />
              ) : (
                <>
                  <span className="w-4 shrink-0 text-xs text-muted-foreground tabular">{index + 1}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{item.name}</span>
                  {canEdit && (
                    <NameItemActions
                      slug={slug}
                      list={list}
                      item={item}
                      isFirst={index === 0}
                      isLast={index === items.length - 1}
                      archiveBlocked={archiveBlocked}
                      onRename={() => setEditingId(item.id)}
                    />
                  )}
                </>
              )}
            </li>
          ))}
          {adding && (
            <li className="flex min-h-11 items-center px-5 py-1.5">
              <NameForm slug={slug} list={list} onDone={() => setAdding(false)} />
            </li>
          )}
        </ul>
      )}
    </SettingsCard>
  );
}

function NameItemActions({
  slug,
  list,
  item,
  isFirst,
  isLast,
  archiveBlocked,
  onRename,
}: {
  slug: string;
  list: NameListKind;
  item: NameItem;
  isFirst: boolean;
  isLast: boolean;
  archiveBlocked?: string;
  onRename: () => void;
}) {
  const t = useTranslations("settings.pipeline");
  const [archiving, setArchiving] = useState(false);
  const [pending, startTransition] = useTransition();

  const move = (direction: Direction) =>
    startTransition(async () => {
      const result = await moveNameItem(slug, list, item.id, direction);
      if (!result.ok) toast.error(result.error);
    });

  const archive = () =>
    startTransition(async () => {
      const result = await archiveNameItem(slug, list, item.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(t(`${list}.archivedToast`, { name: item.name }));
      setArchiving(false);
    });

  return (
    <div className="flex shrink-0 justify-end gap-0.5">
      <RowAction label={t("moveUp")} onClick={() => move("up")} disabled={pending || isFirst}>
        <ArrowUp />
      </RowAction>
      <RowAction label={t("moveDown")} onClick={() => move("down")} disabled={pending || isLast}>
        <ArrowDown />
      </RowAction>
      <RowAction label={t("rename")} onClick={onRename} disabled={pending}>
        <Pencil />
      </RowAction>
      <RowAction
        label={t("archive")}
        onClick={() => setArchiving(true)}
        disabled={pending || archiveBlocked !== undefined}
        reason={archiveBlocked}
      >
        <Archive />
      </RowAction>
      <ConfirmDialog
        open={archiving}
        onOpenChange={setArchiving}
        title={t(`${list}.archiveTitle`, { name: item.name })}
        description={t(`${list}.archiveBody`)}
        confirmLabel={t("archive")}
        onConfirm={archive}
        pending={pending}
      />
    </div>
  );
}

/**
 * Nombre en la propia fila: Intro guarda y Escape cancela. Al añadir, el campo se
 * vacía y sigue abierto para escribir el siguiente.
 */
function NameForm({
  slug,
  list,
  item,
  onDone,
}: {
  slug: string;
  list: NameListKind;
  item?: NameItem;
  onDone: () => void;
}) {
  const t = useTranslations("settings.pipeline");
  const tCommon = useTranslations("common");
  const message = useValidationMessage();
  const form = useForm<NameItemInput>({
    resolver: zodResolver(nameItemSchema),
    defaultValues: { name: item?.name ?? "" },
  });
  const { register, formState, getValues, reset, setFocus } = form;
  const { errors, isSubmitting } = formState;
  const errorId = `${list}-${item?.id ?? "new"}-error`;

  const submit = form.handleSubmit(async () => {
    const name = getValues("name").trim();
    if (item && name === item.name) {
      onDone();
      return;
    }
    const result = await saveNameItem(slug, list, item?.id ?? null, { name });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    if (item) {
      toast.success(t(`${list}.renamedToast`));
      onDone();
      return;
    }
    toast.success(t(`${list}.createdToast`, { name }));
    reset({ name: "" });
    setFocus("name");
  });

  return (
    <form onSubmit={submit} noValidate className="flex w-full flex-wrap items-start gap-2 sm:flex-nowrap">
      <div className="min-w-0 flex-1 basis-full sm:basis-auto">
        <Input
          autoFocus
          autoComplete="off"
          aria-label={t("name")}
          placeholder={t(`${list}.placeholder`)}
          aria-invalid={Boolean(errors.name)}
          aria-describedby={errors.name ? errorId : undefined}
          {...register("name")}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onDone();
            }
          }}
        />
        {errors.name && (
          <p id={errorId} className="mt-1 text-xs text-destructive">
            {message(errors.name.message)}
          </p>
        )}
      </div>
      <Button type="submit" size="sm" className="h-8" disabled={isSubmitting}>
        {isSubmitting ? tCommon("saving") : item ? tCommon("save") : tCommon("add")}
      </Button>
      <Button type="button" variant="ghost" size="sm" className="h-8" onClick={onDone} disabled={isSubmitting}>
        {tCommon("cancel")}
      </Button>
    </form>
  );
}
