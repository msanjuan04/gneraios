// El mes de un informe. En la URL va como "2026-08"; dentro, como su primer día ("2026-08-01"),
// igual que los meses de las métricas (src/domain/metrics/months.ts).

import { compareCivil, type CivilDate } from "../dates/civil-date";
import { fromDateTimeLocal } from "../dates/zoned-time";
import { addMonths, isMonth, monthEnd, monthOf, type Month } from "../metrics/months";
import type { DayRange } from "../seo/period";

const MONTH_PARAM = /^(\d{4})-(\d{2})$/;

/** Meses que ofrece la tarjeta de la ficha del cliente. */
export const REPORT_MONTHS_OFFERED = 12;

/** "2026-08" → "2026-08-01". null si no es un mes que exista. */
export function parseReportMonth(value: unknown): Month | null {
  if (typeof value !== "string") return null;
  const match = MONTH_PARAM.exec(value.trim());
  if (!match) return null;
  const month = `${match[1]}-${match[2]}-01`;
  return isMonth(month) ? month : null;
}

/** "2026-08-01" → "2026-08" (la URL y el nombre del fichero). */
export function reportMonthParam(month: Month): string {
  return month.slice(0, 7);
}

/** Se puede pedir el informe de cualquier mes ya empezado (el en curso sale como tal). */
export function isReportableMonth(month: Month, today: CivilDate): boolean {
  return isMonth(month) && compareCivil(month, monthOf(today)) <= 0;
}

/** Los meses que se ofrecen: los `count` últimos ya cerrados, del más reciente (el pasado) al más antiguo. */
export function recentReportMonths(today: CivilDate, count = REPORT_MONTHS_OFFERED): Month[] {
  const last = addMonths(monthOf(today), -1);
  return Array.from({ length: Math.max(0, count) }, (_, index) => addMonths(last, -index));
}

/** El mes que se propone: el pasado. */
export function defaultReportMonth(today: CivilDate): Month {
  return addMonths(monthOf(today), -1);
}

/** Los días del mes (ambos incluidos). */
export function monthDays(month: Month): DayRange {
  return { from: month, to: monthEnd(month) };
}

/**
 * Los instantes que acotan el mes en la zona de la org: desde su primer minuto (incluido) hasta
 * el primero del mes siguiente (excluido). Para filtrar columnas timestamptz en la base.
 */
export function monthInstants(month: Month, timeZone: string): { from: string; to: string } {
  const start = fromDateTimeLocal(`${month}T00:00`, timeZone);
  const end = fromDateTimeLocal(`${addMonths(month, 1)}T00:00`, timeZone);
  if (!start || !end) throw new Error(`Mes no válido: ${month}`);
  return { from: start.toISOString(), to: end.toISOString() };
}

/** ¿Cae la fecha en el mes? */
export function inMonth(date: CivilDate, month: Month): boolean {
  return monthOf(date) === month;
}
