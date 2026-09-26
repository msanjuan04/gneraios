"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Controller, type UseFieldArrayReturn, type UseFormReturn, useWatch } from "react-hook-form";
import type { QuoteFormInput, QuoteFormValues, QuoteLineInput } from "@/app/[org]/quotes/schema";
import { QUOTE_BILLING_TYPES, type QuoteBillingType } from "@/app/[org]/quotes/summary";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useQuoteFormat, useQuoteValidationMessage } from "./format";
import type { QuoteVatRate } from "./types";

type LineField = "description" | "quantity" | "unit_price" | "discount" | "tax_rate_id" | "starts_on" | "ends_on" | "billing_day";

/** Campos de una línea en el orden en que se leen, con la clave de su etiqueta en quotes.lines. */
const FIELD_LABELS: [LineField, string][] = [
  ["description", "description"],
  ["quantity", "quantity"],
  ["unit_price", "unitPrice"],
  ["discount", "discount"],
  ["tax_rate_id", "vat"],
  ["starts_on", "startsOn"],
  ["ends_on", "endsOn"],
  ["billing_day", "billingDay"],
];

type Props = {
  form: UseFormReturn<QuoteFormInput, unknown, QuoteFormValues>;
  fieldArray: UseFieldArrayReturn<QuoteFormInput, "lines", "key">;
  vatRates: QuoteVatRate[];
  /** Base de cada línea con lo escrito ahora (null si falta algo por completar), por índice. */
  bases: (number | null)[];
  billingDay: number;
  onAdd: (type: QuoteBillingType) => void;
  disabled: boolean;
};

/**
 * Líneas del presupuesto agrupadas por tipo (pago único, mensuales, anuales y por uso), que
 * nunca se mezclan: cada grupo con sus filas densas —concepto, cantidad, precio sin IVA,
 * descuento y base del ciclo— y debajo el tipo, el IVA, el IRPF y la vigencia.
 */
export function QuoteLines({ form, fieldArray, vatRates, bases, billingDay, onAdd, disabled }: Props) {
  const t = useTranslations("quotes.lines");
  const tType = useTranslations("billing.billingType");
  const tGroup = useTranslations("quotes.lines.groups");
  const { perCycle } = useQuoteFormat();
  const message = useQuoteValidationMessage();
  const { control, register, formState } = form;
  const { fields, swap, remove } = fieldArray;
  const watched: QuoteLineInput[] = useWatch({ control, name: "lines" }) ?? [];
  const lineErrors = formState.errors.lines;

  const typeOf = (index: number): QuoteBillingType => watched[index]?.billing_type ?? fields[index]?.billing_type ?? "one_off";
  const groups = QUOTE_BILLING_TYPES.map((type) => ({
    type,
    indices: fields.map((_, index) => index).filter((index) => typeOf(index) === type),
  })).filter((group) => group.indices.length > 0);

  /** Sube o baja una línea dentro de su grupo (el orden de los grupos es fijo). */
  const moveWithin = (indices: number[], position: number, delta: -1 | 1) => {
    const from = indices[position];
    const to = indices[position + delta];
    if (from !== undefined && to !== undefined) swap(from, to);
  };

  return (
    <div className="space-y-5">
      {groups.length === 0 ? (
        <div className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">{t("empty")}</div>
      ) : (
        groups.map(({ type, indices }) => (
          <section key={type} aria-labelledby={`quote-group-${type}`}>
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <h4 id={`quote-group-${type}`} className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                {tGroup(type)}
              </h4>
              <p className="text-xs text-muted-foreground">{t(`groupHints.${type}`)}</p>
            </div>
            <ol className="space-y-2">
              {indices.map((index, position) => {
                const field = fields[index]!;
                const errors = lineErrors?.[index];
                const invalid = (name: LineField) => Boolean(errors?.[name]);
                const base = bases[index] ?? null;
                const recurring = type !== "one_off";
                const errorList = FIELD_LABELS.flatMap(([name, label]) => {
                  const text = message(errors?.[name]?.message);
                  return text ? [`${t(label)}: ${text}`] : [];
                });

                return (
                  <li
                    key={field.key}
                    className={cn(
                      "rounded-xl border bg-muted/20 p-3 transition-colors focus-within:border-ring/50",
                      errorList.length > 0 && "border-destructive/40",
                    )}
                  >
                    <div className="grid grid-cols-12 items-center gap-2">
                      <Input
                        {...register(`lines.${index}.description`)}
                        aria-label={t("description")}
                        aria-invalid={invalid("description")}
                        placeholder={t(`placeholders.${type}`)}
                        className="col-span-12 md:col-span-6"
                      />
                      <Input
                        {...register(`lines.${index}.quantity`)}
                        aria-label={t("quantity")}
                        aria-invalid={invalid("quantity")}
                        inputMode="decimal"
                        autoComplete="off"
                        className="col-span-3 text-right tabular md:col-span-1"
                      />
                      <InputGroup className="col-span-5 md:col-span-2">
                        <InputGroupInput
                          {...register(`lines.${index}.unit_price`)}
                          aria-label={t("unitPriceHint")}
                          aria-invalid={invalid("unit_price")}
                          inputMode="decimal"
                          autoComplete="off"
                          placeholder="0,00"
                          className="text-right tabular"
                        />
                        <InputGroupAddon align="inline-end">
                          <InputGroupText>€</InputGroupText>
                        </InputGroupAddon>
                      </InputGroup>
                      <InputGroup className="col-span-4 md:col-span-1">
                        <InputGroupInput
                          {...register(`lines.${index}.discount`)}
                          aria-label={t("discountHint")}
                          aria-invalid={invalid("discount")}
                          inputMode="decimal"
                          autoComplete="off"
                          placeholder="0"
                          className="text-right tabular"
                        />
                        <InputGroupAddon align="inline-end">
                          <InputGroupText>%</InputGroupText>
                        </InputGroupAddon>
                      </InputGroup>
                      <p
                        className={cn("col-span-12 text-right text-sm font-semibold tabular md:col-span-2", base === null && "text-muted-foreground")}
                        title={t("baseHint")}
                      >
                        {base === null ? "—" : perCycle(base, type)}
                      </p>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Controller
                        control={control}
                        name={`lines.${index}.billing_type`}
                        render={({ field: billing }) => (
                          <Select
                            value={billing.value}
                            onValueChange={(v) => billing.onChange(QUOTE_BILLING_TYPES.find((b) => b === v) ?? billing.value)}
                            disabled={disabled}
                          >
                            <SelectTrigger size="sm" className="w-36" aria-label={t("billingType")}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {QUOTE_BILLING_TYPES.map((b) => (
                                <SelectItem key={b} value={b}>
                                  {tType(b)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      />

                      <Controller
                        control={control}
                        name={`lines.${index}.tax_rate_id`}
                        render={({ field: rate }) => (
                          <Select value={rate.value} onValueChange={rate.onChange} disabled={disabled}>
                            <SelectTrigger size="sm" className="w-44 max-w-full" aria-label={t("vat")} aria-invalid={invalid("tax_rate_id")}>
                              <SelectValue placeholder={t("vatPlaceholder")} />
                            </SelectTrigger>
                            <SelectContent>
                              {vatRates.map((r) => (
                                <SelectItem key={r.id} value={r.id} disabled={r.archived && r.id !== rate.value}>
                                  {r.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      />

                      <Controller
                        control={control}
                        name={`lines.${index}.irpf_applies`}
                        render={({ field: irpf }) => (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <label className="flex h-7 cursor-pointer items-center gap-2 rounded-full px-2 text-[0.8rem] font-medium text-muted-foreground hover:text-foreground">
                                <Checkbox checked={irpf.value} onCheckedChange={(v) => irpf.onChange(v === true)} disabled={disabled} />
                                {t("irpfApplies")}
                              </label>
                            </TooltipTrigger>
                            <TooltipContent>{t("irpfHint")}</TooltipContent>
                          </Tooltip>
                        )}
                      />

                      {recurring && (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-xs text-muted-foreground">{t("startsOn")}</span>
                          <Input
                            type="date"
                            {...register(`lines.${index}.starts_on`)}
                            aria-label={t("startsOn")}
                            aria-invalid={invalid("starts_on")}
                            title={t("startsOnHint")}
                            className="h-7 w-36 text-xs tabular"
                          />
                          <span className="text-xs text-muted-foreground">{t("endsOn")}</span>
                          <Input
                            type="date"
                            {...register(`lines.${index}.ends_on`)}
                            aria-label={t("endsOn")}
                            aria-invalid={invalid("ends_on")}
                            title={t("endsOnHint")}
                            className="h-7 w-36 text-xs tabular"
                          />
                        </div>
                      )}

                      {type === "monthly" && (
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-muted-foreground">{t("billingDay")}</span>
                          <Input
                            {...register(`lines.${index}.billing_day`)}
                            aria-label={t("billingDay")}
                            aria-invalid={invalid("billing_day")}
                            inputMode="numeric"
                            autoComplete="off"
                            placeholder={String(billingDay)}
                            title={t("billingDayHint", { day: billingDay })}
                            className="h-7 w-14 text-right text-xs tabular"
                          />
                        </div>
                      )}

                      {!disabled && (
                        <div className="ml-auto flex items-center gap-0.5">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-xs"
                                aria-label={t("moveUp")}
                                disabled={position === 0}
                                onClick={() => moveWithin(indices, position, -1)}
                              >
                                <ArrowUp />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>{t("moveUp")}</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-xs"
                                aria-label={t("moveDown")}
                                disabled={position === indices.length - 1}
                                onClick={() => moveWithin(indices, position, 1)}
                              >
                                <ArrowDown />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>{t("moveDown")}</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-xs"
                                aria-label={t("remove")}
                                onClick={() => remove(index)}
                                className="hover:text-destructive"
                              >
                                <Trash2 />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>{t("remove")}</TooltipContent>
                          </Tooltip>
                        </div>
                      )}
                    </div>

                    {errorList.length > 0 && <p className="mt-2 text-xs text-destructive">{errorList.join(" · ")}</p>}
                  </li>
                );
              })}
            </ol>
          </section>
        ))
      )}

      {!disabled && (
        <div className="flex flex-wrap items-center gap-2">
          {QUOTE_BILLING_TYPES.map((type) => (
            <Button key={type} type="button" variant="outline" size="sm" onClick={() => onAdd(type)}>
              <Plus data-icon="inline-start" />
              {t(`add.${type}`)}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
