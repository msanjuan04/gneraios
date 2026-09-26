"use client";

import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Controller, useFormContext, useWatch } from "react-hook-form";
import {
  BILLING_TYPES,
  discountToBps,
  isRecurring,
  type LineFormInput,
  moneyInputToCents,
  parseQuantity,
} from "@/app/[org]/contracts/schema";
import { lineBase } from "@/app/[org]/contracts/summary";
import { FormField, ToggleField } from "@/components/settings/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useContractFormat } from "./format";
import { MoneyInput, PercentInput } from "./inputs";
import type { VatRateOption } from "./types";
import { useContractValidationMessage } from "./validation";

/** Cualquier formulario con líneas: el alta del contrato (varias) o el panel de una línea (una). */
type LinesForm = { lines: LineFormInput[] };

/** Base de un ciclo de la línea tal y como está escrita, o null si aún no se entiende. */
export function previewLineBase(line: Pick<LineFormInput, "quantity" | "unit_price" | "discount">): number | null {
  const quantity = parseQuantity(line.quantity);
  const unitPriceCents = moneyInputToCents(line.unit_price);
  const discountBps = discountToBps(line.discount);
  if (quantity === null || unitPriceCents === null || discountBps === null) return null;
  return lineBase({ quantity, unitPriceCents, discountBps });
}

/**
 * Campos de una línea de contrato. `lockEconomics`: la línea ya tiene facturación y sus
 * condiciones no se tocan (solo la descripción y el fin). `versionMode`: versión nueva desde
 * una fecha, con el mismo tipo, día de facturación y fin; cambian las condiciones.
 */
export function LineFields({
  index,
  vatRates,
  today,
  lockEconomics = false,
  lockType = false,
  versionMode = false,
  autoFocus = false,
  onRemove,
  className,
}: {
  index: number;
  vatRates: VatRateOption[];
  today: string;
  lockEconomics?: boolean;
  /** Una línea guardada no cambia de tipo si ya tiene facturación. */
  lockType?: boolean;
  versionMode?: boolean;
  autoFocus?: boolean;
  onRemove?: () => void;
  className?: string;
}) {
  const t = useTranslations("contracts.line");
  const tType = useTranslations("billing.billingType");
  const message = useContractValidationMessage();
  const fmt = useContractFormat();
  const { control, register, setValue, getValues, formState } = useFormContext<LinesForm>();
  const p = `lines.${index}` as const;
  const errors = formState.errors.lines?.[index];
  const line = useWatch({ control, name: p });
  const type = line?.billing_type ?? "monthly";
  const recurring = isRecurring(type);
  const base = line ? previewLineBase(line) : null;
  const frozen = lockEconomics && !versionMode;
  const id = (field: keyof LineFormInput) => `line-${index}-${field}`;
  const error = (field: keyof LineFormInput) => message(errors?.[field]?.message);
  // Solo lectura, sin `disabled`: así el valor sigue en el formulario y se valida igual.
  const locked = (on: boolean) => (on ? { readOnly: true, "aria-readonly": true } : {});

  return (
    <div className={cn("grid gap-3 sm:grid-cols-4", className)}>
      <Controller
        control={control}
        name={`${p}.billing_type`}
        render={({ field }) => (
          <FormField id={id("billing_type")} label={t("type")}>
            <Select
              value={field.value}
              disabled={frozen || lockType || versionMode}
              onValueChange={(value) => {
                const next = BILLING_TYPES.find((b) => b === value) ?? "monthly";
                field.onChange(next);
                // Las recurrentes necesitan inicio: se propone hoy.
                if (isRecurring(next) && getValues(`${p}.starts_on`) === "") setValue(`${p}.starts_on`, today);
              }}
            >
              <SelectTrigger id={id("billing_type")} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BILLING_TYPES.map((b) => (
                  <SelectItem key={b} value={b}>
                    {tType(b)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        )}
      />
      <FormField id={id("description")} label={t("description")} error={error("description")} className="sm:col-span-3">
        <div className="flex items-center gap-1.5">
          <Input
            id={id("description")}
            placeholder={t(`descriptionPlaceholder.${type}`)}
            autoFocus={autoFocus}
            aria-invalid={Boolean(errors?.description)}
            {...register(`${p}.description`)}
          />
          {onRemove && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button type="button" variant="ghost" size="icon-sm" aria-label={t("remove")} onClick={onRemove}>
                  <Trash2 />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("remove")}</TooltipContent>
            </Tooltip>
          )}
        </div>
      </FormField>

      <FormField id={id("quantity")} label={t("quantity")} error={error("quantity")}>
        <Input
          id={id("quantity")}
          inputMode="decimal"
          aria-invalid={Boolean(errors?.quantity)}
          {...register(`${p}.quantity`)}
          {...locked(frozen)}
          className={cn("text-right tabular", frozen && "opacity-60")}
        />
      </FormField>
      <FormField id={id("unit_price")} label={t(`unitPrice.${type}`)} error={error("unit_price")}>
        <MoneyInput
          id={id("unit_price")}
          aria-invalid={Boolean(errors?.unit_price)}
          {...register(`${p}.unit_price`)}
          {...locked(frozen)}
          className={cn(frozen && "opacity-60")}
        />
      </FormField>
      <FormField id={id("discount")} label={t("discount")} optional error={error("discount")}>
        <PercentInput
          id={id("discount")}
          aria-invalid={Boolean(errors?.discount)}
          {...register(`${p}.discount`)}
          {...locked(frozen)}
          className={cn(frozen && "opacity-60")}
        />
      </FormField>
      <Controller
        control={control}
        name={`${p}.tax_rate_id`}
        render={({ field }) => (
          <FormField id={id("tax_rate_id")} label={t("vat")} error={error("tax_rate_id")}>
            <Select value={field.value || undefined} onValueChange={field.onChange} disabled={frozen}>
              <SelectTrigger id={id("tax_rate_id")} className="w-full" aria-invalid={Boolean(errors?.tax_rate_id)}>
                <SelectValue placeholder={t("vatPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {vatRates.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        )}
      />

      {type !== "one_off" && !versionMode && (
        <>
          <FormField
            id={id("starts_on")}
            label={t("startsOn")}
            optional={!recurring}
            error={error("starts_on")}
            className="sm:col-span-1"
          >
            <Input
              id={id("starts_on")}
              type="date"
              aria-invalid={Boolean(errors?.starts_on)}
              {...register(`${p}.starts_on`)}
              {...locked(frozen)}
              className={cn(frozen && "opacity-60")}
            />
          </FormField>
          <FormField id={id("ends_on")} label={t("endsOn")} optional error={error("ends_on")} className="sm:col-span-1">
            <Input id={id("ends_on")} type="date" aria-invalid={Boolean(errors?.ends_on)} {...register(`${p}.ends_on`)} />
          </FormField>
          {type === "monthly" ? (
            <FormField id={id("billing_day")} label={t("billingDay")} error={error("billing_day")} className="sm:col-span-2">
              <Input
                id={id("billing_day")}
                inputMode="numeric"
                maxLength={2}
                aria-invalid={Boolean(errors?.billing_day)}
                {...register(`${p}.billing_day`)}
                {...locked(frozen)}
                className={cn("w-20 text-right tabular", frozen && "opacity-60")}
              />
            </FormField>
          ) : (
            <p className="self-end pb-2 text-xs text-muted-foreground sm:col-span-2">{t(`scheduleHint.${type}`)}</p>
          )}
        </>
      )}

      {type === "monthly" && !versionMode && (
        <Controller
          control={control}
          name={`${p}.prorate_first`}
          render={({ field }) => (
            <ToggleField
              id={id("prorate_first")}
              label={t("prorateFirst")}
              description={t("prorateFirstHint")}
              checked={field.value}
              onCheckedChange={field.onChange}
              disabled={frozen}
              className="sm:col-span-2"
            />
          )}
        />
      )}
      <Controller
        control={control}
        name={`${p}.irpf_applies`}
        render={({ field }) => (
          <ToggleField
            id={id("irpf_applies")}
            label={t("irpfApplies")}
            description={t("irpfAppliesHint")}
            checked={field.value}
            onCheckedChange={field.onChange}
            disabled={frozen}
            className={type === "monthly" && !versionMode ? "sm:col-span-2" : "sm:col-span-4"}
          />
        )}
      />

      <p className="text-right text-xs text-muted-foreground tabular sm:col-span-4">
        {base === null ? t("amountPending") : t("amount", { amount: fmt.perCycle(base, type) })}
      </p>
    </div>
  );
}
