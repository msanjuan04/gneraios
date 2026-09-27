"use client";

import { useTranslations } from "next-intl";
import { PAYMENT_METHODS } from "@/app/[org]/invoices/schema";
import { useInvoiceFormat } from "@/components/invoices/format";
import { OptionSelect } from "@/components/projects/fields";
import { FormField } from "@/components/settings/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PaymentMethod } from "@/domain/dataio/values";
import type { PaymentStatus } from "@/domain/invoice-import/form";
import type { Confidence } from "@/domain/invoice-import/types";
import { cn } from "@/lib/utils";
import { ConfidenceDot } from "./confidence";

export type PaymentValue = { status: PaymentStatus; paidOn: string; amount: string; method: PaymentMethod; reference: string };

/**
 * El cobro de la factura: pendiente, cobrada o un cobro parcial, con su propia fecha de cobro (el
 * día que pagó el cliente, que no es la fecha de la factura), el importe si es parcial, la forma de
 * pago y una referencia.
 */
export function PaymentFields({
  idPrefix,
  value,
  onChange,
  statuses = ["pending", "paid", "partial"],
  totalCents,
  issuedOn,
  dueOn,
  paidOnConfidence,
  errors,
}: {
  idPrefix: string;
  value: PaymentValue;
  onChange: (patch: Partial<PaymentValue>) => void;
  statuses?: readonly PaymentStatus[];
  /** Lo que se cobra si está «Cobrada» (el total, o lo pendiente de una que ya estaba). */
  totalCents: number;
  issuedOn: string;
  dueOn: string;
  /** Lo seguro que es la fecha de cobro leída del PDF (null si no la trae o se ha cambiado). */
  paidOnConfidence: Confidence | null;
  errors: { paidOn?: string; amount?: string };
}) {
  const t = useTranslations("invoiceImport.payment");
  const tMethod = useTranslations("billing.paymentMethod");
  const { money, date } = useInvoiceFormat();
  const collected = value.status !== "pending";

  return (
    <fieldset className="space-y-3">
      <legend className="sr-only">{t("title")}</legend>
      <div role="radiogroup" aria-label={t("title")} className="inline-flex rounded-full border bg-muted/40 p-0.5">
        {statuses.map((status) => (
          <button
            key={status}
            type="button"
            role="radio"
            aria-checked={value.status === status}
            onClick={() => onChange({ status })}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-semibold transition-colors",
              value.status === status ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t(status)}
          </button>
        ))}
      </div>

      {!collected ? (
        <p className="text-xs text-muted-foreground">{t("pendingHint")}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <FormField
              id={`${idPrefix}-paid-on`}
              label={
                <span className="inline-flex items-center gap-1.5">
                  {t("paidOn")}
                  <ConfidenceDot value={paidOnConfidence} />
                </span>
              }
              error={errors.paidOn}
              description={t("paidOnHint")}
            >
              <Input
                id={`${idPrefix}-paid-on`}
                type="date"
                value={value.paidOn}
                aria-invalid={Boolean(errors.paidOn)}
                onChange={(e) => onChange({ paidOn: e.target.value })}
              />
            </FormField>
            {/* Fuera del campo: si falta la fecha, el campo se pinta en rojo; los atajos, no. */}
            <div className="flex flex-wrap gap-1">
              {dueOn && (
                <Button type="button" variant="ghost" size="xs" onClick={() => onChange({ paidOn: dueOn })}>
                  {t("useDue", { date: date(dueOn) })}
                </Button>
              )}
              {issuedOn && (
                <Button type="button" variant="ghost" size="xs" onClick={() => onChange({ paidOn: issuedOn })}>
                  {t("useIssue", { date: date(issuedOn) })}
                </Button>
              )}
            </div>
          </div>
          {value.status === "partial" ? (
            <FormField id={`${idPrefix}-amount`} label={t("amount")} error={errors.amount} description={t("amountOf", { total: money(totalCents) })}>
              <Input
                id={`${idPrefix}-amount`}
                inputMode="decimal"
                value={value.amount}
                aria-invalid={Boolean(errors.amount)}
                onChange={(e) => onChange({ amount: e.target.value })}
              />
            </FormField>
          ) : (
            <FormField label={t("amount")}>
              <p className="flex h-8 items-center font-semibold tabular">{money(totalCents)}</p>
            </FormField>
          )}
          <FormField id={`${idPrefix}-method`} label={t("method")}>
            <OptionSelect
              id={`${idPrefix}-method`}
              value={value.method}
              onChange={(v) => onChange({ method: v as PaymentMethod })}
              options={PAYMENT_METHODS.map((m) => ({ value: m, label: tMethod(m) }))}
            />
          </FormField>
          <FormField id={`${idPrefix}-reference`} label={t("reference")} optional>
            <Input id={`${idPrefix}-reference`} value={value.reference} maxLength={200} onChange={(e) => onChange({ reference: e.target.value })} />
          </FormField>
        </div>
      )}
    </fieldset>
  );
}
