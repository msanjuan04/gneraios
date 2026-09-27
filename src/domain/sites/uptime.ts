import { DAY_MS, HOUR_MS, type SiteCheck } from "./types";

/** Las ventanas de uptime. La más larga marca cuánto se guardan las comprobaciones. */
export const UPTIME_WINDOWS = { day: 24 * HOUR_MS, week: 7 * DAY_MS, month: 30 * DAY_MS } as const;
export type UptimeWindow = keyof typeof UPTIME_WINDOWS;
export const UPTIME_WINDOW_KEYS = Object.keys(UPTIME_WINDOWS) as UptimeWindow[];

/** Días que se guardan las comprobaciones (la ventana de 30 días): el cron poda las anteriores. */
export const CHECK_RETENTION_DAYS = 30;

export type CheckCounts = { total: number; ok: number };
export type WindowCounts = Record<UptimeWindow, CheckCounts>;
export type Uptime = Record<UptimeWindow, number | null>;

/** Proporción de comprobaciones que fueron bien (0–1), o null si no hay ninguna. */
export function uptimeRatio(counts: CheckCounts): number | null {
  if (!(counts.total > 0)) return null;
  return Math.min(1, Math.max(0, counts.ok / counts.total));
}

/**
 * Recuento por ventana: una comprobación cuenta en una ventana si se hizo en (ahora − ventana,
 * ahora]. Gemela de sites_overview (checks_24h, ok_7d…): un test comprueba la paridad.
 */
export function windowCounts(checks: readonly Pick<SiteCheck, "checkedAt" | "ok">[], now: Date): WindowCounts {
  const counts: WindowCounts = { day: { total: 0, ok: 0 }, week: { total: 0, ok: 0 }, month: { total: 0, ok: 0 } };
  const at = now.getTime();
  for (const check of checks) {
    const age = at - new Date(check.checkedAt).getTime();
    if (!(age >= 0)) continue;
    for (const key of UPTIME_WINDOW_KEYS) {
      if (age < UPTIME_WINDOWS[key]) {
        counts[key].total += 1;
        if (check.ok) counts[key].ok += 1;
      }
    }
  }
  return counts;
}

/** Uptime de 24 h, 7 y 30 días a partir de los recuentos. */
export function uptimeByWindow(counts: WindowCounts): Uptime {
  return { day: uptimeRatio(counts.day), week: uptimeRatio(counts.week), month: uptimeRatio(counts.month) };
}
