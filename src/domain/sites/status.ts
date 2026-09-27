import type { ExpirySeverity } from "./expiry";
import { type FailureStreak, MINUTE_MS, type SiteCheck, type SiteStatus } from "./types";

/**
 * Sin una comprobación en este tiempo, el estado ya no se sabe: el cron comprueba cada 5 minutos,
 * así que media hora sin datos es que no está corriendo (o que la web está en pausa).
 */
export const STALE_AFTER_MS = 30 * MINUTE_MS;

export type StatusInput = {
  isActive: boolean;
  /** La última comprobación (null si nunca se ha comprobado). */
  lastCheck: Pick<SiteCheck, "checkedAt" | "ok" | "responseMs"> | null;
};

/**
 * Estado de una web a partir de su última comprobación: en pausa si no se vigila; sin datos si
 * nunca se ha comprobado o hace demasiado; caída si falló; lenta si respondió pero tardó `slowMs`
 * o más; funciona si no. La caída se enseña desde el primer fallo (es lo que pasa), aunque el aviso
 * espere a que se confirme (isDownConfirmed).
 */
export function deriveSiteStatus(
  input: StatusInput,
  opts: { slowMs: number; now: Date; staleAfterMs?: number },
): SiteStatus {
  if (!input.isActive) return "paused";
  const last = input.lastCheck;
  if (!last) return "unknown";
  const age = opts.now.getTime() - new Date(last.checkedAt).getTime();
  if (!(age <= (opts.staleAfterMs ?? STALE_AFTER_MS))) return "unknown";
  if (!last.ok) return "down";
  if (last.responseMs !== null && last.responseMs >= opts.slowMs) return "slow";
  return "up";
}

/** ¿La caída está confirmada (tantos fallos seguidos como pide la org)? Es cuando se avisa. */
export function isDownConfirmed(streak: FailureStreak, downAfterFailures: number): boolean {
  return streak.failures > 0 && streak.failures >= downAfterFailures;
}

/**
 * ¿Pide atención? Caída o lenta, o con el certificado o el dominio a punto de caducar (o caducados).
 * Una web sin datos o en pausa no es un problema de la web.
 */
export function hasProblem(input: { status: SiteStatus; ssl: ExpirySeverity | null; domain: ExpirySeverity | null }): boolean {
  if (input.status === "paused") return false;
  return (
    input.status === "down" ||
    input.status === "slow" ||
    input.ssl === "warning" ||
    input.ssl === "expired" ||
    input.domain === "warning" ||
    input.domain === "expired"
  );
}

/** Orden de gravedad para las listas: primero lo caído, luego lo lento, lo que no se sabe, lo que va bien y lo pausado. */
export const STATUS_ORDER: Record<SiteStatus, number> = { down: 0, slow: 1, unknown: 2, up: 3, paused: 4 };
