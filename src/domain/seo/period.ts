// Periodos del módulo SEO. Todo son fechas civiles (YYYY-MM-DD, ambos extremos incluidos):
// Search Console da los días en su calendario y GA4 en el de la propiedad, así que aquí no hay
// instantes ni zonas horarias. El periodo termina el último día con datos (Search Console
// consolida con 2-3 días de retraso), no hoy: si no, los últimos días saldrían siempre a la baja.

import { addDays, addMonthsClamped, type CivilDate, compareCivil, daysInclusive } from "../dates/civil-date";

export type SeoPeriod = "28d" | "3m" | "12m";
/** En el orden del selector. */
export const SEO_PERIODS: readonly SeoPeriod[] = ["28d", "3m", "12m"];

/** Con qué se compara: el periodo inmediatamente anterior o el mismo del año pasado. */
export type SeoComparison = "previous" | "year";
export const SEO_COMPARISONS: readonly SeoComparison[] = ["previous", "year"];

export type DayRange = { from: CivilDate; to: CivilDate };

/** Días que se comparan con el año anterior: 52 semanas, para que coincidan los días de la semana. */
const YEAR_SHIFT_DAYS = 364;

const first = (value: unknown) => (Array.isArray(value) ? value[0] : value);

export function isSeoPeriod(value: unknown): value is SeoPeriod {
  return typeof value === "string" && (SEO_PERIODS as readonly string[]).includes(value);
}

/** `?period=`: un valor desconocido (o repetido) cae en los últimos 28 días. */
export function parseSeoPeriod(value: unknown): SeoPeriod {
  const v = first(value);
  return isSeoPeriod(v) ? v : "28d";
}

export function parseSeoComparison(value: unknown): SeoComparison {
  const v = first(value);
  return v === "year" ? "year" : "previous";
}

/** El periodo que termina en `end` (incluido): 28 días, 3 meses o 12 meses naturales. */
export function periodRange(period: SeoPeriod, end: CivilDate): DayRange {
  switch (period) {
    case "28d":
      return { from: addDays(end, -27), to: end };
    case "3m":
      return { from: addDays(addMonthsClamped(end, -3), 1), to: end };
    case "12m":
      return { from: addDays(addMonthsClamped(end, -12), 1), to: end };
  }
}

export function rangeDays(range: DayRange): number {
  return daysInclusive(range.from, range.to);
}

/**
 * El periodo con el que se compara. "Anterior" son los mismos días justo antes. "Año pasado" son
 * las mismas fechas 52 semanas antes (mismos días de la semana, que en búsquedas pesan mucho); con
 * 12 meses, el anterior ya es el año pasado.
 */
export function comparisonRange(range: DayRange, comparison: SeoComparison, period: SeoPeriod): DayRange {
  if (comparison === "previous" || period === "12m") {
    const days = rangeDays(range);
    return { from: addDays(range.from, -days), to: addDays(range.from, -1) };
  }
  return { from: addDays(range.from, -YEAR_SHIFT_DAYS), to: addDays(range.to, -YEAR_SHIFT_DAYS) };
}

export function inRange(date: CivilDate, range: DayRange): boolean {
  return compareCivil(date, range.from) >= 0 && compareCivil(date, range.to) <= 0;
}

/** Todos los días del rango, en orden. */
export function eachDay(range: DayRange): CivilDate[] {
  const days: CivilDate[] = [];
  for (let d = range.from; compareCivil(d, range.to) <= 0; d = addDays(d, 1)) days.push(d);
  return days;
}

/** El tramo de fechas con datos de una propiedad (primer y último día), si tiene alguno. */
export type DataSpan = { first: CivilDate; last: CivilDate } | null;

/** ¿Hay datos para todo el rango? Comparar con un periodo a medias engaña, así que no se hace. */
export function covers(span: DataSpan, range: DayRange): boolean {
  return span !== null && compareCivil(span.first, range.from) <= 0 && compareCivil(span.last, range.to) >= 0;
}

/**
 * Último día del periodo: el último con datos, sin pasar de ayer (hoy nunca está completo). Sin
 * datos, ayer.
 */
export function periodEnd(today: CivilDate, lastDataOn: CivilDate | null): CivilDate {
  const yesterday = addDays(today, -1);
  if (!lastDataOn) return yesterday;
  return compareCivil(lastDataOn, yesterday) < 0 ? lastDataOn : yesterday;
}

export type SeoPeriodSelection = {
  period: SeoPeriod;
  comparison: SeoComparison;
  range: DayRange;
  compare: DayRange;
  /** Si hay datos para todo el periodo de comparación (si no, las variaciones no se enseñan). */
  comparable: boolean;
  days: number;
};

/** Todo lo que la pantalla necesita saber del periodo elegido. */
export function selectPeriod(opts: {
  period: SeoPeriod;
  comparison: SeoComparison;
  today: CivilDate;
  span: DataSpan;
}): SeoPeriodSelection {
  const range = periodRange(opts.period, periodEnd(opts.today, opts.span?.last ?? null));
  const compare = comparisonRange(range, opts.comparison, opts.period);
  return {
    period: opts.period,
    comparison: opts.comparison,
    range,
    compare,
    comparable: covers(opts.span, compare),
    days: rangeDays(range),
  };
}
