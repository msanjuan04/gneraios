// Lecturas de la foto financiera (src/domain/finance, la de /finance) que comparten el CFO, la
// política, la simulación y los impuestos. Todas las cifras son las del dominio de Finanzas: aquí
// solo se eligen y se comprueba si hay datos.

import { compareCivil } from "@/domain/dates/civil-date";
import { marginBps, type FinanceSnapshot, type MonthPnl } from "@/domain/finance";
import { addMonths, monthOf, type Month } from "@/domain/metrics";
import type { FinanceData } from "../data/types";

/** Hay saldo de caja registrado (alguna cuenta activa con saldo). */
export function hasCash(finance: FinanceData | null): finance is FinanceSnapshot {
  return finance !== null && finance.cash.latestOn !== null;
}

/** Hay gastos en algún mes cerrado reciente (la ventana del burn). */
export function hasExpenses(finance: FinanceData | null): finance is FinanceSnapshot {
  return finance !== null && finance.burn !== null;
}

/** El margen de un mes, si ese mes tiene gastos registrados. */
export function monthPnl(finance: FinanceData, month: Month): MonthPnl | null {
  return finance.months.find((m) => m.month === month && m.hasExpenses) ?? null;
}

/** Los `count` meses cerrados que terminan en el mes anterior a hoy. */
export function closedMonths(today: string, count: number): Month[] {
  const last = addMonths(monthOf(today), -1);
  return Array.from({ length: count }, (_, i) => addMonths(last, -(count - 1 - i)));
}

/** IVA a ingresar y retenciones de los trimestres de la foto cuyo plazo aún no ha pasado. */
export function taxesDue(finance: FinanceData, today: string): { cents: number; quarters: string[]; from: string | null; to: string | null } {
  const due = finance.taxes.quarters.filter((q) => compareCivil(q.dueOn, today) >= 0);
  return {
    cents: due.reduce((sum, q) => sum + q.vat.payableCents + q.withholdings.totalCents, 0),
    quarters: due.map((q) => q.key),
    from: due[0]?.vat.from ?? null,
    to: due.at(-1)?.dueOn ?? null,
  };
}

/** Margen de varios meses juntos (Σ margen / Σ ingresos), con la definición de Finanzas. */
export function combinedMargin(months: readonly MonthPnl[]): { marginCents: number; revenueCents: number; bps: number | null } {
  const marginCents = months.reduce((sum, m) => sum + m.marginCents, 0);
  const revenueCents = months.reduce((sum, m) => sum + m.revenueCents, 0);
  return { marginCents, revenueCents, bps: marginBps(marginCents, revenueCents) };
}
