// Respuestas de las APIs de Google → hechos diarios. Puro y tolerante: una fila que no se entiende
// se descarta en lugar de romper la sincronización entera.
// - Search Console (searchAnalytics.query): { rows: [{ keys, clicks, impressions, ctr, position }] },
//   con los clics y las impresiones como números decimales y el CTR ignorado (se deriva).
// - GA4 (runReport): { rows: [{ dimensionValues: [{ value }], metricValues: [{ value }] }] }, con
//   la fecha como "YYYYMMDD" y los valores como texto, en el orden en que se pidieron.

import type { CivilDate } from "../dates/civil-date";
import type { QueryDailyFact, SearchDailyFact, WebChannel, WebDailyFact } from "./provider";

const CIVIL = /^\d{4}-\d{2}-\d{2}$/;
const GA4_DATE = /^(\d{4})(\d{2})(\d{2})$/;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

function rowsOf(response: unknown): unknown[] {
  return isRecord(response) && Array.isArray(response.rows) ? response.rows : [];
}

function count(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

/** Posición con 2 decimales (como se guarda) y nunca por encima de la 1. */
export function roundPosition(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.max(1, Math.round(n * 100) / 100);
}

function keysOf(row: unknown): string[] | null {
  if (!isRecord(row) || !Array.isArray(row.keys) || !row.keys.every((k) => typeof k === "string")) return null;
  return row.keys as string[];
}

/** Filas de Search Console con `dimensions: ["date"]`. */
export function parseGscDateRows(response: unknown): SearchDailyFact[] {
  return rowsOf(response).flatMap((row): SearchDailyFact[] => {
    const keys = keysOf(row);
    if (!keys || !CIVIL.test(keys[0] ?? "") || !isRecord(row)) return [];
    const impressions = count(row.impressions);
    return [
      {
        metricOn: keys[0]!,
        clicks: count(row.clicks),
        impressions,
        position: impressions > 0 ? roundPosition(row.position) : null,
      },
    ];
  });
}

/**
 * Filas de Search Console con `dimensions: ["date", "query", "page"]`, o con `["query", "page"]` si
 * se pide un solo día (`day`).
 */
export function parseGscQueryRows(response: unknown, day?: CivilDate): QueryDailyFact[] {
  return rowsOf(response).flatMap((row): QueryDailyFact[] => {
    const keys = keysOf(row);
    if (!keys || !isRecord(row)) return [];
    const [metricOn, query, page] = day ? [day, keys[0], keys[1]] : [keys[0], keys[1], keys[2]];
    if (!metricOn || !CIVIL.test(metricOn) || query === undefined || page === undefined) return [];
    const impressions = count(row.impressions);
    if (impressions === 0) return [];
    return [
      {
        metricOn,
        query: query.slice(0, 2048),
        page: page.slice(0, 4096),
        clicks: count(row.clicks),
        impressions,
        position: roundPosition(row.position),
      },
    ];
  });
}

/** Métricas que se piden a GA4, en este orden. */
export const GA4_METRICS = ["sessions", "activeUsers", "engagedSessions", "keyEvents"] as const;

/** Filas de GA4 con `dimensions: [{ name: "date" }]` y las métricas de GA4_METRICS. */
export function parseGa4Rows(response: unknown, channel: WebChannel): WebDailyFact[] {
  return rowsOf(response).flatMap((row): WebDailyFact[] => {
    if (!isRecord(row) || !Array.isArray(row.dimensionValues) || !Array.isArray(row.metricValues)) return [];
    const dimensions: unknown[] = row.dimensionValues;
    const metrics: unknown[] = row.metricValues;
    const date = isRecord(dimensions[0]) ? dimensions[0].value : undefined;
    const match = typeof date === "string" ? GA4_DATE.exec(date) : null;
    if (!match) return [];
    const metric = (index: number) => {
      const cell = metrics[index];
      return count(isRecord(cell) ? cell.value : 0);
    };
    return [
      {
        metricOn: `${match[1]}-${match[2]}-${match[3]}`,
        channel,
        sessions: metric(0),
        users: metric(1),
        engagedSessions: metric(2),
        conversions: metric(3),
      },
    ];
  });
}
