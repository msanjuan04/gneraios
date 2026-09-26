"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { computeInvoiceTotals } from "@/domain/tax";
import { cn } from "@/lib/utils";
import { useInvoiceFormat } from "./format";
import type { BillingType, VatRegime } from "./types";

export type TotalsLine = {
  baseCents: number;
  vatCents: number;
  irpfCents: number;
  vatBps: number;
  vatRegime: VatRegime;
  billingType: BillingType | null;
};

const TYPE_ORDER: BillingType[] = ["monthly", "yearly", "usage", "one_off"];

function Row({ label, hint, value, strong, className }: { label: ReactNode; hint?: ReactNode; value: ReactNode; strong?: boolean; className?: string }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3", className)}>
      <dt className={cn("min-w-0", strong ? "font-bold" : "text-muted-foreground")}>
        {label}
        {hint && <span className="block text-[11px] font-normal text-muted-foreground">{hint}</span>}
      </dt>
      <dd className={cn("shrink-0 text-right tabular", strong ? "text-lg font-extrabold" : "font-semibold")}>{value}</dd>
    </div>
  );
}

/**
 * Totales de una factura como los imprime el PDF: base imponible (sin IVA), IVA desglosado por
 * tipo y régimen, retención de IRPF y total a cobrar (con IVA). La base se desglosa también por
 * tipo de facturación, para que lo recurrente, el uso y lo puntual no se mezclen nunca.
 */
export function InvoiceTotals({
  lines,
  irpfBps,
  legalNotes,
  pendingLines = 0,
  children,
}: {
  lines: TotalsLine[];
  irpfBps: number;
  legalNotes: string[];
  /** Líneas con importes por completar que aún no cuentan (solo en el editor). */
  pendingLines?: number;
  children?: ReactNode;
}) {
  const t = useTranslations("invoices.totals");
  const tType = useTranslations("billing.billingType");
  const tRegime = useTranslations("billing.vatRegime");
  const { money, percent } = useInvoiceFormat();
  const totals = computeInvoiceTotals(lines);

  const byType = new Map<BillingType, number>();
  for (const line of lines) {
    if (!line.billingType) continue;
    byType.set(line.billingType, (byType.get(line.billingType) ?? 0) + line.baseCents);
  }
  const types = TYPE_ORDER.filter((type) => byType.has(type));

  return (
    <div className="space-y-4 text-sm">
      {lines.length === 0 ? (
        <p className="text-muted-foreground">{t("empty")}</p>
      ) : (
        <dl className="space-y-2">
          <Row label={t("base")} hint={t("baseHint")} value={money(totals.subtotalCents)} />
          {totals.breakdown.map((row) => (
            <Row
              key={`${row.vatBps}:${row.vatRegime}`}
              label={
                row.vatRegime === "general"
                  ? t("vat", { rate: percent(row.vatBps) })
                  : t("vatRegime", { regime: tRegime(row.vatRegime) })
              }
              hint={t("vatOn", { base: money(row.baseCents) })}
              value={money(row.vatCents)}
            />
          ))}
          {totals.irpfCents !== 0 && (
            <Row label={t("irpf", { rate: percent(irpfBps) })} value={money(-totals.irpfCents)} />
          )}
          <div className="border-t pt-2">
            <Row label={t("total")} hint={t("totalHint")} value={money(totals.totalCents)} strong />
          </div>
        </dl>
      )}

      {pendingLines > 0 && <p className="text-xs text-warning">{t("pendingLines", { count: pendingLines })}</p>}

      {types.length > 0 && (
        <div>
          <p className="mb-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{t("byType")}</p>
          <dl className="space-y-1">
            {types.map((type) => (
              <div key={type} className="flex items-baseline justify-between gap-3 text-xs">
                <dt className="text-muted-foreground">{tType(type)}</dt>
                <dd className="font-medium tabular">{money(byType.get(type) ?? 0)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {legalNotes.length > 0 && (
        <div>
          <p className="mb-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{t("legalNotes")}</p>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {legalNotes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      )}
      {children}
    </div>
  );
}
