"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Controller, useFieldArray, useFormContext, useWatch } from "react-hook-form";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { OnboardingInput } from "@/lib/validation/onboarding";
import { StepHeading } from "../form-fields";

export function TaxesStep() {
  const t = useTranslations("onboarding.taxes");
  const { control } = useFormContext<OnboardingInput>();
  const { fields } = useFieldArray({ control, name: "tax_rates" });

  return (
    <div>
      <StepHeading title={t("title")} description={t("description")} />
      <div className="overflow-hidden rounded-2xl border bg-card/70 backdrop-blur">
        <div className="hidden grid-cols-[2.5rem_1.2fr_6rem_2fr_5.5rem] gap-3 border-b bg-muted/40 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground md:grid">
          <span />
          <span>{t("name")}</span>
          <span>{t("rate")}</span>
          <span>{t("legalNote")}</span>
          <span>{t("default")}</span>
        </div>
        {fields.map((field, index) => (
          <TaxRow key={field.id} index={index} />
        ))}
      </div>
    </div>
  );
}

/** Porcentaje escrito a la española ("21", "15,5") guardado en puntos básicos. */
function PercentInput({
  label,
  bps,
  disabled,
  onChange,
  className,
}: {
  label: string;
  bps: number;
  disabled?: boolean;
  onChange: (bps: number) => void;
  className?: string;
}) {
  const [text, setText] = useState(() => String(bps / 100).replace(".", ","));
  return (
    <div className={cn("relative", className)}>
      <Input
        aria-label={label}
        inputMode="decimal"
        disabled={disabled}
        value={disabled ? "0" : text}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value.replace(",", "."));
          if (e.target.value.trim() !== "" && Number.isFinite(n)) onChange(Math.round(n * 100));
        }}
        className="pr-7 text-right tabular"
      />
      <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground">%</span>
    </div>
  );
}

function TaxRow({ index }: { index: number }) {
  const t = useTranslations("onboarding.taxes");
  const tRegime = useTranslations("vatRegime");
  const { control, register, setValue, getValues } = useFormContext<OnboardingInput>();
  const p = `tax_rates.${index}` as const;
  const include = useWatch({ control, name: `${p}.include` });
  const kind = useWatch({ control, name: `${p}.kind` });
  const regime = useWatch({ control, name: `${p}.regime` });
  const fixedZero = kind === "vat" && regime !== "general";

  return (
    <div
      className={cn(
        "grid grid-cols-[2.5rem_1fr] gap-3 border-b px-4 py-3 last:border-b-0 md:grid-cols-[2.5rem_1.2fr_6rem_2fr_5.5rem] md:items-center",
        !include && "opacity-50",
      )}
    >
      <Controller
        control={control}
        name={`${p}.include`}
        render={({ field }) => (
          <Checkbox checked={field.value} onCheckedChange={(v) => field.onChange(v === true)} aria-label={t("include")} />
        )}
      />
      <div className="min-w-0">
        <Input aria-label={t("name")} {...register(`${p}.name`)} />
        <div className="mt-1.5 flex gap-1.5">
          <Badge variant="secondary">{kind === "vat" ? "IVA" : "IRPF"}</Badge>
          {regime && <Badge variant="outline">{tRegime(regime)}</Badge>}
        </div>
      </div>
      <Controller
        control={control}
        name={`${p}.rate_bps`}
        render={({ field }) => (
          <PercentInput
            label={t("rate")}
            bps={field.value}
            disabled={fixedZero}
            onChange={field.onChange}
            className="col-start-2 md:col-start-auto"
          />
        )}
      />
      <Input
        aria-label={t("legalNote")}
        className="col-start-2 md:col-start-auto"
        placeholder="—"
        {...register(`${p}.legal_note`)}
      />
      <Controller
        control={control}
        name={`${p}.is_default`}
        render={({ field }) => (
          <label className="col-start-2 flex items-center gap-2 text-sm md:col-start-auto">
            <Checkbox
              checked={field.value}
              onCheckedChange={(checked) => {
                // Un solo tipo por defecto por impuesto (IVA / IRPF).
                if (checked) {
                  getValues("tax_rates").forEach((r, i) => {
                    if (i !== index && r.kind === kind) setValue(`tax_rates.${i}.is_default`, false);
                  });
                }
                field.onChange(checked === true);
              }}
            />
            <span className="md:sr-only">{t("default")}</span>
          </label>
        )}
      />
    </div>
  );
}
