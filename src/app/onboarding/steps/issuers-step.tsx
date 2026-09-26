"use client";

import { Building2, Plus, ShieldCheck, Trash2, UserRound } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Controller, useFieldArray, useFormContext, useWatch } from "react-hook-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { formatInvoiceNumber, isValidSeriesFormat } from "@/domain/invoicing/number-format";
import { VERIFACTU_FROM } from "@/domain/tax/spain-defaults";
import type { OnboardingInput } from "@/lib/validation/onboarding";
import { selfEmployedIssuerDefaults } from "../defaults";
import { StepHeading, TextField, useFieldError } from "../form-fields";

export function IssuersStep({ currentYear }: { currentYear: number }) {
  const t = useTranslations("onboarding.issuers");
  const tValidation = useTranslations("validation");
  const { control, formState } = useFormContext<OnboardingInput>();
  const { fields, append, remove } = useFieldArray({ control, name: "issuers" });
  const arrayError = formState.errors.issuers?.root?.message ?? formState.errors.issuers?.message;

  return (
    <div>
      <StepHeading title={t("title")} description={t("description")} />
      {arrayError && <p className="mb-4 text-sm text-destructive">{tValidation(arrayError)}</p>}

      <div className="space-y-4">
        {fields.map((field, index) =>
          field.kind === "company" ? (
            <IssuerCard key={field.id} index={index} currentYear={currentYear} />
          ) : null,
        )}

        <div className="pt-4">
          <h3 className="flex items-center gap-2 text-sm font-bold">
            <UserRound className="size-4 text-muted-foreground" />
            {t("selfEmployed")}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">{t("selfEmployedHint")}</p>
        </div>

        {fields.map((field, index) =>
          field.kind === "self_employed" ? (
            <IssuerCard key={field.id} index={index} currentYear={currentYear} onRemove={() => remove(index)} />
          ) : null,
        )}

        <Button type="button" variant="outline" onClick={() => append(selfEmployedIssuerDefaults(false))}>
          <Plus data-icon="inline-start" />
          {t("addSelfEmployed")}
        </Button>
      </div>
    </div>
  );
}

function IssuerCard({ index, currentYear, onRemove }: { index: number; currentYear: number; onRemove?: () => void }) {
  const t = useTranslations("onboarding.issuers");
  const tKind = useTranslations("issuerKind");
  const tCommon = useTranslations("common");
  const format = useFormatter();
  const { control, setValue, getValues } = useFormContext<OnboardingInput>();
  const kind = useWatch({ control, name: `issuers.${index}.kind` });
  const pending = useWatch({ control, name: `issuers.${index}.pending_constitution` });
  const isCompany = kind === "company";
  const verifactu = new Date(`${VERIFACTU_FROM[kind]}T12:00:00Z`);
  const p = `issuers.${index}` as const;

  return (
    <section className="rounded-2xl border bg-card/70 p-5 backdrop-blur">
      <header className="mb-5 flex flex-wrap items-center gap-2">
        {isCompany ? <Building2 className="size-4 text-primary" /> : <UserRound className="size-4 text-primary" />}
        <h3 className="text-sm font-bold">{isCompany ? t("company") : tKind("self_employed")}</h3>
        <Badge variant="secondary" className="gap-1">
          <ShieldCheck className="size-3" />
          {t("verifactu", { date: format.dateTime(verifactu, { dateStyle: "medium" }) })}
        </Badge>
        {onRemove && (
          <Button type="button" variant="ghost" size="icon-sm" className="ml-auto" onClick={onRemove} aria-label={tCommon("remove")}>
            <Trash2 />
          </Button>
        )}
      </header>

      {isCompany && (
        <Controller
          control={control}
          name={`${p}.pending_constitution`}
          render={({ field }) => (
            <label className="mb-5 flex items-start gap-3 rounded-xl border bg-muted/40 p-3">
              <Switch checked={field.value} onCheckedChange={field.onChange} className="mt-0.5" />
              <span>
                <span className="block text-sm font-semibold">{t("notConstituted")}</span>
                <span className="block text-xs text-muted-foreground">{t("notConstitutedHint")}</span>
              </span>
            </label>
          )}
        />
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField name={`${p}.legal_name`} label={t("legalName")} className="sm:col-span-2" />
        <TextField name={`${p}.tax_id`} label={t("taxId")} optional={isCompany && pending} className="[&_input]:uppercase" />
        {isCompany && !pending && <TextField name={`${p}.active_from`} label={t("activeFrom")} type="date" />}
        {!isCompany && (
          <Controller
            control={control}
            name={`${p}.default_irpf_bps`}
            render={({ field }) => (
              <Field>
                <FieldLabel>{t("irpf")}</FieldLabel>
                <Select value={String(field.value)} onValueChange={(v) => field.onChange(Number(v))}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1500">{t("irpfGeneral")}</SelectItem>
                    <SelectItem value="700">{t("irpfNew")}</SelectItem>
                    <SelectItem value="0">{t("irpfNone")}</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            )}
          />
        )}
        <TextField name={`${p}.address_line`} label={t("address")} optional className="sm:col-span-2" />
        <TextField name={`${p}.postal_code`} label={t("postalCode")} optional />
        <TextField name={`${p}.city`} label={t("city")} optional />
        <TextField name={`${p}.iban`} label={t("iban")} optional className="[&_input]:uppercase" />
        <TextField name={`${p}.email`} label={t("email")} type="email" optional />
        {isCompany && <RegistryInfo name={`${p}.registry_info`} />}
      </div>

      {!isCompany && (
        <Controller
          control={control}
          name={`${p}.is_me`}
          render={({ field }) => (
            <label className="mt-4 flex items-center gap-2 text-sm">
              <Checkbox
                checked={field.value}
                onCheckedChange={(checked) => {
                  // Solo un autónomo puede ser "yo".
                  if (checked) {
                    getValues("issuers").forEach((_, i) => i !== index && setValue(`issuers.${i}.is_me`, false));
                  }
                  field.onChange(checked === true);
                }}
              />
              {t("itsMe")}
            </label>
          )}
        />
      )}

      <SeriesRows index={index} currentYear={currentYear} />
    </section>
  );
}

function RegistryInfo({ name }: { name: `issuers.${number}.registry_info` }) {
  const t = useTranslations("onboarding.issuers");
  const tCommon = useTranslations("common");
  const { register } = useFormContext<OnboardingInput>();
  return (
    <Field className="sm:col-span-2">
      <FieldLabel htmlFor={name}>
        {t("registryInfo")} <span className="font-normal text-muted-foreground">· {tCommon("optional")}</span>
      </FieldLabel>
      <Textarea id={name} rows={2} placeholder={t("registryInfoHint")} {...register(name)} />
    </Field>
  );
}

function SeriesRows({ index, currentYear }: { index: number; currentYear: number }) {
  const t = useTranslations("onboarding.issuers");
  const tKind = useTranslations("seriesKind");
  const { control } = useFormContext<OnboardingInput>();
  const series = useWatch({ control, name: `issuers.${index}.series` }) ?? [];

  return (
    <div className="mt-5 border-t pt-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("series")}</p>
      <div className="space-y-3">
        {series.map((s, si) => {
          const valid = isValidSeriesFormat(s.format ?? "", s.reset_yearly);
          const last = Number.isFinite(s.last_number) ? Number(s.last_number) : 0;
          const next = valid ? formatInvoiceNumber(s.format, currentYear, last + 1) : "—";
          return (
            <SeriesRow
              key={`${s.code}-${si}`}
              index={index}
              seriesIndex={si}
              label={tKind(s.kind)}
              nextLabel={t("nextNumber", { number: next })}
            />
          );
        })}
      </div>
    </div>
  );
}

function SeriesRow({
  index,
  seriesIndex,
  label,
  nextLabel,
}: {
  index: number;
  seriesIndex: number;
  label: string;
  nextLabel: string;
}) {
  const t = useTranslations("onboarding.issuers");
  const p = `issuers.${index}.series.${seriesIndex}` as const;
  const formatError = useFieldError(`${p}.format`);

  return (
    <div className="grid items-start gap-3 sm:grid-cols-[8rem_1fr_1fr]">
      <div className="pt-7 text-sm font-semibold">{label}</div>
      <TextField name={`${p}.format`} label={t("seriesFormat")} description={formatError ? undefined : t("seriesFormatHint")} />
      <TextField
        name={`${p}.last_number`}
        label={t("lastNumber")}
        type="number"
        min={0}
        inputMode="numeric"
        description={nextLabel}
      />
    </div>
  );
}
