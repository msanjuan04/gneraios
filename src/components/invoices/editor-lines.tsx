"use client";

import { ArrowDown, ArrowUp, FileSignature, Link2, Plus, Trash2, Undo2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Controller, type UseFieldArrayReturn, type UseFormReturn } from "react-hook-form";
import { BILLING_TYPES, type DraftFormInput, type DraftFormValues } from "@/app/[org]/invoices/schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { LineAmounts } from "@/domain/tax";
import { cn } from "@/lib/utils";
import { useInvoiceFormat, useInvoiceValidationMessage, usePeriodLabel } from "./format";
import type { EditorTaxRate, InvoiceKind, LineOrigin } from "./types";

type LineField = "description" | "quantity" | "unit_price" | "discount" | "tax_rate_id" | "billing_type" | "period_start" | "period_end";

/** Campos de una línea en el orden en que se leen, con la clave de su etiqueta en invoices.lines. */
const FIELD_LABELS: [LineField, string][] = [
  ["description", "description"],
  ["quantity", "quantity"],
  ["unit_price", "unitPrice"],
  ["discount", "discount"],
  ["tax_rate_id", "vat"],
  ["billing_type", "billingType"],
  ["period_start", "periodFrom"],
  ["period_end", "periodTo"],
];

export type RemovedLine = { line: DraftFormInput["lines"][number]; waive: boolean };

type Props = {
  form: UseFormReturn<DraftFormInput, unknown, DraftFormValues>;
  fieldArray: UseFieldArrayReturn<DraftFormInput, "lines", "key">;
  kind: InvoiceKind;
  vatRates: EditorTaxRate[];
  lineOrigins: Record<string, LineOrigin>;
  /** Importes de cada línea con lo escrito ahora (null si falta algo por completar). */
  amounts: (LineAmounts | null)[];
  /** Línea del contrato que se está quitando: se pregunta si vuelve a pendiente o se condona. */
  pendingRemoval: string | null;
  onRequestRemove: (index: number) => void;
  onConfirmRemove: (waive: boolean) => void;
  onCancelRemove: () => void;
  removed: RemovedLine[];
  onUndoRemoved: () => void;
  onAdd: () => void;
  disabled: boolean;
};

/**
 * Líneas del borrador: una fila densa por línea (concepto, cantidad, precio sin IVA, descuento y
 * base) y debajo su tipo de facturación, IVA, IRPF y periodo. Lo que viene del contrato conserva
 * su tipo y su periodo; al quitarlo se decide si vuelve a pendiente o se condona.
 */
export function EditorLines({
  form,
  fieldArray,
  kind,
  vatRates,
  lineOrigins,
  amounts,
  pendingRemoval,
  onRequestRemove,
  onConfirmRemove,
  onCancelRemove,
  removed,
  onUndoRemoved,
  onAdd,
  disabled,
}: Props) {
  const t = useTranslations("invoices.lines");
  const tType = useTranslations("billing.billingType");
  const { money } = useInvoiceFormat();
  const periodLabel = usePeriodLabel();
  const message = useInvoiceValidationMessage();
  const { control, register, formState } = form;
  const { fields, move } = fieldArray;
  const lineErrors = formState.errors.lines;
  const waived = removed.filter((r) => r.waive).length;

  return (
    <div className="space-y-3">
      {kind === "rectifying" && <p className="text-xs text-muted-foreground">{t("negativeHint")}</p>}

      {fields.length === 0 ? (
        <div className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">{t("empty")}</div>
      ) : (
        <>
          <div className="hidden grid-cols-12 gap-2 px-3 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase md:grid">
            <span className="col-span-6">{t("description")}</span>
            <span className="col-span-1 text-right">{t("quantity")}</span>
            <span className="col-span-2 text-right">{t("unitPrice")}</span>
            <span className="col-span-1 text-right">{t("discount")}</span>
            <span className="col-span-2 text-right">{t("base")}</span>
          </div>
          <ol className="space-y-2">
            {fields.map((field, index) => {
              const lineId = field.id;
              const origin = lineOrigins[lineId];
              const fromContract = Boolean(origin?.contractLineId);
              const errors = lineErrors?.[index];
              const invalid = (name: LineField) => Boolean(errors?.[name]);
              const amount = amounts[index] ?? null;
              const period = fromContract ? periodLabel(field.period_start || null, field.period_end || null) : null;
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
                      placeholder={t("descriptionPlaceholder")}
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
                      className={cn(
                        "col-span-12 text-right text-sm font-semibold tabular md:col-span-2",
                        !amount && "text-muted-foreground",
                      )}
                      title={t("baseHint")}
                    >
                      {amount ? money(amount.baseCents) : "—"}
                    </p>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {fromContract ? (
                      <Badge variant="outline" className="h-7 gap-1.5 rounded-full px-2.5" title={t("fromContractHint")}>
                        <FileSignature />
                        {tType(field.billing_type || "one_off")}
                      </Badge>
                    ) : (
                      <Controller
                        control={control}
                        name={`lines.${index}.billing_type`}
                        render={({ field: type }) => (
                          <Select value={type.value} onValueChange={(v) => type.onChange(BILLING_TYPES.find((b) => b === v) ?? "")}>
                            <SelectTrigger size="sm" className="w-32" aria-label={t("billingType")} aria-invalid={invalid("billing_type")}>
                              <SelectValue placeholder={t("billingTypePlaceholder")} />
                            </SelectTrigger>
                            <SelectContent>
                              {BILLING_TYPES.map((b) => (
                                <SelectItem key={b} value={b}>
                                  {tType(b)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      />
                    )}

                    <Controller
                      control={control}
                      name={`lines.${index}.tax_rate_id`}
                      render={({ field: rate }) => (
                        <Select value={rate.value} onValueChange={rate.onChange}>
                          <SelectTrigger size="sm" className="w-48 max-w-full" aria-label={t("vat")} aria-invalid={invalid("tax_rate_id")}>
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
                        <label className="flex h-7 cursor-pointer items-center gap-2 rounded-full px-2 text-[0.8rem] font-medium text-muted-foreground hover:text-foreground">
                          <Checkbox checked={irpf.value} onCheckedChange={(v) => irpf.onChange(v === true)} />
                          {t("irpfApplies")}
                        </label>
                      )}
                    />

                    {fromContract ? (
                      period && (
                        <span className="inline-flex h-7 items-center gap-1.5 text-xs text-muted-foreground tabular" title={t("fromContractHint")}>
                          <Link2 className="size-3.5" />
                          {period}
                        </span>
                      )
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-muted-foreground">{t("period")}</span>
                        <Input
                          type="date"
                          {...register(`lines.${index}.period_start`)}
                          aria-label={t("periodFrom")}
                          aria-invalid={invalid("period_start")}
                          className="h-7 w-36 text-xs tabular"
                        />
                        <span className="text-xs text-muted-foreground">–</span>
                        <Input
                          type="date"
                          {...register(`lines.${index}.period_end`)}
                          aria-label={t("periodTo")}
                          aria-invalid={invalid("period_end")}
                          className="h-7 w-36 text-xs tabular"
                        />
                      </div>
                    )}

                    <div className="ml-auto flex items-center gap-0.5">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={t("moveUp")}
                            disabled={disabled || index === 0}
                            onClick={() => move(index, index - 1)}
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
                            disabled={disabled || index === fields.length - 1}
                            onClick={() => move(index, index + 1)}
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
                            disabled={disabled}
                            onClick={() => onRequestRemove(index)}
                            className="hover:text-destructive"
                          >
                            <Trash2 />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{t("remove")}</TooltipContent>
                      </Tooltip>
                    </div>
                  </div>

                  {errorList.length > 0 && <p className="mt-2 text-xs text-destructive">{errorList.join(" · ")}</p>}

                  {pendingRemoval === lineId && (
                    <div
                      role="alertdialog"
                      aria-label={t("removeLinkedTitle")}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          e.stopPropagation();
                          onCancelRemove();
                        }
                      }}
                      className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm"
                    >
                      <p className="min-w-0 flex-1 font-medium">{t("removeLinkedTitle")}</p>
                      <Button type="button" variant="ghost" size="sm" onClick={onCancelRemove}>
                        {t("cancel")}
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => onConfirmRemove(false)} title={t("keepPendingHint")} autoFocus>
                        {t("keepPending")}
                      </Button>
                      <Button type="button" variant="destructive" size="sm" onClick={() => onConfirmRemove(true)} title={t("waiveHint")}>
                        {t("waive")}
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </>
      )}

      {removed.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed px-3 py-2 text-xs text-muted-foreground">
          <span className="min-w-0 flex-1">
            {t("removedSummary", { count: removed.length })}{" "}
            {[
              removed.length - waived > 0 ? t("removedPending", { count: removed.length - waived }) : null,
              waived > 0 ? t("removedWaived", { count: waived }) : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
          <Button type="button" variant="ghost" size="xs" onClick={onUndoRemoved} disabled={disabled}>
            <Undo2 data-icon="inline-start" />
            {t("undoRemoved")}
          </Button>
        </div>
      )}

      <Button type="button" variant="outline" size="sm" onClick={onAdd} disabled={disabled || fields.length >= 200}>
        <Plus data-icon="inline-start" />
        {t("add")}
      </Button>
    </div>
  );
}
