import "server-only";
import { CHECK_RETENTION_DAYS, DAY_MS, detectSiteAlerts, type SiteCheck, siteName } from "@/domain/sites";
import { nowInZone } from "@/lib/clock";
import type { Json, Tables, TablesInsert } from "@/lib/supabase/database.types";
import { type Db, fetchAll } from "@/server/billing/context";
import { CHECK_CONCURRENCY, checkSite, mapWithConcurrency } from "./check";
import { isSiteRow, OVERVIEW_COLUMNS, type SiteRow, siteThresholds, streakOf } from "./rows";

/**
 * El vigilante de las webs: las comprueba, guarda lo que ha visto y avisa a los socios de lo que ha
 * cambiado (caídas, vueltas, certificados y dominios a punto de caducar). Lo llama el cron cada 5
 * minutos (/api/cron/sites, docs/CRON.md) y, para una web, «Comprobar ahora».
 */

export type SiteOrg = Pick<Tables<"orgs">, "id" | "timezone" | "settings">;
export type SiteCheckEntry = { row: SiteRow; check: SiteCheck };

export type SiteRunSummary = {
  orgs: number;
  sites: number;
  up: number;
  down: number;
  slow: number;
  /** Avisos creados (uno por socio y suceso). */
  alerts: number;
  /** Comprobaciones de más de 30 días borradas. */
  pruned: number;
  durationMs: number;
  errors: string[];
};

/** Los socios y owners activos: a quién se avisa. */
async function alertRecipients(admin: Db, orgId: string): Promise<string[]> {
  const { data, error } = await admin.from("members").select("id").eq("org_id", orgId).eq("is_active", true).in("role", ["partner", "owner"]);
  if (error) throw new Error(`[sites] recipients: ${error.message}`);
  return (data ?? []).map((m) => m.id);
}

/**
 * Guarda las comprobaciones (`writer`: el cliente del usuario pasa por RLS; el cron usa el admin) y
 * crea los avisos de lo que ha cambiado. Los avisos los escribe siempre el admin: nadie los escribe
 * a mano. Cada aviso lleva su clave (un suceso, un socio): repetir la misma decisión no duplica.
 */
export async function recordSiteChecks(args: {
  writer: Db;
  admin: Db;
  org: SiteOrg;
  entries: readonly SiteCheckEntry[];
  now?: Date;
}): Promise<{ inserted: number; alerts: number }> {
  const { writer, admin, org, entries } = args;
  if (entries.length === 0) return { inserted: 0, alerts: 0 };
  const now = args.now ?? new Date();

  const rows: TablesInsert<"site_checks">[] = entries.map(({ row, check }) => ({
    org_id: org.id,
    site_id: row.id,
    checked_at: check.checkedAt,
    ok: check.ok,
    status_code: check.statusCode,
    response_ms: check.responseMs,
    error: check.error,
    tls_expires_at: check.tlsExpiresAt,
  }));
  const { error: insertError } = await writer.from("site_checks").insert(rows);
  if (insertError) throw new Error(`[sites] checks: ${insertError.message}`);

  const thresholds = siteThresholds(org);
  const today = nowInZone(org.timezone, now).date;
  const alerts = entries.flatMap(({ row, check }) =>
    // Una web en pausa no avisa aunque se compruebe a mano.
    row.is_active === false
      ? []
      : detectSiteAlerts({
          site: { id: row.id, name: siteName({ label: row.label, url: row.url }) },
          previous: streakOf(row),
          check,
          domainExpiresOn: row.domain_expires_on,
          thresholds,
          now,
          timeZone: org.timezone,
          today,
        }).map((alert) => ({ ...alert, siteId: row.id })),
  );
  if (alerts.length === 0) return { inserted: rows.length, alerts: 0 };

  const recipients = await alertRecipients(admin, org.id);
  const notifications: TablesInsert<"notifications">[] = alerts.flatMap((alert) =>
    recipients.map((memberId) => ({
      org_id: org.id,
      member_id: memberId,
      kind: alert.kind,
      params: alert.params as Json,
      href: `/sites/${alert.siteId}`,
      dedupe_key: `${alert.key}:${memberId}`,
    })),
  );
  if (notifications.length === 0) return { inserted: rows.length, alerts: 0 };
  const { data, error } = await admin
    .from("notifications")
    .upsert(notifications, { onConflict: "org_id,dedupe_key", ignoreDuplicates: true })
    .select("id");
  if (error) throw new Error(`[sites] notifications: ${error.message}`);
  return { inserted: rows.length, alerts: data?.length ?? 0 };
}

/** Borra las comprobaciones de más de 30 días (la ventana de uptime más larga). */
export async function pruneSiteChecks(admin: Db, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - CHECK_RETENTION_DAYS * DAY_MS).toISOString();
  const { count, error } = await admin.from("site_checks").delete({ count: "exact" }).lt("checked_at", cutoff);
  if (error) throw new Error(`[sites] prune: ${error.message}`);
  return count ?? 0;
}

/**
 * Comprueba las webs activas (de todas las orgs, o de una, o solo unas) y lo guarda. El cron poda
 * además lo antiguo. Un fallo en una org no para las demás: queda en `errors`.
 */
export async function runSiteChecks(admin: Db, opts: { orgId?: string; siteIds?: string[]; prune?: boolean } = {}): Promise<SiteRunSummary> {
  const started = Date.now();
  const summary: SiteRunSummary = { orgs: 0, sites: 0, up: 0, down: 0, slow: 0, alerts: 0, pruned: 0, durationMs: 0, errors: [] };

  let orgsQuery = admin.from("orgs").select("id, timezone, settings");
  if (opts.orgId) orgsQuery = orgsQuery.eq("id", opts.orgId);
  const { data: orgs, error: orgsError } = await orgsQuery;
  if (orgsError) throw new Error(`[sites] orgs: ${orgsError.message}`);
  const orgById = new Map((orgs ?? []).map((o) => [o.id, o]));

  const overview = await fetchAll((from, to) => {
    let query = admin.from("sites_overview").select(OVERVIEW_COLUMNS).eq("is_active", true);
    if (opts.orgId) query = query.eq("org_id", opts.orgId);
    if (opts.siteIds) query = query.in("id", opts.siteIds);
    return query.order("id").range(from, to);
  }, "sites.overview");
  const sites = overview.filter(isSiteRow).filter((row) => orgById.has(row.org_id));

  const checks = await mapWithConcurrency(sites, CHECK_CONCURRENCY, (row) => checkSite(row.url));
  const byOrg = new Map<string, SiteCheckEntry[]>();
  sites.forEach((row, i) => {
    const list = byOrg.get(row.org_id) ?? [];
    list.push({ row, check: checks[i]! });
    byOrg.set(row.org_id, list);
  });

  for (const [orgId, entries] of byOrg) {
    const org = orgById.get(orgId)!;
    try {
      const { alerts } = await recordSiteChecks({ writer: admin, admin, org, entries });
      summary.orgs += 1;
      summary.sites += entries.length;
      summary.alerts += alerts;
      const slowMs = siteThresholds(org).slowMs;
      for (const { check } of entries) {
        if (!check.ok) summary.down += 1;
        else if (check.responseMs !== null && check.responseMs >= slowMs) summary.slow += 1;
        else summary.up += 1;
      }
    } catch (error) {
      console.error("[sites] org", orgId, error);
      summary.errors.push(`${orgId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (opts.prune) {
    try {
      summary.pruned = await pruneSiteChecks(admin);
    } catch (error) {
      console.error("[sites] prune", error);
      summary.errors.push(`prune: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  summary.durationMs = Date.now() - started;
  return summary;
}
