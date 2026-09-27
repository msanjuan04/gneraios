import { HOUR_MS, type SiteCheck } from "./types";

/** Un tramo de la gráfica (una hora, por defecto): cuántas comprobaciones, cuántas bien y lo que tardaron. */
export type CheckBucket = {
  /** Inicio del tramo (ISO). */
  start: string;
  total: number;
  ok: number;
  /** Media del tiempo de respuesta de las que fueron bien; null si no hubo ninguna. */
  avgMs: number | null;
  /** La más lenta de las que fueron bien. */
  maxMs: number | null;
};

/**
 * Las comprobaciones agrupadas en tramos de `bucketMs` desde `from` hasta `to` (el primero empieza
 * en la hora en punto): para la gráfica de latencia y la tira de uptime. Tramos sin datos, con 0.
 */
export function bucketChecks(
  checks: readonly Pick<SiteCheck, "checkedAt" | "ok" | "responseMs">[],
  range: { from: Date; to: Date; bucketMs?: number },
): CheckBucket[] {
  const size = range.bucketMs ?? HOUR_MS;
  if (!(size > 0)) throw new Error(`Tramo no válido: ${String(size)}`);
  const first = Math.floor(range.from.getTime() / size) * size;
  const end = range.to.getTime();
  if (!(end >= first)) return [];
  const count = Math.floor((end - first) / size) + 1;
  const sums = Array.from({ length: count }, () => ({ total: 0, ok: 0, msTotal: 0, msCount: 0, max: null as number | null }));
  for (const check of checks) {
    const at = new Date(check.checkedAt).getTime();
    if (!(at >= first && at <= end)) continue;
    const bucket = sums[Math.floor((at - first) / size)]!;
    bucket.total += 1;
    if (!check.ok) continue;
    bucket.ok += 1;
    if (check.responseMs !== null) {
      bucket.msTotal += check.responseMs;
      bucket.msCount += 1;
      bucket.max = bucket.max === null ? check.responseMs : Math.max(bucket.max, check.responseMs);
    }
  }
  return sums.map((b, i) => ({
    start: new Date(first + i * size).toISOString(),
    total: b.total,
    ok: b.ok,
    avgMs: b.msCount > 0 ? Math.round(b.msTotal / b.msCount) : null,
    maxMs: b.max,
  }));
}

/** Media de los tiempos de respuesta de las comprobaciones que fueron bien, o null. */
export function averageResponseMs(checks: readonly Pick<SiteCheck, "ok" | "responseMs">[]): number | null {
  const values = checks.filter((c) => c.ok && c.responseMs !== null).map((c) => c.responseMs!);
  return values.length === 0 ? null : Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);
}
