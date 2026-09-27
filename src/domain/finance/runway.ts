// Burn, costes fijos y runway (definición v1). Son medias de meses CERRADOS: el mes en curso
// está a medias y bajaría la media.
//
// - Ventana: los últimos BURN_WINDOW_MONTHS meses cerrados que tienen algún gasto registrado
//   (un mes sin ningún gasto es un mes sin datos, no un mes sin costes).
// - Burn: media mensual del coste de los gastos de la ventana. También la de ingresos y margen
//   de esos mismos meses, y el burn neto: lo que se gasta por encima de lo que se ingresa.
// - Costes fijos: media mensual del coste de las categorías fijas en la ventana. Sin datos, el
//   coste mensual equivalente de las suscripciones activas de categorías fijas.
// - Runway: meses de costes fijos que cubre la caja (con un decimal). Sin costes fijos no hay
//   runway que medir (null); con la caja a cero o en negativo, 0.

import { monthsEndingAt, previousMonth, type Month } from "../metrics/months";
import { assertCents, divRoundHalfAwayFromZero, type Cents } from "../money";
import type { CivilDate } from "../dates/civil-date";
import type { MonthPnl } from "./pnl";

export const FINANCE_DEFINITION_VERSION = 1;
export const BURN_WINDOW_MONTHS = 3;

export type Burn = {
  /** Meses que entran en la media (cerrados y con gastos), en orden. */
  months: Month[];
  expensesCents: Cents;
  fixedCents: Cents;
  revenueCents: Cents;
  marginCents: Cents;
  /** Lo que se consume por encima de los ingresos: max(0, −margen medio). */
  netBurnCents: Cents;
};

export type FixedCosts = {
  monthlyCents: Cents;
  source: "history" | "subscriptions" | "none";
};

/** Los `count` meses cerrados anteriores al de `today` (el último, el mes pasado). */
export function closedMonths(today: CivilDate, count: number): Month[] {
  return monthsEndingAt(previousMonth(today), count);
}

function average(values: readonly Cents[]): Cents {
  if (values.length === 0) return 0;
  const sum = values.reduce((acc, value) => acc + BigInt(assertCents(value)), BigInt(0));
  return Number(divRoundHalfAwayFromZero(sum, BigInt(values.length)));
}

/**
 * Medias de la ventana: de los meses cerrados de `pnl` anteriores a `today`, los últimos
 * BURN_WINDOW_MONTHS con algún gasto (buscando como mucho en el último año). null si no hay ninguno.
 */
export function burn(pnl: readonly MonthPnl[], today: CivilDate, windowMonths = BURN_WINDOW_MONTHS): Burn | null {
  const closed = new Set(closedMonths(today, 12));
  const window = pnl
    .filter((m) => closed.has(m.month) && m.hasExpenses)
    .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0))
    .slice(-windowMonths);
  if (window.length === 0) return null;
  const marginCents = average(window.map((m) => m.marginCents));
  return {
    months: window.map((m) => m.month),
    expensesCents: average(window.map((m) => m.expensesCents)),
    fixedCents: average(window.map((m) => m.fixedCents)),
    revenueCents: average(window.map((m) => m.revenueCents)),
    marginCents,
    netBurnCents: Math.max(0, -marginCents),
  };
}

/** Costes fijos mensuales: los de la historia si los hay; si no, los de las suscripciones fijas activas. */
export function fixedCosts(history: Burn | null, subscriptionsMonthlyCents: Cents): FixedCosts {
  if (history && history.fixedCents > 0) return { monthlyCents: history.fixedCents, source: "history" };
  if (subscriptionsMonthlyCents > 0) return { monthlyCents: assertCents(subscriptionsMonthlyCents), source: "subscriptions" };
  return { monthlyCents: 0, source: "none" };
}

/** Meses de costes fijos que cubre la caja, con un decimal (redondeo half away from zero). */
export function runwayMonths(cashCents: Cents, fixedMonthlyCents: Cents): number | null {
  assertCents(cashCents);
  if (assertCents(fixedMonthlyCents) <= 0) return null;
  if (cashCents <= 0) return 0;
  return Number(divRoundHalfAwayFromZero(BigInt(cashCents) * BigInt(10), BigInt(fixedMonthlyCents))) / 10;
}
