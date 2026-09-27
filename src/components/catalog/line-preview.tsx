"use client";

import {
  CATALOG_BILLING_TYPES,
  type CatalogBillingType,
  type CatalogLine,
  catalogLineAmounts,
  type CatalogLocale,
  catalogTotals,
  type CatalogVatRate,
} from "@/domain/catalog";
import { cn } from "@/lib/utils";
import { documentFormat } from "./format";

const SUMMARY_LABEL = { one_off: "oneOff", monthly: "monthly", yearly: "yearly", usage: "usage" } as const satisfies Record<
  CatalogBillingType,
  string
>;

/**
 * Las líneas como saldrán en un presupuesto, en el idioma del documento: el papel blanco del PDF,
 * sus columnas, sus textos y sus formatos (1.500,00 € en castellano y catalán, 1,500.00 € en
 * inglés). Con `totals`, el resumen de arriba del PDF: cada tipo por su lado, IVA incluido.
 */
export function CatalogLinePreview({
  lines,
  vatRates,
  locale,
  totals = false,
  empty,
  className,
}: {
  lines: readonly CatalogLine[];
  vatRates: readonly CatalogVatRate[];
  locale: CatalogLocale;
  totals?: boolean;
  /** Lo que se ve sin líneas. */
  empty?: string;
  className?: string;
}) {
  const f = documentFormat(locale);
  const { labels } = f;
  const rateOf = (id: string) => vatRates.find((rate) => rate.id === id);
  const showDiscount = lines.some((line) => line.discountBps > 0);
  const summary = totals ? catalogTotals(lines, vatRates) : {};

  return (
    <div lang={locale} className={cn("rounded-xl border border-black/10 bg-white p-4 text-[#04060a] shadow-sm", className)}>
      <p className="text-[10px] font-bold tracking-[0.16em] text-[#173697] uppercase">{labels.quote.document}</p>
      {lines.length === 0 ? (
        <p className="py-6 text-center text-xs text-[#04060a]/50">{empty}</p>
      ) : (
        <div className="-mx-1 mt-2 overflow-x-auto">
          <table className="w-full min-w-[30rem] border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#04060a]/80 text-[9px] font-semibold tracking-[0.12em] text-[#04060a]/55 uppercase">
                <th className="px-1 py-1.5 text-left font-semibold">{labels.lines.description}</th>
                <th className="px-1 py-1.5 text-right font-semibold">{labels.lines.quantity}</th>
                <th className="px-1 py-1.5 text-right font-semibold">{labels.lines.unitPrice}</th>
                {showDiscount && <th className="px-1 py-1.5 text-right font-semibold">{labels.lines.discount}</th>}
                <th className="px-1 py-1.5 text-right font-semibold">{labels.lines.vat}</th>
                <th className="px-1 py-1.5 text-right font-semibold">{labels.lines.base}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => {
                const rate = rateOf(line.taxRateId);
                const amounts = catalogLineAmounts(line, rate?.rateBps ?? 0);
                const detail = f.detail(line.billingType);
                return (
                  <tr key={`${line.itemId}-${index}`} className="border-b border-[#04060a]/10 align-top last:border-0">
                    <td className="px-1 py-2">
                      <p className="font-medium">{line.description}</p>
                      {detail && <p className="mt-0.5 text-[10px] text-[#04060a]/55">{detail}</p>}
                    </td>
                    <td className="px-1 py-2 text-right tabular">{f.quantity(line.quantity)}</td>
                    <td className="px-1 py-2 text-right whitespace-nowrap tabular">{f.money(line.unitPriceCents)}</td>
                    {showDiscount && (
                      <td className="px-1 py-2 text-right tabular">{line.discountBps > 0 ? f.percent(line.discountBps) : ""}</td>
                    )}
                    <td className="px-1 py-2 text-right whitespace-nowrap tabular">{rate ? f.percent(rate.rateBps) : "—"}</td>
                    <td className="px-1 py-2 text-right font-semibold whitespace-nowrap tabular">{f.perCycle(amounts.baseCents, line.billingType)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {totals && lines.length > 0 && (
        <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-2 rounded-lg bg-[#173697]/5 px-3 py-2 text-xs">
          {CATALOG_BILLING_TYPES.flatMap((type) => {
            const sum = summary[type];
            if (!sum) return [];
            return [
              <div key={type}>
                <dt className="text-[9px] font-semibold tracking-[0.12em] text-[#04060a]/55 uppercase">
                  {labels.quote.summary[SUMMARY_LABEL[type]]}
                </dt>
                <dd className="font-bold tabular">
                  {type === "usage" ? labels.quote.summary.usageValue : f.perCycle(sum.totalCents, type)}
                </dd>
              </div>,
            ];
          })}
          <p className="basis-full text-[10px] text-[#04060a]/55">{labels.quote.summary.vatIncluded}</p>
        </dl>
      )}
    </div>
  );
}
