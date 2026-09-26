import { splitByMilestones } from "@/domain/billing/milestones";
import { addDays, type CivilDate, parseCivilDate } from "@/domain/dates/civil-date";
import { lineBaseCents } from "@/domain/metrics/mrr";
import type { Bps, Cents } from "@/domain/money";
import { computeInvoiceTotals, computeLine, type VatBreakdownRow, type VatRegime } from "@/domain/tax";

/**
 * Cifras de un presupuesto (ARCHITECTURE.md §6.3, §7.3, §9.3): la base de cada línea, los
 * totales por tipo —lo puntual, lo mensual y lo anual nunca se suman entre sí— y lo que factura
 * cada pago del plan. Puro (sin servidor ni React), con la única implementación del redondeo
 * (src/domain): lo usan el editor (totales en vivo), el servidor (bases al guardar, datos del
 * PDF) y los tests.
 */

export type QuoteBillingType = "one_off" | "monthly" | "yearly" | "usage";
/** En el orden de las secciones del editor y del PDF. */
export const QUOTE_BILLING_TYPES = ["one_off", "monthly", "yearly", "usage"] as const satisfies readonly QuoteBillingType[];

export type PlanWhen = "on_accept" | "on_delivery" | "date";
export const PLAN_WHEN = ["on_accept", "on_delivery", "date"] as const satisfies readonly PlanWhen[];
export const MAX_PLAN_ITEMS = 20;

/** Un pago del plan: `plannedOn` solo (y siempre) en los de fecha. */
export type PlanItem = { label: string; percentBps: Bps; when: PlanWhen; plannedOn: CivilDate | null };

/** Lo que hace falta de una línea para sus importes. */
export type QuoteCalcLine = {
  billingType: QuoteBillingType;
  quantity: string | number;
  unitPriceCents: Cents;
  discountBps: Bps;
  vatBps: Bps;
  vatRegime: VatRegime;
};

/** Base de un ciclo (o de un uso): cantidad × precio − descuento. Es lo que guarda quote_lines.base_cents. */
export function quoteLineBaseCents(line: Pick<QuoteCalcLine, "quantity" | "unitPriceCents" | "discountBps">): Cents {
  return lineBaseCents(line);
}

export type SectionTotals = {
  subtotalCents: Cents;
  vatCents: Cents;
  /** Base + IVA. Sin IRPF: un presupuesto enseña precios; la retención va en cada factura. */
  totalCents: Cents;
  breakdown: VatBreakdownRow[];
};

/** Totales de un grupo de líneas del mismo tipo, o null si no hay ninguna. */
export function sectionTotals(lines: readonly QuoteCalcLine[]): SectionTotals | null {
  if (lines.length === 0) return null;
  const totals = computeInvoiceTotals(
    lines.map((line) => {
      const amounts = computeLine({ ...line, irpfBps: 0, irpfApplies: false });
      return { baseCents: amounts.baseCents, vatCents: amounts.vatCents, irpfCents: 0, vatBps: line.vatBps, vatRegime: line.vatRegime };
    }),
  );
  return { subtotalCents: totals.subtotalCents, vatCents: totals.vatCents, totalCents: totals.totalCents, breakdown: totals.breakdown };
}

export type QuoteTotals = {
  oneOff: SectionTotals | null;
  /** Por mes. */
  monthly: SectionTotals | null;
  /** Por año. */
  yearly: SectionTotals | null;
  /** Las de uso no tienen total: se facturan según lo que se use. */
  usageCount: number;
};

export function quoteTotals(lines: readonly QuoteCalcLine[]): QuoteTotals {
  const of = (type: QuoteBillingType) => sectionTotals(lines.filter((line) => line.billingType === type));
  return {
    oneOff: of("one_off"),
    monthly: of("monthly"),
    yearly: of("yearly"),
    usageCount: lines.filter((line) => line.billingType === "usage").length,
  };
}

/** Claves de i18n (hoja) de un plan de pagos que no vale. */
export type PlanError = "planRequired" | "planInvalid" | "planOrder" | "planTotal";

function isCivil(value: string | null): boolean {
  if (value === null || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  try {
    parseCivilDate(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Gemela TS de private.quote_plan_error (supabase/migrations/…_presupuestos.sql): null si el
 * plan vale. Cada pago lleva etiqueta, un porcentaje entero de puntos básicos (1-10 000) y
 * cuándo; «a la aceptación» solo puede ser el primero. Con líneas puntuales hace falta un plan,
 * y cualquier plan suma exactamente el 100 %.
 */
export function paymentPlanError(plan: readonly PlanItem[], hasOneOff: boolean): PlanError | null {
  if (plan.length > MAX_PLAN_ITEMS) return "planInvalid";
  let total = 0;
  for (const [index, item] of plan.entries()) {
    const label = [...item.label.trim()].length;
    const validPercent = Number.isSafeInteger(item.percentBps) && item.percentBps >= 1 && item.percentBps <= 10_000;
    const validDate = item.when === "date" ? isCivil(item.plannedOn) : item.plannedOn === null;
    if (label < 1 || label > 120 || !validPercent || !PLAN_WHEN.includes(item.when) || !validDate) return "planInvalid";
    if (item.when === "on_accept" && index > 0) return "planOrder";
    total += item.percentBps;
  }
  if (plan.length === 0) return hasOneOff ? "planRequired" : null;
  return total === 10_000 ? null : "planTotal";
}

export type MilestoneAmount = PlanItem & { baseCents: Cents; vatCents: Cents; totalCents: Cents };

/**
 * Lo que cobrará cada pago del plan: la base de cada línea puntual repartida con
 * splitByMilestones (el último pago se lleva el resto, así que cuadra al céntimo) y su IVA,
 * calculado como en la factura del hito (una línea por cada línea puntual, con su parte).
 * null si el plan no vale o no hay nada puntual.
 */
export function milestoneAmounts(oneOffLines: readonly QuoteCalcLine[], plan: readonly PlanItem[]): MilestoneAmount[] | null {
  const lines = oneOffLines
    .filter((line) => line.billingType === "one_off")
    .map((line, index) => ({ id: `line-${index}`, baseCents: quoteLineBaseCents(line), vatBps: line.vatBps }));
  if (lines.length === 0 || plan.length === 0 || paymentPlanError(plan, true) !== null) return null;
  const shares = splitByMilestones(
    lines.map(({ id, baseCents }) => ({ id, baseCents })),
    plan.map((item, index) => ({ id: `milestone-${index}`, percentBps: item.percentBps })),
  );
  return plan.map((item, index) => {
    let baseCents = 0;
    let vatCents = 0;
    for (const line of lines) {
      const share = shares[`milestone-${index}`]?.[line.id] ?? 0;
      baseCents += share;
      vatCents += computeLine({ quantity: 1, unitPriceCents: share, discountBps: 0, vatBps: line.vatBps, irpfBps: 0, irpfApplies: false }).vatCents;
    }
    return { ...item, baseCents, vatCents, totalCents: baseCents + vatCents };
  });
}

/** Planes habituales. Las etiquetas salen del catálogo del PDF, en el idioma del presupuesto. */
export type PlanPreset = "full" | "half" | "thirds";
export type PlanPresetLabel = "full" | "start" | "midway" | "delivery";
export const PLAN_PRESETS: Record<PlanPreset, { label: PlanPresetLabel; percentBps: Bps; when: PlanWhen }[]> = {
  full: [{ label: "full", percentBps: 10_000, when: "on_accept" }],
  half: [
    { label: "start", percentBps: 5_000, when: "on_accept" },
    { label: "delivery", percentBps: 5_000, when: "on_delivery" },
  ],
  thirds: [
    { label: "start", percentBps: 4_000, when: "on_accept" },
    { label: "midway", percentBps: 3_000, when: "on_delivery" },
    { label: "delivery", percentBps: 3_000, when: "on_delivery" },
  ],
};

/** Validez por defecto (días), la misma que usa private.quote_validity_days. */
export const DEFAULT_QUOTE_VALIDITY_DAYS = 30;

/** `orgs.settings.quote_validity_days` (1-365); si falta o no vale, 30. */
export function quoteValidityDays(settings: unknown): number {
  const value = (settings as Record<string, unknown> | null)?.quote_validity_days;
  return typeof value === "number" && value >= 1 && value <= 365 ? Math.round(value) : DEFAULT_QUOTE_VALIDITY_DAYS;
}

/**
 * Fechas que lleva (o llevará) el presupuesto: las guardadas o, en un borrador, las que se
 * fijarán al enviarlo hoy (la fecha de hoy y la validez de la org).
 */
export function effectiveDates(
  issuedOn: CivilDate | null,
  validUntil: CivilDate | null,
  today: CivilDate,
  validityDays: number,
): { issuedOn: CivilDate; validUntil: CivilDate } {
  const on = issuedOn ?? today;
  return { issuedOn: on, validUntil: validUntil ?? addDays(on, validityDays) };
}
