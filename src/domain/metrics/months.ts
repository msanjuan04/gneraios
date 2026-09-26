// Meses de las métricas. Un mes se identifica por su primer día (`YYYY-MM-01`), como la columna
// `metrics_snapshots.month`. Aritmética entera sobre fechas civiles, sin zonas horarias.

import { addDays, addMonthsClamped, compareCivil, daysInMonth, parseCivilDate, type CivilDate } from "../dates/civil-date";

/** Primer día de un mes: `2026-09-01`. */
export type Month = CivilDate;

const MONTH = /^\d{4}-\d{2}-01$/;

export function isMonth(value: string): value is Month {
  if (!MONTH.test(value)) return false;
  try {
    parseCivilDate(value);
    return true;
  } catch {
    return false;
  }
}

/** Devuelve `value` como mes, o lanza si no es el primer día de un mes. */
export function assertMonth(value: string): Month {
  if (!isMonth(value)) throw new Error(`No es el primer día de un mes: ${value}`);
  return value;
}

/** El mes de una fecha: `2026-09-26` → `2026-09-01`. */
export function monthOf(date: CivilDate): Month {
  const { year, month } = parseCivilDate(date);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`;
}

/** Último día del mes: `2026-02-01` → `2026-02-28`. */
export function monthEnd(month: Month): CivilDate {
  const { year, month: m } = parseCivilDate(assertMonth(month));
  return addDays(month, daysInMonth(year, m) - 1);
}

/** El mes `count` meses después (o antes, si es negativo). */
export function addMonths(month: Month, count: number): Month {
  return addMonthsClamped(assertMonth(month), count);
}

/** El mes anterior al de `date` (el que se cierra el día 1). */
export function previousMonth(date: CivilDate): Month {
  return addMonths(monthOf(date), -1);
}

/** Meses de `from` a `to`, ambos incluidos y en orden. Vacío si `to` es anterior. */
export function monthRange(from: Month, to: Month): Month[] {
  const months: Month[] = [];
  for (let m = assertMonth(from); compareCivil(m, assertMonth(to)) <= 0; m = addMonths(m, 1)) months.push(m);
  return months;
}

/** Los `count` meses que terminan en `last` (incluido), en orden. */
export function monthsEndingAt(last: Month, count: number): Month[] {
  if (!Number.isInteger(count) || count < 1) throw new Error(`Número de meses no válido: ${String(count)}`);
  return monthRange(addMonths(last, -(count - 1)), last);
}

/**
 * Fecha de corte de un mes visto desde `today`: su último día si ya ha cerrado, o `today` si
 * es el mes en curso. Un mes futuro no tiene corte (lanza).
 */
export function monthCutoff(month: Month, today: CivilDate): { asOf: CivilDate; closed: boolean } {
  const end = monthEnd(month);
  if (compareCivil(end, today) < 0) return { asOf: end, closed: true };
  if (compareCivil(month, today) <= 0) return { asOf: today, closed: false };
  throw new Error(`El mes ${month} todavía no ha empezado (hoy es ${today}).`);
}
