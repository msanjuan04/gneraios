import { type CheckError, type FailureStreak, MINUTE_MS, NO_STREAK, type SiteCheck } from "./types";

/**
 * Una caída: comprobaciones fallidas seguidas. Empieza en la primera que falló y acaba en la
 * primera que volvió a ir bien (null si sigue caída).
 */
export type Incident = {
  startedAt: string;
  endedAt: string | null;
  failures: number;
  /** Lo que falló la última vez (lo que se ve ahora, si sigue caída). */
  error: CheckError | null;
  statusCode: number | null;
};

const time = (iso: string) => new Date(iso).getTime();

/** Las comprobaciones de la más antigua a la más reciente. */
function chronological<T extends Pick<SiteCheck, "checkedAt">>(checks: readonly T[]): T[] {
  return [...checks].sort((a, b) => time(a.checkedAt) - time(b.checkedAt));
}

/** Las caídas, de la más reciente a la más antigua. */
export function findIncidents(checks: readonly SiteCheck[]): Incident[] {
  const incidents: Incident[] = [];
  let current: Incident | null = null;
  for (const check of chronological(checks)) {
    if (check.ok) {
      if (current) {
        current.endedAt = check.checkedAt;
        incidents.push(current);
        current = null;
      }
      continue;
    }
    if (!current) current = { startedAt: check.checkedAt, endedAt: null, failures: 0, error: null, statusCode: null };
    current.failures += 1;
    current.error = check.error;
    current.statusCode = check.statusCode;
  }
  if (current) incidents.push(current);
  return incidents.reverse();
}

/**
 * La racha en curso: los fallos seguidos desde la última comprobación que fue bien (todas, si
 * ninguna fue bien). Gemela de sites_overview (consecutive_failures, failing_since).
 */
export function currentStreak(checks: readonly Pick<SiteCheck, "checkedAt" | "ok">[]): FailureStreak {
  let failures = 0;
  let since: string | null = null;
  for (const check of chronological(checks).reverse()) {
    if (check.ok) break;
    failures += 1;
    since = check.checkedAt;
  }
  return failures === 0 ? NO_STREAK : { failures, since };
}

/** La racha después de una comprobación nueva. */
export function nextStreak(previous: FailureStreak, check: Pick<SiteCheck, "ok" | "checkedAt">): FailureStreak {
  if (check.ok) return NO_STREAK;
  return { failures: previous.failures + 1, since: previous.failures > 0 && previous.since ? previous.since : check.checkedAt };
}

/** Minutos que duró (o lleva) una caída; como mínimo 1. */
export function incidentMinutes(incident: Pick<Incident, "startedAt" | "endedAt">, now: Date): number {
  const end = incident.endedAt ? time(incident.endedAt) : now.getTime();
  return Math.max(1, Math.round((end - time(incident.startedAt)) / MINUTE_MS));
}
