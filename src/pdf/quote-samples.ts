import { milestoneAmounts, type PlanItem, type QuoteCalcLine, quoteLineBaseCents, quoteTotals, type SectionTotals } from "@/app/[org]/quotes/summary";
import type { QuoteDocumentData, QuotePdfLine, QuotePdfTotals } from "./quote-types";
import { sampleSelfEmployedIssuer, sampleSpanishClient } from "./samples";

// Presupuestos de ejemplo con datos inventados, para los tests. Los importes salen del mismo
// cálculo que usa la app (src/app/[org]/quotes/summary.ts), así que cuadran como uno real.

type SampleLine = Omit<QuotePdfLine, "baseCents">;
type SampleHeader = Omit<QuoteDocumentData, "lines" | "totals" | "payments">;

const pdfTotals = (totals: SectionTotals | null): QuotePdfTotals | null =>
  totals && {
    subtotalCents: totals.subtotalCents,
    vatCents: totals.vatCents,
    totalCents: totals.totalCents,
    vatBreakdown: totals.breakdown,
  };

/** Completa bases, totales por tipo y lo que cobra cada pago del plan. */
export function buildSampleQuote(header: SampleHeader, lines: SampleLine[], plan: PlanItem[] = []): QuoteDocumentData {
  const calc: QuoteCalcLine[] = lines.map((line) => ({
    billingType: line.billingType,
    quantity: line.quantity,
    unitPriceCents: line.unitPriceCents,
    discountBps: line.discountBps,
    vatBps: line.vatBps,
    vatRegime: line.vatRegime,
  }));
  const totals = quoteTotals(calc);
  return {
    ...header,
    lines: lines.map((line) => ({ ...line, baseCents: quoteLineBaseCents(line) })),
    totals: { oneOff: pdfTotals(totals.oneOff), monthly: pdfTotals(totals.monthly), yearly: pdfTotals(totals.yearly) },
    payments: (milestoneAmounts(calc, plan) ?? []).map((payment) => ({
      label: payment.label,
      percentBps: payment.percentBps,
      when: payment.when,
      plannedOn: payment.plannedOn,
      baseCents: payment.baseCents,
      totalCents: payment.totalCents,
    })),
  };
}

const vat21 = { vatBps: 2100, vatRegime: "general" as const };

/** Web con fotos (50/50), mantenimiento y SEO mensuales, hosting anual y campañas por uso. */
export const sampleQuote = buildSampleQuote(
  {
    locale: "es",
    isDraft: false,
    number: "P2026-0007",
    title: "Web corporativa y mantenimiento",
    issuedOn: "2026-10-01",
    validUntil: "2026-10-31",
    issuer: sampleSelfEmployedIssuer,
    client: sampleSpanishClient,
    legalNotes: [],
    notes: "Incluye dos rondas de cambios sobre el diseño.",
  },
  [
    { description: "Diseño y desarrollo web", billingType: "one_off", quantity: "1", unitPriceCents: 300_000, discountBps: 0, ...vat21 },
    { description: "Sesión de fotografía", billingType: "one_off", quantity: "2", unitPriceCents: 45_000, discountBps: 1000, ...vat21 },
    { description: "Mantenimiento web", billingType: "monthly", quantity: "1", unitPriceCents: 15_000, discountBps: 0, ...vat21 },
    {
      description: "SEO local",
      billingType: "monthly",
      quantity: "1",
      unitPriceCents: 20_000,
      discountBps: 0,
      startsOn: "2026-11-01",
      ...vat21,
    },
    { description: "Hosting y dominio", billingType: "yearly", quantity: "1", unitPriceCents: 24_000, discountBps: 0, ...vat21 },
    { description: "Campaña Meta Ads", billingType: "usage", quantity: "1", unitPriceCents: 37_500, discountBps: 0, ...vat21 },
  ],
  [
    { label: "Inicio del proyecto", percentBps: 5000, when: "on_accept", plannedOn: null },
    { label: "Entrega final", percentBps: 5000, when: "on_delivery", plannedOn: null },
  ],
);

/** Muchas líneas puntuales, para ver cómo pagina. */
export function sampleLongQuote(count: number): QuoteDocumentData {
  const lines: SampleLine[] = Array.from({ length: count }, (_, index) => ({
    description: `Partida ${index + 1} del proyecto`,
    billingType: index % 5 === 4 ? "monthly" : "one_off",
    quantity: "1",
    unitPriceCents: 10_000 + index * 150,
    discountBps: 0,
    ...vat21,
  }));
  return buildSampleQuote(
    { ...sampleQuote, number: "P2026-0099" },
    lines,
    [
      { label: "Inicio", percentBps: 4000, when: "on_accept", plannedOn: null },
      { label: "Mitad", percentBps: 3000, when: "date", plannedOn: "2026-12-01" },
      { label: "Final", percentBps: 3000, when: "on_delivery", plannedOn: null },
    ],
  );
}
