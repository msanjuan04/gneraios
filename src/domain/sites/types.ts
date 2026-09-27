// Webs vigiladas (sin I/O). El servidor comprueba cada web (src/server/sites/check.ts) y todo lo
// demás se deriva de esas comprobaciones: el estado, el uptime, las caídas, lo que caduca y cuándo
// hay que avisar. Nada de esto se guarda.

/** Por qué falló una comprobación (site_checks.error). Las etiquetas salen de i18n (sites.errors.*). */
export const CHECK_ERRORS = ["timeout", "dns", "refused", "reset", "tls_expired", "tls_invalid", "redirects", "http", "network"] as const;
export type CheckError = (typeof CHECK_ERRORS)[number];

/** La clave guardada, o "network" si no es una conocida (nunca se pierde que falló). */
export function asCheckError(value: string | null | undefined): CheckError | null {
  if (value === null || value === undefined || value === "") return null;
  return (CHECK_ERRORS as readonly string[]).includes(value) ? (value as CheckError) : "network";
}

/** Estado de una web: funciona, lenta, caída, sin datos (nunca comprobada o sin comprobar hace rato) o en pausa. */
export const SITE_STATUSES = ["up", "slow", "down", "unknown", "paused"] as const;
export type SiteStatus = (typeof SITE_STATUSES)[number];

/** Umbrales de la org (orgs.settings.sites). */
export type SiteThresholds = {
  /** Se avisa cuando al certificado le quedan estos días o menos. */
  sslWarnDays: number;
  /** Se avisa cuando al dominio le quedan estos días o menos. */
  domainWarnDays: number;
  /** A partir de este tiempo de respuesta, la web va lenta. */
  slowMs: number;
  /** Fallos seguidos antes de avisar de una caída (un fallo suelto no avisa). */
  downAfterFailures: number;
};

/** Una comprobación, tal y como la guarda site_checks. Instantes en ISO 8601. */
export type SiteCheck = {
  checkedAt: string;
  ok: boolean;
  statusCode: number | null;
  responseMs: number | null;
  error: CheckError | null;
  tlsExpiresAt: string | null;
};

/** La racha de fallos en curso: cuántas comprobaciones seguidas han fallado y desde cuándo (la primera). */
export type FailureStreak = { failures: number; since: string | null };

export const NO_STREAK: FailureStreak = { failures: 0, since: null };

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;
