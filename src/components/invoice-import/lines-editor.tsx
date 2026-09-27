"use client";

import { Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useInvoiceFormat } from "@/components/invoices/format";
import { OptionSelect } from "@/components/projects/fields";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { classifyLine } from "@/domain/dataio/classify";
import { BILLING_TYPES, type ComputedLine, type ImportLineForm } from "@/domain/invoice-import/form";
import type { SetupTaxRate } from "@/domain/invoice-import/match";
import { cn } from "@/lib/utils";

/**
 * Las líneas de la factura: concepto, cantidad, precio, descuento, IVA (los tipos de la org), si
 * lleva IRPF y el tipo de ingreso (puntual, mensual, anual o uso: las métricas no los mezclan). La
 * base de cada línea la calcula el dominio.
 */
export function LinesEditor({
  idPrefix,
  lines,
  computed,
  vatRates,
  irpf,
  invalid,
  onChange,
}: {
  idPrefix: string;
  lines: readonly ImportLineForm[];
  computed: readonly (ComputedLine | null)[];
  vatRates: readonly SetupTaxRate[];
  /** La factura lleva IRPF: cada línea dice si está sujeta. */
  irpf: boolean;
  /** Campos con error, como «lines.0.unitPrice». */
  invalid: ReadonlySet<string>;
  onChange: (lines: ImportLineForm[]) => void;
}) {
  const t = useTranslations("invoiceImport.lines");
  const tType = useTranslations("billing.billingType");
  const { money, date } = useInvoiceFormat();
  const set = (index: number, patch: Partial<ImportLineForm>) => onChange(lines.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  const defaultRate = vatRates.find((r) => r.isDefault) ?? vatRates[0];

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b text-left text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
              <th className="py-2 pr-2 pl-3 font-semibold">{t("description")}</th>
              <th className="w-20 px-1 py-2 font-semibold">{t("quantity")}</th>
              <th className="w-28 px-1 py-2 font-semibold">{t("unitPrice")}</th>
              <th className="w-16 px-1 py-2 font-semibold">{t("discount")}</th>
              <th className="w-36 px-1 py-2 font-semibold">{t("vat")}</th>
              {irpf && <th className="w-12 px-1 py-2 text-center font-semibold">{t("irpf")}</th>}
              <th className="w-32 px-1 py-2 font-semibold">{t("type")}</th>
              <th className="w-24 px-2 py-2 text-right font-semibold">{t("base")}</th>
              <th className="w-9 py-2 pr-2" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {lines.map((line, index) => {
              const at = `lines.${index}`;
              const bad = (field: string) => invalid.has(`${at}.${field}`);
              return (
                <tr key={line.key} className="align-top">
                  <td className="py-1.5 pr-1 pl-2">
                    <Input
                      aria-label={t("description")}
                      value={line.description}
                      maxLength={500}
                      aria-invalid={bad("description")}
                      onChange={(e) => set(index, { description: e.target.value })}
                    />
                    {line.periodStart && line.periodEnd && (
                      <p className="mt-1 px-1 text-xs text-muted-foreground tabular">{t("period", { from: date(line.periodStart), to: date(line.periodEnd) })}</p>
                    )}
                  </td>
                  <td className="px-1 py-1.5">
                    <Input
                      aria-label={t("quantity")}
                      inputMode="decimal"
                      value={line.quantity}
                      aria-invalid={bad("quantity")}
                      onChange={(e) => set(index, { quantity: e.target.value })}
                    />
                  </td>
                  <td className="px-1 py-1.5">
                    <Input
                      aria-label={t("unitPrice")}
                      inputMode="decimal"
                      value={line.unitPrice}
                      aria-invalid={bad("unitPrice")}
                      onChange={(e) => set(index, { unitPrice: e.target.value })}
                    />
                  </td>
                  <td className="px-1 py-1.5">
                    <Input
                      aria-label={t("discount")}
                      inputMode="decimal"
                      placeholder="0"
                      value={line.discount}
                      aria-invalid={bad("discount")}
                      onChange={(e) => set(index, { discount: e.target.value })}
                    />
                  </td>
                  <td className="px-1 py-1.5">
                    <OptionSelect
                      ariaLabel={t("vat")}
                      value={line.taxRateId}
                      invalid={bad("taxRateId")}
                      onChange={(v) => set(index, { taxRateId: v })}
                      options={vatRates.map((r) => ({ value: r.id, label: r.name }))}
                    />
                  </td>
                  {irpf && (
                    <td className="px-1 py-1.5 text-center">
                      <Checkbox
                        aria-label={t("irpf")}
                        className="mt-2"
                        checked={line.irpfApplies}
                        onCheckedChange={(v) => set(index, { irpfApplies: v === true })}
                      />
                    </td>
                  )}
                  <td className="px-1 py-1.5">
                    <OptionSelect
                      ariaLabel={t("type")}
                      value={line.billingType}
                      onChange={(v) => set(index, { billingType: v as ImportLineForm["billingType"] })}
                      options={BILLING_TYPES.map((b) => ({ value: b, label: tType(b) }))}
                    />
                  </td>
                  <td className={cn("px-2 py-1.5 pt-3 text-right font-semibold tabular", !computed[index] && "text-muted-foreground")}>
                    {computed[index] ? money(computed[index]!.baseCents) : "—"}
                  </td>
                  <td className="py-1.5 pr-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("remove")}
                      disabled={lines.length === 1}
                      onClick={() => onChange(lines.filter((_, i) => i !== index))}
                    >
                      <Trash2 />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() =>
          onChange([
            ...lines,
            {
              key: `${idPrefix}-${Date.now().toString(36)}`,
              description: "",
              quantity: "1",
              unitPrice: "",
              discount: "",
              taxRateId: defaultRate?.id ?? "",
              irpfApplies: irpf,
              billingType: classifyLine("").billingType,
              periodStart: "",
              periodEnd: "",
            },
          ])
        }
      >
        <Plus data-icon="inline-start" />
        {t("add")}
      </Button>
    </div>
  );
}
