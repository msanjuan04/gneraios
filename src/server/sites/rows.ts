// Sin "server-only": lo usan el cron (engine.ts) y los cargadores de las pantallas. Solo se importa
// desde código de servidor.
import { readOrgSettings } from "@/app/[org]/settings/schema";
import type { SiteExpiry, SiteListItem } from "@/components/sites/types";
import {
  asCheckError,
  deriveSiteStatus,
  domainExpiry,
  type ExpiryInfo,
  expirySeverity,
  type FailureStreak,
  hasProblem,
  isDownConfirmed,
  NO_STREAK,
  siteDisplayUrl,
  siteName,
  type SiteThresholds,
  sslExpiry,
  uptimeByWindow,
} from "@/domain/sites";
import type { Database, Tables } from "@/lib/supabase/database.types";

/**
 * Filas de sites_overview → lo que enseñan las pantallas y lo que necesita el cron. Lo derivado sale
 * de su única definición: la racha y los recuentos de la vista (gemelas del dominio, con test de
 * paridad) y el estado, el uptime y las caducidades de src/domain/sites.
 */

/** Las columnas de OVERVIEW_COLUMNS (todas las de la vista menos las fechas de la fila y last_ok_at). */
export type OverviewRow = Omit<Database["public"]["Views"]["sites_overview"]["Row"], "created_at" | "updated_at" | "last_ok_at">;

export const OVERVIEW_COLUMNS =
  "id, org_id, client_id, client_name, url, label, hosted_by_us, domain_expires_on, notes, is_active, last_checked_at, last_ok, last_status_code, last_response_ms, last_error, tls_expires_at, consecutive_failures, failing_since, checks_24h, ok_24h, checks_7d, ok_7d, checks_30d, ok_30d";

/** Una fila con lo imprescindible (la vista lo da todo como opcional). */
export type SiteRow = OverviewRow & { id: string; org_id: string; url: string };

export function isSiteRow(row: OverviewRow): row is SiteRow {
  return Boolean(row.id && row.org_id && row.url);
}

/** Los umbrales de Webs de la org (orgs.settings.sites, con sus valores por defecto). */
export function siteThresholds(org: Pick<Tables<"orgs">, "settings">): SiteThresholds {
  const s = readOrgSettings(org.settings).sites;
  return { sslWarnDays: s.ssl_warn_days, domainWarnDays: s.domain_warn_days, slowMs: s.slow_ms, downAfterFailures: s.down_after_failures };
}

/** La racha de fallos en curso de una fila. */
export function streakOf(row: OverviewRow): FailureStreak {
  const failures = row.consecutive_failures ?? 0;
  return failures > 0 ? { failures, since: row.failing_since } : NO_STREAK;
}

function withSeverity(info: ExpiryInfo | null, warnDays: number): SiteExpiry | null {
  const severity = expirySeverity(info, warnDays);
  return info && severity ? { ...info, severity } : null;
}

export type ListContext = { thresholds: SiteThresholds; now: Date; timeZone: string; today: string };

export function toSiteListItem(row: SiteRow, ctx: ListContext): SiteListItem {
  const isActive = row.is_active ?? true;
  const lastCheck = row.last_checked_at
    ? { checkedAt: row.last_checked_at, ok: row.last_ok ?? false, responseMs: row.last_response_ms }
    : null;
  const status = deriveSiteStatus({ isActive, lastCheck }, { slowMs: ctx.thresholds.slowMs, now: ctx.now });
  const streak = streakOf(row);
  const ssl = withSeverity(sslExpiry(row.tls_expires_at, ctx.now, ctx.timeZone), ctx.thresholds.sslWarnDays);
  const domain = withSeverity(domainExpiry(row.domain_expires_on, ctx.today), ctx.thresholds.domainWarnDays);
  return {
    id: row.id,
    url: row.url,
    displayUrl: siteDisplayUrl(row.url),
    label: row.label,
    name: siteName({ label: row.label, url: row.url }),
    clientId: row.client_id,
    clientName: row.client_name,
    hostedByUs: row.hosted_by_us ?? true,
    isActive,
    notes: row.notes,
    domainExpiresOn: row.domain_expires_on,
    status,
    lastCheckedAt: row.last_checked_at,
    lastStatusCode: row.last_status_code,
    lastResponseMs: row.last_response_ms,
    lastError: asCheckError(row.last_error),
    failures: streak.failures,
    failingSince: streak.since,
    confirmed: isDownConfirmed(streak, ctx.thresholds.downAfterFailures),
    uptime: uptimeByWindow({
      day: { total: row.checks_24h ?? 0, ok: row.ok_24h ?? 0 },
      week: { total: row.checks_7d ?? 0, ok: row.ok_7d ?? 0 },
      month: { total: row.checks_30d ?? 0, ok: row.ok_30d ?? 0 },
    }),
    ssl,
    domain,
    problem: hasProblem({ status, ssl: ssl?.severity ?? null, domain: domain?.severity ?? null }),
  };
}

/** Primero lo caído, luego lo que tiene algún problema, lo demás por nombre y lo pausado al final. */
export function compareSites(a: SiteListItem, b: SiteListItem): number {
  const rank = (s: SiteListItem) => (s.status === "paused" ? 3 : s.status === "down" ? 0 : s.problem ? 1 : 2);
  return rank(a) - rank(b) || a.name.localeCompare(b.name, "es", { sensitivity: "base" });
}
