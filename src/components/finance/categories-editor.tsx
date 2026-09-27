"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, Pencil, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { archiveCategory, moveCategory, restoreCategory, saveCategory } from "@/app/[org]/settings/expenses/actions";
import { type CategoryFormInput, categoryFormSchema } from "@/app/[org]/settings/expenses/schema";
import { RowAction } from "@/app/[org]/settings/pipeline/row-action";
import { ConfirmDialog } from "@/components/settings/confirm-dialog";
import { FormField, ToggleField } from "@/components/settings/form-field";
import { SettingsCard } from "@/components/settings/settings-card";
import { SettingsSheet, SheetForm } from "@/components/settings/settings-sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EXPENSE_GROUPS } from "@/domain/finance";
import { useFinanceValidationMessage } from "./format";
import type { CategoryOption } from "./types";

export type CategoryRow = CategoryOption & { expenses: number };

/**
 * Categorías de gasto de la org: su grupo (operativo, nóminas, retribución de socios, coste de
 * lo vendido, impuestos, financiero u otros) y si son un coste fijo, que es lo que cubre el
 * runway. Las edita un owner; archivar no toca los gastos que ya la tienen.
 */
export function CategoriesEditor({ slug, categories, canEdit }: { slug: string; categories: CategoryRow[]; canEdit: boolean }) {
  const t = useTranslations("finance.settings");
  const tGroup = useTranslations("finance.groups");
  const [editing, setEditing] = useState<CategoryRow | null | "new">(null);
  const [archiving, setArchiving] = useState<CategoryRow | null>(null);
  const [pending, startTransition] = useTransition();
  const active = categories.filter((c) => !c.archived);
  const archived = categories.filter((c) => c.archived);

  const run = (action: () => Promise<{ ok: boolean; error?: string }>, success?: string) =>
    startTransition(async () => {
      const result = await action();
      if (!result.ok) toast.error(result.error ?? "");
      else if (success) toast.success(success);
    });

  return (
    <div className="space-y-6">
      <SettingsCard
        title={t("title")}
        description={t("description")}
        actions={
          canEdit ? (
            <Button variant="outline" size="sm" onClick={() => setEditing("new")}>
              <Plus data-icon="inline-start" />
              {t("add")}
            </Button>
          ) : undefined
        }
        bodyClassName="p-0"
      >
        {active.length === 0 ? (
          <p className="px-5 py-8 text-center text-muted-foreground">{t("empty")}</p>
        ) : (
          <ul className="divide-y">
            {active.map((category, index) => (
              <li key={category.id} className="flex min-h-12 items-center gap-3 px-5 py-2">
                <span className="w-5 shrink-0 text-xs text-muted-foreground tabular">{index + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{category.name}</span>
                  <span className="block text-xs text-muted-foreground">{t("expensesCount", { count: category.expenses })}</span>
                </span>
                <Badge variant="outline" className="hidden text-muted-foreground sm:inline-flex">
                  {tGroup(category.expenseGroup)}
                </Badge>
                {category.isFixed && <Badge className="bg-primary/10 text-primary">{t("fixed")}</Badge>}
                {canEdit && (
                  <div className="flex shrink-0 gap-0.5">
                    <RowAction label={t("moveUp")} onClick={() => run(() => moveCategory(slug, category.id, "up"))} disabled={pending || index === 0}>
                      <ArrowUp />
                    </RowAction>
                    <RowAction
                      label={t("moveDown")}
                      onClick={() => run(() => moveCategory(slug, category.id, "down"))}
                      disabled={pending || index === active.length - 1}
                    >
                      <ArrowDown />
                    </RowAction>
                    <RowAction label={t("edit")} onClick={() => setEditing(category)} disabled={pending}>
                      <Pencil />
                    </RowAction>
                    <RowAction
                      label={t("archive")}
                      onClick={() => setArchiving(category)}
                      disabled={pending || active.length <= 1}
                      reason={active.length <= 1 ? t("lastOne") : undefined}
                    >
                      <Archive />
                    </RowAction>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </SettingsCard>

      {archived.length > 0 && (
        <SettingsCard title={t("archivedTitle")} description={t("archivedDescription")} bodyClassName="p-0">
          <ul className="divide-y">
            {archived.map((category) => (
              <li key={category.id} className="flex min-h-11 items-center gap-3 px-5 py-1.5 text-muted-foreground">
                <span className="min-w-0 flex-1 truncate">{category.name}</span>
                <span className="text-xs">{t("expensesCount", { count: category.expenses })}</span>
                {canEdit && (
                  <RowAction label={t("restore")} onClick={() => run(() => restoreCategory(slug, category.id), t("restoredToast", { name: category.name }))} disabled={pending}>
                    <ArchiveRestore />
                  </RowAction>
                )}
              </li>
            ))}
          </ul>
        </SettingsCard>
      )}

      <SettingsCard title={t("groupsTitle")} description={t("groupsDescription")}>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          {EXPENSE_GROUPS.map((group) => (
            <div key={group}>
              <dt className="font-semibold">{tGroup(group)}</dt>
              <dd className="mt-0.5 text-xs text-muted-foreground">{t(`groupHints.${group}`)}</dd>
            </div>
          ))}
        </dl>
      </SettingsCard>

      <ConfirmDialog
        open={archiving !== null}
        onOpenChange={(open) => !open && setArchiving(null)}
        title={t("archiveTitle", { name: archiving?.name ?? "" })}
        description={t("archiveBody")}
        confirmLabel={t("archive")}
        pending={pending}
        onConfirm={() => {
          const category = archiving;
          if (!category) return;
          startTransition(async () => {
            const result = await archiveCategory(slug, category.id);
            if (!result.ok) toast.error(result.error);
            else toast.success(t("archivedToast", { name: category.name }));
            setArchiving(null);
          });
        }}
      />

      <SettingsSheet
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title={editing === "new" ? t("addTitle") : t("editTitle")}
        description={t("formDescription")}
      >
        {editing !== null && <CategoryForm slug={slug} category={editing === "new" ? null : editing} onDone={() => setEditing(null)} />}
      </SettingsSheet>
    </div>
  );
}

function CategoryForm({ slug, category, onDone }: { slug: string; category: CategoryRow | null; onDone: () => void }) {
  const t = useTranslations("finance.settings");
  const tGroup = useTranslations("finance.groups");
  const tCommon = useTranslations("common");
  const message = useFinanceValidationMessage();
  const form = useForm<CategoryFormInput>({
    resolver: zodResolver(categoryFormSchema),
    defaultValues: { name: category?.name ?? "", expense_group: category?.expenseGroup ?? "operating", is_fixed: category?.isFixed ?? false },
    mode: "onTouched",
  });
  const { control, register, getValues, formState } = form;
  const { errors, isSubmitting } = formState;
  const submit = form.handleSubmit(async () => {
    const result = await saveCategory(slug, category?.id ?? null, getValues());
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(category ? t("savedToast") : t("createdToast", { name: getValues("name").trim() }));
    onDone();
  });
  return (
    <SheetForm
      onSubmit={submit}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onDone} disabled={isSubmitting}>
            {tCommon("cancel")}
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? tCommon("saving") : category ? tCommon("save") : tCommon("create")}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <FormField id="category-name" label={t("name")} error={message(errors.name?.message)}>
          <Input id="category-name" {...register("name")} autoFocus placeholder={t("namePlaceholder")} aria-invalid={Boolean(errors.name)} />
        </FormField>
        <Controller
          control={control}
          name="expense_group"
          render={({ field }) => (
            <FormField id="category-group" label={t("group")} description={t(`groupHints.${field.value}`)}>
              <Select value={field.value} onValueChange={(v) => field.onChange(EXPENSE_GROUPS.find((g) => g === v) ?? "operating")}>
                <SelectTrigger id="category-group" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPENSE_GROUPS.map((g) => (
                    <SelectItem key={g} value={g}>
                      {tGroup(g)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          )}
        />
        <Controller
          control={control}
          name="is_fixed"
          render={({ field }) => (
            <ToggleField id="category-fixed" label={t("isFixed")} description={t("isFixedHint")} checked={field.value} onCheckedChange={field.onChange} />
          )}
        />
      </div>
    </SheetForm>
  );
}
