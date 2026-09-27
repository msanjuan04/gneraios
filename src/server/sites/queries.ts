import "server-only";
import { cache } from "react";
import type { ClientSitesData, SiteClientOption, SiteDetailData, SitesPageData } from "@/components/sites/types";
import { asCheckError, averageResponseMs, bucketChecks, DAY_MS, findIncidents, incidentMinutes, type SiteCheck } from "@/domain/sites";
import { nowInZone } from "@/lib/clock";
import type { Tables } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/server/action-utils";
import { fetchAll } from "@/server/billing/context";
import { compareSites, isSiteRow, type ListContext, OVERVIEW_COLUMNS, siteThresholds, toSiteListItem } from "./rows";

/** Cargadores de las pantallas de Webs y de la tarjeta de la ficha del cliente. Con el cliente del usuario: pasa por RLS. */

type Org = Pick<Tables<"orgs">, "id" | "timezone" | "settings">;

/** Lo que se muestra de la ficha: 7 días de historia y las últimas comprobaciones. */
const HISTORY_DAYS = 7;
const RECENT_CHECKS = 12;

function listContext(org: Org, now = new Date()): ListContext {
  return { thresholds: siteThresholds(org), now, timeZone: org.timezone, today: nowInZone(org.timezone, now).date };
}

/** Clientes para el selector (los archivados no), con su web para proponerlos al dar de alta. */
async function loadClientOptions(orgId: string): Promise<SiteClientOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("clients").select("id, display_name, website").eq("org_id", orgId).is("archived_at", null).order("display_name");
  if (error) throw error;
  return (data ?? []).map((c) => ({ id: c.id, name: c.display_name, website: c.website }));
}

/** Webs: el listado con su estado y los clientes para los paneles. */
export async function getSitesPage(org: Org): Promise<SitesPageData> {
  const supabase = await createClient();
  const [overview, clients] = await Promise.all([
    supabase.from("sites_overview").select(OVERVIEW_COLUMNS).eq("org_id", org.id),
    loadClientOptions(org.id),
  ]);
  if (overview.error) throw overview.error;
  const ctx = listContext(org);
  const sites = (overview.data ?? []).filter(isSiteRow).map((row) => toSiteListItem(row, ctx)).sort(compareSites);
  return { sites, clients, thresholds: ctx.thresholds };
}

/** Las webs de un cliente para su ficha 360. */
export async function getClientSites(org: Org, clientId: string): Promise<ClientSitesData> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("sites_overview").select(OVERVIEW_COLUMNS).eq("org_id", org.id).eq("client_id", clientId);
  if (error) throw error;
  const ctx = listContext(org);
  return { sites: (data ?? []).filter(isSiteRow).map((row) => toSiteListItem(row, ctx)).sort(compareSites) };
}

/** El nombre de una web (metadatos de la ficha), una vez por petición. */
export const getSiteName = cache(async (orgId: string, siteId: string): Promise<string | null> => {
  if (!idSchema.safeParse(siteId).success) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("sites").select("label, url").eq("org_id", orgId).eq("id", siteId).maybeSingle();
  if (!data) return null;
  return data.label?.trim() || data.url.replace(/^https:\/\//, "");
});

/** La ficha de una web: su estado, 7 días por horas, las caídas y las últimas comprobaciones. null si no existe. */
export async function getSiteDetail(org: Org, siteId: string): Promise<SiteDetailData | null> {
  if (!idSchema.safeParse(siteId).success) return null;
  const supabase = await createClient();
  const now = new Date();
  const from = new Date(now.getTime() - HISTORY_DAYS * DAY_MS);
  const [overview, rawChecks, clients] = await Promise.all([
    supabase.from("sites_overview").select(OVERVIEW_COLUMNS).eq("org_id", org.id).eq("id", siteId).maybeSingle(),
    fetchAll(
      (lo, hi) =>
        supabase
          .from("site_checks")
          .select("checked_at, ok, status_code, response_ms, error, tls_expires_at")
          .eq("org_id", org.id)
          .eq("site_id", siteId)
          .gt("checked_at", from.toISOString())
          .order("checked_at", { ascending: false })
          .range(lo, hi),
      "sites.detail.checks",
    ),
    loadClientOptions(org.id),
  ]);
  if (overview.error) throw overview.error;
  if (!overview.data || !isSiteRow(overview.data)) return null;

  const ctx = listContext(org, now);
  const site = toSiteListItem(overview.data, ctx);
  const checks: SiteCheck[] = rawChecks.map((c) => ({
    checkedAt: c.checked_at,
    ok: c.ok,
    statusCode: c.status_code,
    responseMs: c.response_ms,
    error: asCheckError(c.error),
    tlsExpiresAt: c.tls_expires_at,
  }));
  const threshold = ctx.thresholds.downAfterFailures;
  const runs = findIncidents(checks);
  // La caída en curso puede haber empezado antes de los 7 días: su inicio lo da la vista.
  const incidents = runs.map((run) => {
    const startedAt = run.endedAt === null && site.failingSince ? site.failingSince : run.startedAt;
    const failures = run.endedAt === null ? Math.max(run.failures, site.failures) : run.failures;
    const incident = { ...run, startedAt, failures };
    return { ...incident, minutes: incidentMinutes(incident, now), confirmed: failures >= threshold };
  });
  const dayAgo = now.getTime() - DAY_MS;

  return {
    site,
    clients,
    thresholds: ctx.thresholds,
    buckets: bucketChecks(checks, { from, to: now }),
    incidents: incidents.filter((i) => i.confirmed),
    blips: incidents.filter((i) => !i.confirmed && i.endedAt !== null).length,
    recentChecks: checks.slice(0, RECENT_CHECKS),
    avgResponseMs24h: averageResponseMs(checks.filter((c) => new Date(c.checkedAt).getTime() > dayAgo)),
  };
}
