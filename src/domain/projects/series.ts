// Series del resumen de un proyecto: horas por semana (con el acumulado, para el consumo del
// presupuesto) y facturado frente a horas por mes. Semanas de lunes a domingo, en fechas civiles.

import { addDays, compareCivil, parseCivilDate, type CivilDate } from "../dates/civil-date";
import { monthOf, monthRange, type Month } from "../metrics/months";
import type { Cents } from "../money";
import { effectiveRateCents, scaleCents } from "./economics";

export type TimeRow = { workedOn: CivilDate; minutes: number };
export type RevenueRow = { issuedOn: CivilDate; baseCents: Cents };

/** Lunes de la semana de una fecha. */
export function weekStart(date: CivilDate): CivilDate {
  const { year, month, day } = parseCivilDate(date);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0 = domingo
  return addDays(date, -((weekday + 6) % 7));
}

/** Domingo de la semana de una fecha. */
export function weekEnd(date: CivilDate): CivilDate {
  return addDays(weekStart(date), 6);
}

/** Los lunes de las semanas que tocan el rango, en orden. */
export function weekRange(from: CivilDate, to: CivilDate): CivilDate[] {
  const weeks: CivilDate[] = [];
  const last = weekStart(to);
  for (let week = weekStart(from); compareCivil(week, last) <= 0; week = addDays(week, 7)) weeks.push(week);
  return weeks;
}

/** Suma por clave: minutos por miembro, por semana, por tarea… */
export function sumBy<T, K>(rows: readonly T[], key: (row: T) => K, value: (row: T) => number): Map<K, number> {
  const out = new Map<K, number>();
  for (const row of rows) out.set(key(row), (out.get(key(row)) ?? 0) + value(row));
  return out;
}

export type WeekPoint = { week: CivilDate; minutes: number; cumulativeMinutes: number };

/**
 * Horas por semana entre `from` y `to`. El acumulado arranca con lo registrado antes de `from`, así
 * que la última semana acumula todo lo registrado hasta `to` (para compararlo con el presupuesto).
 */
export function weeklySeries(entries: readonly TimeRow[], from: CivilDate, to: CivilDate): WeekPoint[] {
  const weeks = weekRange(from, to);
  const first = weeks[0];
  const last = weeks.at(-1);
  if (!first || !last) return [];
  let cumulative = 0;
  const byWeek = new Map<CivilDate, number>();
  for (const entry of entries) {
    const week = weekStart(entry.workedOn);
    if (compareCivil(week, first) < 0) cumulative += entry.minutes;
    else if (compareCivil(week, last) <= 0) byWeek.set(week, (byWeek.get(week) ?? 0) + entry.minutes);
  }
  return weeks.map((week) => {
    const minutes = byWeek.get(week) ?? 0;
    cumulative += minutes;
    return { week, minutes, cumulativeMinutes: cumulative };
  });
}

export type MonthPoint = {
  month: Month;
  revenueCents: Cents;
  minutes: number;
  cumulativeRevenueCents: Cents;
  cumulativeMinutes: number;
  /** Lo que valen las horas acumuladas a la tarifa objetivo: si lo facturado va por encima, se gana más que el objetivo. */
  cumulativeTargetCents: Cents;
  /** Tarifa efectiva acumulada hasta ese mes. */
  cumulativeRateCents: Cents | null;
};

/**
 * Facturado frente a horas, mes a mes. `share` reparte lo facturado de un contrato compartido con
 * otros proyectos (la parte de este, por horas): se aplica al acumulado, así que la serie termina
 * exactamente en la parte del proyecto.
 */
export function monthlyEconomics(
  revenue: readonly RevenueRow[],
  entries: readonly TimeRow[],
  range: { from: CivilDate; to: CivilDate },
  targetCents: Cents,
  share: { numerator: number; denominator: number } | null = null,
): MonthPoint[] {
  const months = monthRange(monthOf(range.from), monthOf(range.to));
  const first = months[0];
  const last = months.at(-1);
  if (!first || !last) return [];

  const bucket = (date: CivilDate): Month | "before" | "after" => {
    const month = monthOf(date);
    return compareCivil(month, first) < 0 ? "before" : compareCivil(month, last) > 0 ? "after" : month;
  };
  let revenueBase = 0;
  let minutesBase = 0;
  const revenueByMonth = new Map<Month, Cents>();
  const minutesByMonth = new Map<Month, number>();
  for (const row of revenue) {
    const b = bucket(row.issuedOn);
    if (b === "before") revenueBase += row.baseCents;
    else if (b !== "after") revenueByMonth.set(b, (revenueByMonth.get(b) ?? 0) + row.baseCents);
  }
  for (const row of entries) {
    const b = bucket(row.workedOn);
    if (b === "before") minutesBase += row.minutes;
    else if (b !== "after") minutesByMonth.set(b, (minutesByMonth.get(b) ?? 0) + row.minutes);
  }

  const scale = (cents: Cents) => (share && share.denominator > 0 ? scaleCents(cents, share.numerator, share.denominator) : cents);
  let contractRevenue = revenueBase;
  let minutes = minutesBase;
  let previous = scale(revenueBase);
  return months.map((month) => {
    contractRevenue += revenueByMonth.get(month) ?? 0;
    const monthMinutes = minutesByMonth.get(month) ?? 0;
    minutes += monthMinutes;
    const cumulativeRevenueCents = scale(contractRevenue);
    const point: MonthPoint = {
      month,
      revenueCents: cumulativeRevenueCents - previous,
      minutes: monthMinutes,
      cumulativeRevenueCents,
      cumulativeMinutes: minutes,
      cumulativeTargetCents: scaleCents(targetCents, minutes, 60),
      cumulativeRateCents: effectiveRateCents(cumulativeRevenueCents, minutes),
    };
    previous = cumulativeRevenueCents;
    return point;
  });
}
