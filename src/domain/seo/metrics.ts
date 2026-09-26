// Métricas de un periodo a partir de los hechos diarios. Definiciones:
// - Clics, impresiones, sesiones y conversiones se suman.
// - El CTR de un periodo es clics / impresiones del periodo (nunca la media de los CTR diarios).
// - La posición media es la de cada día ponderada por sus impresiones, como hace Search Console.
// - Un día sin fila es un día sin datos: cuenta como cero en las series (Search Console no
//   devuelve los días sin impresiones).

import type { CivilDate } from "../dates/civil-date";
import { type DayRange, eachDay, inRange } from "./period";

export type SearchDay = { date: CivilDate; clicks: number; impressions: number; position: number | null };
export type WebDay = { date: CivilDate; sessions: number; users: number; engagedSessions: number; conversions: number };

export type SearchTotals = {
  clicks: number;
  impressions: number;
  /** 0..1; null sin impresiones. */
  ctr: number | null;
  position: number | null;
};

export type WebTotals = {
  sessions: number;
  engagedSessions: number;
  conversions: number;
  /** Sesiones con interacción / sesiones, 0..1. */
  engagementRate: number | null;
  /** Conversiones / sesiones, 0..1. */
  conversionRate: number | null;
};

export const ratio = (numerator: number, denominator: number): number | null =>
  denominator > 0 ? numerator / denominator : null;

export function searchTotals(days: readonly SearchDay[], range: DayRange): SearchTotals {
  let clicks = 0;
  let impressions = 0;
  let weighted = 0;
  let weight = 0;
  for (const day of days) {
    if (!inRange(day.date, range)) continue;
    clicks += day.clicks;
    impressions += day.impressions;
    if (day.position !== null && day.impressions > 0) {
      weighted += day.position * day.impressions;
      weight += day.impressions;
    }
  }
  return { clicks, impressions, ctr: ratio(clicks, impressions), position: weight > 0 ? weighted / weight : null };
}

export function webTotals(days: readonly WebDay[], range: DayRange): WebTotals {
  let sessions = 0;
  let engaged = 0;
  let conversions = 0;
  for (const day of days) {
    if (!inRange(day.date, range)) continue;
    sessions += day.sessions;
    engaged += day.engagedSessions;
    conversions += day.conversions;
  }
  return {
    sessions,
    engagedSessions: engaged,
    conversions,
    engagementRate: ratio(engaged, sessions),
    conversionRate: ratio(conversions, sessions),
  };
}

/** Variación relativa (0,12 = +12 %). null si no hay base con la que comparar. */
export function relativeChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous <= 0) return null;
  return (current - previous) / previous;
}

/** Posiciones ganadas: positivo es subir (de la 8 a la 5 son +3). */
export function positionGain(current: number | null, previous: number | null): number | null {
  return current === null || previous === null ? null : previous - current;
}

/** Diferencia en puntos porcentuales entre dos ratios (0,031 − 0,025 = +0,6 pp → 0,006). */
export function ratioDiff(current: number | null, previous: number | null): number | null {
  return current === null || previous === null ? null : current - previous;
}

export type SearchMetric = "clicks" | "impressions" | "ctr" | "position";
export type WebMetric = "sessions" | "conversions" | "engagementRate";

/** Todos los días del rango, con cero donde no hay fila. */
export function fillSearchDays(days: readonly SearchDay[], range: DayRange): SearchDay[] {
  const byDate = new Map(days.map((d) => [d.date, d]));
  return eachDay(range).map((date) => byDate.get(date) ?? { date, clicks: 0, impressions: 0, position: null });
}

export function fillWebDays(days: readonly WebDay[], range: DayRange): WebDay[] {
  const byDate = new Map(days.map((d) => [d.date, d]));
  return eachDay(range).map(
    (date) => byDate.get(date) ?? { date, sessions: 0, users: 0, engagedSessions: 0, conversions: 0 },
  );
}

/**
 * Tramos de `size` días contados hacia atrás desde el final del rango (el último tramo siempre
 * está completo; el primero puede no estarlo).
 */
function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let end = items.length; end > 0; end -= size) out.unshift(items.slice(Math.max(0, end - size), end));
  return out;
}

/**
 * Serie para una sparkline: un punto por día o, en periodos largos, por semana. Los recuentos van
 * en media diaria de cada tramo (así un tramo incompleto no se hunde) y los ratios, ponderados.
 */
export function searchSpark(days: readonly SearchDay[], range: DayRange, metric: SearchMetric, bucketDays = 1): (number | null)[] {
  return chunks(fillSearchDays(days, range), Math.max(1, bucketDays)).map((bucket) => {
    const t = searchTotals(bucket, { from: bucket[0]!.date, to: bucket[bucket.length - 1]!.date });
    switch (metric) {
      case "clicks":
        return t.clicks / bucket.length;
      case "impressions":
        return t.impressions / bucket.length;
      case "ctr":
        return t.ctr;
      case "position":
        return t.position;
    }
  });
}

export function webSpark(days: readonly WebDay[], range: DayRange, metric: WebMetric, bucketDays = 1): (number | null)[] {
  return chunks(fillWebDays(days, range), Math.max(1, bucketDays)).map((bucket) => {
    const t = webTotals(bucket, { from: bucket[0]!.date, to: bucket[bucket.length - 1]!.date });
    switch (metric) {
      case "sessions":
        return t.sessions / bucket.length;
      case "conversions":
        return t.conversions / bucket.length;
      case "engagementRate":
        return t.engagementRate;
    }
  });
}

/** Días por punto de las sparklines: diarios hasta ~3 meses, semanales en adelante. */
export function sparkBucketDays(rangeDays: number): number {
  return rangeDays > 100 ? 7 : rangeDays > 45 ? 3 : 1;
}

export type ChartPoint = {
  date: CivilDate;
  clicks: number;
  impressions: number;
  /** El día equivalente del periodo de comparación (mismo índice), si lo hay. */
  compareDate: CivilDate | null;
  compareClicks: number | null;
  compareImpressions: number | null;
};

/** La gráfica principal: un punto por día, con el día equivalente del periodo de comparación. */
export function performanceSeries(
  days: readonly SearchDay[],
  range: DayRange,
  compare: DayRange | null,
): ChartPoint[] {
  const current = fillSearchDays(days, range);
  const previous = compare ? fillSearchDays(days, compare) : [];
  return current.map((day, index) => {
    const other = previous[index];
    return {
      date: day.date,
      clicks: day.clicks,
      impressions: day.impressions,
      compareDate: other?.date ?? null,
      compareClicks: other ? other.clicks : null,
      compareImpressions: other ? other.impressions : null,
    };
  });
}
