// Qué tramos de fechas descargar en cada sincronización. Cada propiedad y proveedor recuerda el
// tramo contiguo que ya tiene (seo_sync_state). La primera vez se cargan los últimos 16 meses (lo
// que guarda Search Console) y, después, cada día se vuelven a pedir los últimos días (Google los
// consolida con retraso) y se sigue la carga histórica si una ejecución anterior se cortó.
// Lo reciente va primero: si el presupuesto de tiempo se agota, lo que falta es lo más antiguo.

import { addDays, addMonthsClamped, type CivilDate, compareCivil, maxCivil, minCivil } from "../dates/civil-date";
import type { DayRange } from "./period";
import type { QueryDailyFact } from "./provider";

/** Meses de histórico que guarda Search Console (y que se cargan también de GA4). */
export const HISTORY_MONTHS = 16;

export type Coverage = DayRange | null;

export type SyncPlanOptions = {
  /** Primer y último día que el proveedor puede dar hoy. */
  availability: DayRange;
  /** Días del final que se vuelven a pedir en cada ejecución. */
  resyncDays: number;
  /** Días por petición. */
  windowDays: number;
};

/** Primer día de la carga histórica. */
export function historyStart(today: CivilDate, months = HISTORY_MONTHS): CivilDate {
  return addDays(addMonthsClamped(today, -months), 1);
}

/** Parte un rango en tramos de `days` días, del más reciente al más antiguo. */
export function splitNewestFirst(range: DayRange, days: number): DayRange[] {
  const size = Math.max(1, Math.floor(days));
  const out: DayRange[] = [];
  for (let to = range.to; compareCivil(to, range.from) >= 0; to = addDays(to, -size)) {
    out.push({ from: maxCivil(range.from, addDays(to, -(size - 1))), to });
  }
  return out;
}

function clamp(range: DayRange, bounds: DayRange): DayRange | null {
  const from = maxCivil(range.from, bounds.from);
  const to = minCivil(range.to, bounds.to);
  return compareCivil(from, to) <= 0 ? { from, to } : null;
}

/**
 * Los tramos a descargar, en orden. Con `explicit` se descarga exactamente ese rango (acotado a lo
 * disponible). Si no: primero lo nuevo (desde unos días antes del final de lo que ya hay) y después
 * lo que falte hacia atrás hasta el principio del histórico.
 */
export function planSync(coverage: Coverage, opts: SyncPlanOptions, explicit?: DayRange): DayRange[] {
  const { availability, windowDays } = opts;
  if (explicit) {
    const range = clamp(explicit, availability);
    return range ? splitNewestFirst(range, windowDays) : [];
  }
  if (!coverage) return splitNewestFirst(availability, windowDays);

  const plan: DayRange[] = [];
  const forward = clamp({ from: addDays(coverage.to, -(Math.max(1, opts.resyncDays) - 1)), to: availability.to }, availability);
  if (forward) plan.push(...splitNewestFirst(forward, windowDays));
  const backward = clamp({ from: availability.from, to: addDays(coverage.from, -1) }, availability);
  if (backward) plan.push(...splitNewestFirst(backward, windowDays));
  return plan;
}

/** El tramo cubierto después de descargar `range`: se une si se solapa o toca; si no, se queda igual. */
export function mergeCoverage(coverage: Coverage, range: DayRange): Coverage {
  if (!coverage) return range;
  const touches = compareCivil(range.from, addDays(coverage.to, 1)) <= 0 && compareCivil(range.to, addDays(coverage.from, -1)) >= 0;
  if (!touches) return coverage;
  return { from: minCivil(coverage.from, range.from), to: maxCivil(coverage.to, range.to) };
}

/** Clave de una fila de consulta: la misma que usa la base de datos (consulta y página). */
export const queryRowKey = (row: Pick<QueryDailyFact, "metricOn" | "query" | "page">) =>
  `${row.metricOn}\u001f${row.query}\u001f${row.page}`;

/**
 * Deja como mucho `cap` filas por día (las de más clics y, a igualdad, más impresiones) y quita
 * duplicados: un mismo upsert no puede tocar dos veces la misma fila.
 */
export function capQueryRows(rows: readonly QueryDailyFact[], cap: number): QueryDailyFact[] {
  const unique = new Map<string, QueryDailyFact>();
  for (const row of rows) unique.set(queryRowKey(row), row);
  const byDay = new Map<CivilDate, QueryDailyFact[]>();
  for (const row of unique.values()) {
    const list = byDay.get(row.metricOn) ?? [];
    list.push(row);
    byDay.set(row.metricOn, list);
  }
  const out: QueryDailyFact[] = [];
  for (const [, list] of [...byDay].sort(([a], [b]) => compareCivil(a, b))) {
    list.sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions || a.query.localeCompare(b.query) || a.page.localeCompare(b.page));
    out.push(...list.slice(0, Math.max(0, cap)));
  }
  return out;
}
