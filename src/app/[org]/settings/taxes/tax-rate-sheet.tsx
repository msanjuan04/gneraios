"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Archive, Pencil, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/settings/confirm-dialog";
import { FormField, ToggleField, useValidationMessage } from "@/components/settings/form-field";
import { SettingsSheet, SheetForm } from "@/components/settings/settings-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SPAIN_TAX_DEFAULTS } from "@/domain/tax/spain-defaults";
import { archiveTaxRate, saveTaxRate } from "./actions";
import {
  type TaxRateFormInput,
  taxRateFormDefaults,
  taxRateFormSchema,
  type TaxRateFormValues,
  type TaxRateRow,
  VAT_REGIMES,
} from "./schema";

/** "Añadir tipo": panel lateral con el formulario vacío. */
export function AddTaxRateButton({ slug }: { slug: string }) {
  const t = useTranslations("settings.taxes");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus data-icon="inline-start" />
        {t("add")}
      </Button>
      <SettingsSheet open={open} onOpenChange={setOpen} title={t("addTitle")} description={t("formDescription")}>
        <TaxRateForm slug={slug} defaults={taxRateFormDefaults()} onDone={() => setOpen(false)} />
      </SettingsSheet>
    </>
  );
}

/** Acciones de una fila: editar en panel lateral y archivar con confirmación. */
export function TaxRateRowActions({ slug, rate }: { slug: string; rate: TaxRateRow }) {
  const t = useTranslations("settings.taxes");
  const tCommon = useTranslations("common");
  const [editing, setEditing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [pending, startTransition] = useTransition();

  const archive = () =>
    startTransition(async () => {
      const result = await archiveTaxRate(slug, rate.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(t("archivedToast", { name: rate.name }));
      setArchiving(false);
    });

  return (
    <div className="flex justify-end gap-0.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={tCommon("edit")} onClick={() => setEditing(true)}>
            <Pencil />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{tCommon("edit")}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={t("archive")} onClick={() => setArchiving(true)}>
            <Archive />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("archive")}</TooltipContent>
      </Tooltip>

      <SettingsSheet open={editing} onOpenChange={setEditing} title={t("edit")} description={t("formDescription")}>
        <TaxRateForm slug={slug} taxRateId={rate.id} defaults={taxRateFormDefaults(rate)} onDone={() => setEditing(false)} />
      </SettingsSheet>
      <ConfirmDialog
        open={archiving}
        onOpenChange={setArchiving}
        title={t("archiveTitle", { name: rate.name })}
        description={t("archiveBody")}
        confirmLabel={t("archive")}
        onConfirm={archive}
        pending={pending}
      />
    </div>
  );
}

function TaxRateForm({
  slug,
  taxRateId,
  defaults,
  onDone,
}: {
  slug: string;
  taxRateId?: string;
  defaults: TaxRateFormInput;
  onDone: () => void;
}) {
  const t = useTranslations("settings.taxes");
  const tRegime = useTranslations("vatRegime");
  const tCommon = useTranslations("common");
  const message = useValidationMessage();
  const form = useForm<TaxRateFormInput, unknown, TaxRateFormValues>({
    resolver: zodResolver(taxRateFormSchema),
    defaultValues: defaults,
    mode: "onTouched",
  });
  const { control, register, setValue, getValues, formState } = form;
  const { errors, isSubmitting } = formState;
  const kind = useWatch({ control, name: "kind" });

  const submit = form.handleSubmit(async () => {
    const result = await saveTaxRate(slug, taxRateId ?? null, getValues());
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(t("savedToast"));
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
        <Controller
          control={control}
          name="kind"
          render={({ field }) => (
            <FormField id="tax-kind" label={t("kind")}>
              <Select
                value={field.value}
                onValueChange={(value) => {
                  const next = value === "irpf" ? "irpf" : "vat";
                  field.onChange(next);
                  // El régimen solo existe para el IVA.
                  setValue("regime", next === "vat" ? "general" : null, { shouldValidate: formState.isSubmitted });
                }}
              >
                <SelectTrigger id="tax-kind" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="vat">{t("vat")}</SelectItem>
                  <SelectItem value="irpf">{t("irpf")}</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
          )}
        />
        <FormField id="tax-rate" label={t("rate")} description={t("rateHint")} error={message(errors.rate_bps?.message)}>
          <div className="relative">
            <Input
              id="tax-rate"
              inputMode="decimal"
              placeholder="21"
              className="pr-8 tabular"
              aria-invalid={Boolean(errors.rate_bps)}
              {...register("rate_bps")}
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
              %
            </span>
          </div>
        </FormField>
        <FormField id="tax-name" label={t("name")} className="sm:col-span-2" error={message(errors.name?.message)}>
          <Input
            id="tax-name"
            placeholder={kind === "vat" ? t("namePlaceholderVat") : t("namePlaceholderIrpf")}
            aria-invalid={Boolean(errors.name)}
            {...register("name")}
          />
        </FormField>

        {kind === "vat" && (
          <Controller
            control={control}
            name="regime"
            render={({ field }) => (
              <FormField
                id="tax-regime"
                label={t("regime")}
                description={t("regimeHint")}
                error={message(errors.regime?.message)}
                className="sm:col-span-2"
              >
                <Select
                  value={field.value ?? undefined}
                  onValueChange={(value) => {
                    const regime = VAT_REGIMES.find((r) => r === value) ?? "general";
                    field.onChange(regime);
                    // Propone la mención legal habitual si aún no hay ninguna.
                    const note = SPAIN_TAX_DEFAULTS.find((d) => d.regime === regime)?.legal_note;
                    if (note && !getValues("legal_note").trim()) setValue("legal_note", note);
                  }}
                >
                  <SelectTrigger id="tax-regime" className="w-full" aria-invalid={Boolean(errors.regime)}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VAT_REGIMES.map((r) => (
                      <SelectItem key={r} value={r}>
                        {tRegime(r)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            )}
          />
        )}

        <FormField
          id="tax-note"
          label={t("legalNote")}
          optional
          description={t("legalNoteHint")}
          error={message(errors.legal_note?.message)}
          className="sm:col-span-2"
        >
          <Textarea id="tax-note" rows={2} aria-invalid={Boolean(errors.legal_note)} {...register("legal_note")} />
        </FormField>

        <Controller
          control={control}
          name="is_default"
          render={({ field }) => (
            <ToggleField
              id="tax-default"
              control="checkbox"
              label={t("default")}
              description={t("defaultHint")}
              checked={field.value}
              onCheckedChange={field.onChange}
              className="sm:col-span-2"
            />
          )}
        />
      </div>
    </SheetForm>
  );
}
