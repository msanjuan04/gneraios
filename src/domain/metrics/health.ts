// Salud del cron diario (docs/CRON.md): si el último OK tiene más de 26 h, el dashboard avisa.
// 26 = un día + margen para una ejecución que tarda o se repite; es una propiedad del cron
// (diario), no un umbral de negocio de la org.

export const CRON_STALE_HOURS = 26;

export type JobRunRow = {
  status: "running" | "succeeded" | "failed";
  /** Instantes ISO. */
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
};

export type CronHealth = {
  /** ok: último OK reciente · stale: el último OK es viejo · never: nunca ha terminado bien. */
  state: "ok" | "stale" | "never";
  lastSuccessAt: string | null;
  /** Horas desde el último OK, redondeadas hacia abajo. */
  hoursSinceSuccess: number | null;
  /** La ejecución más reciente (puede ser un fallo posterior al último OK). */
  lastRun: JobRunRow | null;
};

const HOUR_MS = 3_600_000;

/** Estado del cron a partir de sus ejecuciones (en cualquier orden) y del instante actual. */
export function cronHealth(runs: readonly JobRunRow[], nowMs: number): CronHealth {
  const byStart = [...runs].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  const lastRun = byStart[0] ?? null;
  const lastSuccess = byStart.find((r) => r.status === "succeeded" && r.finishedAt !== null) ?? null;
  if (!lastSuccess?.finishedAt) return { state: "never", lastSuccessAt: null, hoursSinceSuccess: null, lastRun };
  const hours = Math.max(0, Math.floor((nowMs - Date.parse(lastSuccess.finishedAt)) / HOUR_MS));
  return {
    state: nowMs - Date.parse(lastSuccess.finishedAt) > CRON_STALE_HOURS * HOUR_MS ? "stale" : "ok",
    lastSuccessAt: lastSuccess.finishedAt,
    hoursSinceSuccess: hours,
    lastRun,
  };
}
