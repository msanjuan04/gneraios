"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { FormField, useValidationMessage } from "@/components/settings/form-field";
import { SettingsSheet, SheetForm } from "@/components/settings/settings-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatHasYear } from "@/domain/dataio/invoice-number";
import { formatInvoiceNumber, isValidSeriesFormat } from "@/domain/invoicing/number-format";
import { seriesCodeFromFormat } from "@/domain/invoicing/series-code";
import { createSeries } from "./actions";
import { type SeriesFormInput, seriesFormSchema } from "./schema";

/**
 * «Nueva serie» de un emisor: para las facturas que se numeraban de otra forma (un histórico
 * «2026-BRK-001», una serie antigua) o para separar las rectificativas. La serie por defecto
 * no cambia: sigue numerando lo que se emite desde GNERAI OS.
 */
export function NewSeriesButton({ slug, issuerId, takenCodes, year }: { slug: string; issuerId: string; takenCodes: string[]; year: number }) {
  const t = useTranslations("settings.issuers");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="xs" onClick={() => setOpen(true)}>
        <Plus data-icon="inline-start" />
        {t("newSeries")}
      </Button>
      <SettingsSheet open={open} onOpenChange={setOpen} title={t("newSeriesTitle")} description={t("newSeriesDescription")}>
        <NewSeriesForm slug={slug} issuerId={issuerId} takenCodes={takenCodes} year={year} onDone={() => setOpen(false)} />
      </SettingsSheet>
    </>
  );
}

function NewSeriesForm({
  slug,
  issuerId,
  takenCodes,
  year,
  onDone,
}: {
  slug: string;
  issuerId: string;
  takenCodes: string[];
  year: number;
  onDone: () => void;
}) {
  const t = useTranslations("settings.issuers");
  const tKind = useTranslations("seriesKind");
  const tCommon = useTranslations("common");
  const message = useValidationMessage();
  const form = useForm<SeriesFormInput>({
    resolver: zodResolver(seriesFormSchema),
    defaultValues: { issuer_id: issuerId, code: "", name: "", kind: "ordinary", format: "" },
    mode: "onTouched",
  });
  const { control, register, formState } = form;
  const { errors, isSubmitting } = formState;
  const format = (useWatch({ control, name: "format" }) ?? "").trim();
  const valid = format !== "" && isValidSeriesFormat(format, formatHasYear(format));
  const example = valid ? `${formatInvoiceNumber(format, year, 1)}, ${formatInvoiceNumber(format, year, 2)}…` : null;
  const suggestedCode = valid ? seriesCodeFromFormat(format, takenCodes) : "";

  const submit = form.handleSubmit(async (values) => {
    const result = await createSeries(slug, values);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(t("seriesCreated", { code: result.series.code }));
    onDone();
  });

  return (
    <SheetForm
      onSubmit={submit}
      footer={
        <>
          <Button type="button" variant="ghost" size="sm" onClick={onDone} disabled={isSubmitting}>
            {tCommon("cancel")}
          </Button>
          <Button type="submit" size="sm" disabled={isSubmitting}>
            {isSubmitting ? tCommon("saving") : t("newSeriesSave")}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <FormField
          id="series-format"
          label={t("seriesFormat")}
          error={message(errors.format?.message)}
          description={example ? t("seriesExample", { example }) : t("seriesFormatHint")}
        >
          <Input id="series-format" {...register("format")} placeholder="{yyyy}-BRK-{n:3}" autoFocus autoComplete="off" className="font-mono" aria-invalid={Boolean(errors.format)} />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="series-code" label={t("seriesCode")} optional error={message(errors.code?.message)} description={t("seriesCodeHint")}>
            <Input id="series-code" {...register("code")} placeholder={suggestedCode || "BRK"} maxLength={12} autoComplete="off" className="font-mono uppercase" />
          </FormField>
          <Controller
            control={control}
            name="kind"
            render={({ field }) => (
              <FormField id="series-kind" label={t("seriesKind")}>
                <Select value={field.value} onValueChange={(v) => field.onChange(v === "rectifying" ? "rectifying" : "ordinary")}>
                  <SelectTrigger id="series-kind" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ordinary">{tKind("ordinary")}</SelectItem>
                    <SelectItem value="rectifying">{tKind("rectifying")}</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
            )}
          />
        </div>
        <FormField id="series-name" label={t("seriesName")} optional error={message(errors.name?.message)}>
          <Input id="series-name" {...register("name")} placeholder={t("seriesImportedName", { code: suggestedCode || "BRK" })} maxLength={80} autoComplete="off" />
        </FormField>
        <p className="text-xs text-muted-foreground">{t("newSeriesFootnote")}</p>
      </div>
    </SheetForm>
  );
}
