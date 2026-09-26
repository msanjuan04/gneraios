"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Archive, ArrowDown, ArrowUp, Pencil, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/settings/confirm-dialog";
import { FormField, useValidationMessage } from "@/components/settings/form-field";
import { SettingsSheet, SheetForm } from "@/components/settings/settings-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { archiveStage, moveStage, saveStage } from "./actions";
import type { Direction } from "./positions";
import { RowAction } from "./row-action";
import {
  STAGE_KINDS,
  type StageFormInput,
  stageFormDefaults,
  stageFormSchema,
  type StageFormValues,
  type StageItem,
} from "./schema";

/** "Añadir etapa": panel lateral con el formulario vacío. La etapa nace abierta. */
export function AddStageButton({ slug }: { slug: string }) {
  const t = useTranslations("settings.pipeline.stages");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus data-icon="inline-start" />
        {t("add")}
      </Button>
      <SettingsSheet open={open} onOpenChange={setOpen} title={t("addTitle")} description={t("addDescription")}>
        <StageForm slug={slug} onDone={() => setOpen(false)} />
      </SettingsSheet>
    </>
  );
}

/**
 * Acciones de una etapa: subir, bajar, editar en panel lateral y archivar con
 * confirmación. Lo que no se permite queda deshabilitado con el motivo en el tooltip.
 */
export function StageRowActions({
  slug,
  stage,
  isFirst,
  isLast,
}: {
  slug: string;
  stage: StageItem;
  isFirst: boolean;
  isLast: boolean;
}) {
  const t = useTranslations("settings.pipeline");
  const tCommon = useTranslations("common");
  const [editing, setEditing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [pending, startTransition] = useTransition();

  const move = (direction: Direction) =>
    startTransition(async () => {
      const result = await moveStage(slug, stage.id, direction);
      if (!result.ok) toast.error(result.error);
    });

  const archive = () =>
    startTransition(async () => {
      const result = await archiveStage(slug, stage.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(t("stages.archivedToast", { name: stage.name }));
      setArchiving(false);
    });

  // Primero la regla que no se arregla moviendo deals.
  const archiveBlocked = stage.onlyOfKind
    ? t(`stages.onlyOfKind.${stage.kind}`)
    : stage.activeDeals > 0
      ? t("stages.archiveHasDeals", { count: stage.activeDeals })
      : undefined;

  return (
    <div className="flex justify-end gap-0.5">
      <RowAction label={t("moveUp")} onClick={() => move("up")} disabled={pending || isFirst}>
        <ArrowUp />
      </RowAction>
      <RowAction label={t("moveDown")} onClick={() => move("down")} disabled={pending || isLast}>
        <ArrowDown />
      </RowAction>
      <RowAction label={tCommon("edit")} onClick={() => setEditing(true)} disabled={pending}>
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

      <SettingsSheet
        open={editing}
        onOpenChange={setEditing}
        title={t("stages.edit")}
        description={t("stages.editDescription")}
      >
        <StageForm slug={slug} stage={stage} onDone={() => setEditing(false)} />
      </SettingsSheet>
      <ConfirmDialog
        open={archiving}
        onOpenChange={setArchiving}
        title={t("stages.archiveTitle", { name: stage.name })}
        description={t("stages.archiveBody")}
        confirmLabel={t("archive")}
        onConfirm={archive}
        pending={pending}
      />
    </div>
  );
}

/** Nombre, tipo y probabilidad por defecto. Sin `stage`, crea una etapa nueva. */
function StageForm({ slug, stage, onDone }: { slug: string; stage?: StageItem; onDone: () => void }) {
  const t = useTranslations("settings.pipeline");
  const tKind = useTranslations("crm.stageKind");
  const tCommon = useTranslations("common");
  const message = useValidationMessage();
  const form = useForm<StageFormInput, unknown, StageFormValues>({
    resolver: zodResolver(stageFormSchema),
    defaultValues: stageFormDefaults(stage),
    mode: "onTouched",
  });
  const { control, register, setValue, getValues, formState } = form;
  const { errors, isSubmitting } = formState;

  // El tipo da sentido a los deals de la etapa: solo cambia si no tiene ninguno y no es la última de su tipo.
  const kindLocked = !stage
    ? undefined
    : stage.totalDeals > 0
      ? t("stages.kindLocked")
      : stage.onlyOfKind
        ? t(`stages.onlyOfKind.${stage.kind}`)
        : undefined;

  const submit = form.handleSubmit(async () => {
    const values = getValues();
    const result = await saveStage(slug, stage?.id ?? null, values);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(stage ? t("stages.savedToast") : t("stages.createdToast", { name: values.name.trim() }));
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
            {isSubmitting ? tCommon("saving") : tCommon("save")}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="stage-name" label={t("name")} className="sm:col-span-2" error={message(errors.name?.message)}>
          <Input
            id="stage-name"
            autoFocus
            autoComplete="off"
            placeholder={t("stages.namePlaceholder")}
            aria-invalid={Boolean(errors.name)}
            {...register("name")}
          />
        </FormField>

        <Controller
          control={control}
          name="kind"
          render={({ field }) => (
            <FormField
              id="stage-kind"
              label={t("stages.kind")}
              description={kindLocked ?? t(`stages.kindHints.${field.value}`)}
              disabled={kindLocked !== undefined}
            >
              <Select
                value={field.value}
                disabled={kindLocked !== undefined}
                onValueChange={(value) => {
                  const next = STAGE_KINDS.find((kind) => kind === value) ?? "open";
                  field.onChange(next);
                  // Lo habitual: una etapa ganada al 100 % y una perdida al 0 %.
                  if (next !== "open") {
                    setValue("probability", next === "won" ? "100" : "0", {
                      shouldDirty: true,
                      shouldValidate: formState.isSubmitted,
                    });
                  }
                }}
              >
                <SelectTrigger id="stage-kind" className="w-full">
                  <SelectValue>{tKind(field.value)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {STAGE_KINDS.map((kind) => (
                    <SelectItem key={kind} value={kind} className="items-start py-1.5">
                      <span className="flex flex-col gap-0.5">
                        <span className="font-medium">{tKind(kind)}</span>
                        <span className="text-xs whitespace-normal text-muted-foreground">
                          {t(`stages.kindHints.${kind}`)}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          )}
        />

        <FormField
          id="stage-probability"
          label={t("stages.probabilityLabel")}
          description={t("stages.probabilityHint")}
          error={message(errors.probability?.message)}
        >
          <div className="relative">
            <Input
              id="stage-probability"
              inputMode="decimal"
              autoComplete="off"
              placeholder="50"
              className="pr-8 tabular"
              aria-invalid={Boolean(errors.probability)}
              {...register("probability")}
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
              %
            </span>
          </div>
        </FormField>
      </div>
    </SheetForm>
  );
}
