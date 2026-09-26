// Ingresos por mes (ARCHITECTURE.md §7.8): base imponible sin IVA de las facturas emitidas,
// por el mes de su fecha de emisión (las rectificativas restan en el suyo), separada siempre en
// recurrente (monthly + yearly), uso y one-off. Nunca un total sin desglose.
//
// Las filas pueden ser líneas de factura sueltas o ya agregadas por mes y tipo (la vista
// `revenue_by_month`): la suma es la misma, así que la definición también.

import { assertCents, type Cents } from "../money";
import { monthOf, type Month } from "./months";

export type BillingType = "one_off" | "monthly" | "yearly" | "usage";

export const REVENUE_CATEGORIES = ["recurring", "usage", "oneOff"] as const;
export type RevenueCategory = (typeof REVENUE_CATEGORIES)[number];

export type RevenueRow = {
  /** Mes de emisión (primer día) o cualquier fecha de ese mes. */
  month: string;
  billingType: BillingType;
  baseCents: Cents;
};

export type MonthRevenue = {
  month: Month;
  recurringCents: Cents;
  usageCents: Cents;
  oneOffCents: Cents;
};

const FIELD: Record<RevenueCategory, "recurringCents" | "usageCents" | "oneOffCents"> = {
  recurring: "recurringCents",
  usage: "usageCents",
  oneOff: "oneOffCents",
};

/** A qué categoría de ingresos va cada tipo de facturación. */
export function revenueCategory(billingType: BillingType): RevenueCategory {
  switch (billingType) {
    case "monthly":
    case "yearly":
      return "recurring";
    case "usage":
      return "usage";
    case "one_off":
      return "oneOff";
  }
}

export function revenueOf(revenue: MonthRevenue, category: RevenueCategory): Cents {
  return revenue[FIELD[category]];
}

/** Suma de las tres categorías: solo para mostrarla junto a su desglose. */
export function revenueTotal(revenue: MonthRevenue): Cents {
  return revenue.recurringCents + revenue.usageCents + revenue.oneOffCents;
}

export function emptyRevenue(month: Month): MonthRevenue {
  return { month, recurringCents: 0, usageCents: 0, oneOffCents: 0 };
}

/** Ingresos de cada mes pedido (con ceros donde no hay facturas), en el orden de `months`. */
export function revenueByMonth(rows: readonly RevenueRow[], months: readonly Month[]): MonthRevenue[] {
  const byMonth = new Map(months.map((m) => [m, emptyRevenue(m)]));
  for (const row of rows) {
    const target = byMonth.get(monthOf(row.month));
    if (!target) continue;
    const field = FIELD[revenueCategory(row.billingType)];
    target[field] = assertCents(target[field] + assertCents(row.baseCents));
  }
  return months.map((m) => byMonth.get(m)!);
}

/** Variación relativa (0,12 = +12 %); null si no hay con qué comparar (el anterior es 0). */
export function changeRatio(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}
