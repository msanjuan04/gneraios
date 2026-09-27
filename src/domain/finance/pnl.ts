// Margen por mes (definición v1 de FINANCE_DEFINITION_VERSION): ingresos − costes del mes.
//
// - Ingresos: la misma definición que el dashboard (src/domain/metrics/revenue.ts): base
//   imponible sin IVA de las facturas emitidas en el mes (las rectificativas restan en el suyo),
//   separada en recurrente, uso y one-off.
// - Costes: lo que cuestan los gastos con fecha de factura en el mes (base + IVA no deducible,
//   ver expenseCostCents), por grupo y separando los fijos.
// - Margen = ingresos − costes; su porcentaje, sobre los ingresos (null si no hay ingresos).

import { monthOf, type Month } from "../metrics/months";
import { revenueByMonth, revenueTotal, type MonthRevenue, type RevenueRow } from "../metrics/revenue";
import { assertCents, divRoundHalfAwayFromZero, type Cents } from "../money";
import { EXPENSE_GROUPS, type ExpenseGroup } from "./expense";

/** Coste de los gastos de un mes, agregado por grupo (la vista `expenses_by_month` o gastos sueltos). */
export type ExpenseMonthRow = {
  /** Mes de la factura (primer día) o cualquier fecha de ese mes. */
  month: string;
  expenseGroup: ExpenseGroup;
  isFixed: boolean;
  costCents: Cents;
};

export type MonthPnl = {
  month: Month;
  /** Ingresos del mes por tipo (base, sin IVA). */
  revenue: MonthRevenue;
  /** Suma de los tres tipos: solo para mostrarla junto a su desglose. */
  revenueCents: Cents;
  /** Coste de los gastos del mes. */
  expensesCents: Cents;
  /** La parte de categorías fijas. */
  fixedCents: Cents;
  byGroup: Record<ExpenseGroup, Cents>;
  marginCents: Cents;
  /** Margen sobre ingresos en puntos básicos (2500 = 25 %); null si los ingresos no son positivos. */
  marginBps: number | null;
  /** ¿Hay algún gasto registrado este mes? Sin ninguno, el margen no dice nada de los costes. */
  hasExpenses: boolean;
};

export function emptyGroups(): Record<ExpenseGroup, Cents> {
  return Object.fromEntries(EXPENSE_GROUPS.map((group) => [group, 0])) as Record<ExpenseGroup, Cents>;
}

/** Margen sobre ingresos en puntos básicos, redondeado half away from zero. */
export function marginBps(marginCents: Cents, revenueCents: Cents): number | null {
  if (revenueCents <= 0) return null;
  return Number(divRoundHalfAwayFromZero(BigInt(marginCents) * BigInt(10_000), BigInt(revenueCents)));
}

/** Ingresos, costes y margen de cada mes pedido (con ceros donde no hay datos), en el orden de `months`. */
export function monthlyPnl(
  revenueRows: readonly RevenueRow[],
  expenseRows: readonly ExpenseMonthRow[],
  months: readonly Month[],
): MonthPnl[] {
  const revenue = revenueByMonth(revenueRows, months);
  const costs = new Map(months.map((month) => [month, { groups: emptyGroups(), fixed: 0, count: 0 }]));
  for (const row of expenseRows) {
    const bucket = costs.get(monthOf(row.month));
    if (!bucket) continue;
    bucket.groups[row.expenseGroup] = assertCents(bucket.groups[row.expenseGroup] + assertCents(row.costCents));
    if (row.isFixed) bucket.fixed = assertCents(bucket.fixed + row.costCents);
    bucket.count += 1;
  }
  return months.map((month, index) => {
    const bucket = costs.get(month)!;
    const monthRevenue = revenue[index]!;
    const revenueCents = revenueTotal(monthRevenue);
    const expensesCents = Object.values(bucket.groups).reduce((sum, cents) => assertCents(sum + cents), 0);
    const marginCents = assertCents(revenueCents - expensesCents);
    return {
      month,
      revenue: monthRevenue,
      revenueCents,
      expensesCents,
      fixedCents: bucket.fixed,
      byGroup: bucket.groups,
      marginCents,
      marginBps: marginBps(marginCents, revenueCents),
      hasExpenses: bucket.count > 0,
    };
  });
}
