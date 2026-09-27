import type { CivilDate } from "@/domain/dates/civil-date";
import { domainExpiry, expirySeverity, sslExpiry } from "./expiry";
import { nextStreak } from "./incidents";
import { type FailureStreak, MINUTE_MS, type SiteCheck, type SiteThresholds } from "./types";

// Cuándo avisar a los socios (bandeja y push) después de una comprobación. Se decide con la racha
// de fallos que había antes (sites_overview) y la comprobación nueva, sin guardar ningún estado:
//
// - Caída: cuando la racha llega a los fallos seguidos que pide la org (por defecto 2), para no
//   avisar por un fallo suelto. Una vez por caída: la clave es el inicio de la racha.
// - Vuelta: la primera comprobación buena después de una caída confirmada (una por caída).
// - SSL y dominio: al entrar en los días de aviso (o si ya caducó). Una vez por fecha de caducidad:
//   si se renueva, la fecha cambia y la próxima vez se vuelve a avisar.
//
// Las claves (notifications.dedupe_key) hacen que repetir la misma decisión no duplique nada: dos
// comprobaciones a la vez, o el cron y «Comprobar ahora», dan como mucho un aviso.

/**
 * Si la racha pasa del umbral sin que se haya avisado (dos comprobaciones a la vez, o se bajó el
 * umbral), aún se avisa durante estas comprobaciones de más. Después ya no: una web caída durante
 * semanas no vuelve a avisar cada 5 minutos cuando la poda mueve el inicio de la racha.
 */
export const DOWN_ALERT_GRACE_CHECKS = 3;

export type SiteAlertKind = "site_down" | "site_up" | "ssl_expiring" | "domain_expiring";

/** Un aviso por crear: `key` es la base de la clave de deduplicación (el servidor le añade el destinatario). */
export type SiteAlert = { kind: SiteAlertKind; key: string; params: Record<string, string | number> };

/** Un instante siempre con el mismo texto, venga de Postgres ("…+00:00") o de JS ("…Z"). */
function instantKey(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toISOString();
}

export type AlertInput = {
  site: { id: string; name: string };
  /** La racha de fallos antes de esta comprobación. */
  previous: FailureStreak;
  check: SiteCheck;
  domainExpiresOn: CivilDate | null;
  thresholds: SiteThresholds;
  now: Date;
  /** Zona de la org: los días que le quedan al certificado se cuentan en ella. */
  timeZone: string;
  /** Hoy en la zona de la org. */
  today: CivilDate;
};

/** Los avisos que tocan después de una comprobación (normalmente ninguno). */
export function detectSiteAlerts(input: AlertInput): SiteAlert[] {
  const { site, previous, check, thresholds } = input;
  const alerts: SiteAlert[] = [];
  const threshold = Math.max(1, thresholds.downAfterFailures);
  const streak = nextStreak(previous, check);

  if (!check.ok && streak.since && streak.failures >= threshold && streak.failures <= threshold + DOWN_ALERT_GRACE_CHECKS) {
    alerts.push({
      kind: "site_down",
      key: `site_down:${site.id}:${instantKey(streak.since)}`,
      params: { site: site.name, error: check.error ?? "network", status: check.statusCode ?? 0 },
    });
  }

  if (check.ok && previous.since && previous.failures >= threshold) {
    const minutes = Math.max(1, Math.round((new Date(check.checkedAt).getTime() - new Date(previous.since).getTime()) / MINUTE_MS));
    alerts.push({
      kind: "site_up",
      key: `site_up:${site.id}:${instantKey(previous.since)}`,
      params: { site: site.name, minutes },
    });
  }

  const ssl = sslExpiry(check.tlsExpiresAt, input.now, input.timeZone);
  const sslSeverity = expirySeverity(ssl, thresholds.sslWarnDays);
  if (ssl && (sslSeverity === "warning" || sslSeverity === "expired")) {
    alerts.push({
      kind: "ssl_expiring",
      key: `ssl_expiring:${site.id}:${ssl.expiresOn}`,
      params: { site: site.name, days: ssl.expired ? -1 : Math.max(0, ssl.daysLeft), date: ssl.expiresOn },
    });
  }

  const domain = domainExpiry(input.domainExpiresOn, input.today);
  const domainSeverity = expirySeverity(domain, thresholds.domainWarnDays);
  if (domain && (domainSeverity === "warning" || domainSeverity === "expired")) {
    alerts.push({
      kind: "domain_expiring",
      key: `domain_expiring:${site.id}:${domain.expiresOn}`,
      params: { site: site.name, days: domain.daysLeft, date: domain.expiresOn },
    });
  }

  return alerts;
}
