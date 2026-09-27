import "server-only";
import { addDays, type CivilDate } from "@/domain/dates/civil-date";
import { type DayRange, periodEnd, positionGain, relativeChange, type SearchDay, searchTotals, type WebDay, webTotals } from "@/domain/seo";
import type { PortalWebData } from "@/components/portal/types";
import type { Db } from "@/server/billing/context";

/**
 * «Datos de tu web»: la variante pública (clave de servidor, filtrada por org y cliente) del
 * resumen de la ficha 360 (getClientSeoSummary): los últimos 28 días con datos de su web
 * principal frente a los 28 anteriores. Solo cifras medidas, sin estimaciones ni previsiones.
 */

const PAGE = 1000;

async function pages<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

function siteLabel(label: string, url: string | null): string {
  if (!url) return label;
  return url.replace(/^sc-domain:/, "").replace(/^https?:\/\//, "").replace(/\/$/, "") || label;
}

export async function loadPortalWebData(admin: Db, orgId: string, clientId: string, today: CivilDate): Promise<PortalWebData | null> {
  const { data: properties, error } = await admin
    .from("seo_properties_overview")
    .select("id, label, gsc_site_url, is_primary, first_metric_on, last_metric_on, first_web_on, last_web_on, metric_source, web_source")
    .eq("org_id", orgId)
    .eq("client_id", clientId)
    .is("archived_at", null);
  if (error) throw error;
  const withData = (properties ?? []).filter((p) => p.id && (p.last_metric_on || p.last_web_on));
  const property = withData.find((p) => p.is_primary) ?? withData[0];
  if (!property?.id) return null;

  const end = periodEnd(today, property.last_metric_on ?? property.last_web_on ?? null);
  const range: DayRange = { from: addDays(end, -27), to: end };
  const previous: DayRange = { from: addDays(end, -55), to: addDays(end, -28) };
  const propertyId = property.id;

  const [searchRows, webRows] = await Promise.all([
    property.last_metric_on
      ? pages((from, to) =>
          admin
            .from("seo_daily_metrics")
            .select("metric_on, clicks, impressions, position")
            .eq("org_id", orgId)
            .eq("property_id", propertyId)
            .gte("metric_on", previous.from)
            .lte("metric_on", range.to)
            .order("metric_on")
            .range(from, to),
        )
      : Promise.resolve([]),
    property.last_web_on
      ? pages((from, to) =>
          admin
            .from("web_analytics_daily")
            .select("metric_on, sessions, users, engaged_sessions, conversions")
            .eq("org_id", orgId)
            .eq("property_id", propertyId)
            .eq("channel", "organic_search")
            .gte("metric_on", previous.from)
            .lte("metric_on", range.to)
            .order("metric_on")
            .range(from, to),
        )
      : Promise.resolve([]),
  ]);

  const searchDays: SearchDay[] = searchRows.map((r) => ({
    date: r.metric_on,
    clicks: r.clicks,
    impressions: r.impressions,
    position: r.position === null ? null : Number(r.position),
  }));
  const webDays: WebDay[] = webRows.map((r) => ({
    date: r.metric_on,
    sessions: r.sessions,
    users: r.users,
    engagedSessions: r.engaged_sessions,
    conversions: r.conversions,
  }));

  const hasSearch = searchDays.length > 0;
  const hasWeb = webDays.length > 0;
  if (!hasSearch && !hasWeb) return null;
  const now = searchTotals(searchDays, range);
  const before = searchTotals(searchDays, previous);
  const webNow = webTotals(webDays, range);
  const webBefore = webTotals(webDays, previous);
  const searchComparable = hasSearch && property.first_metric_on !== null && property.first_metric_on <= previous.from;
  const webComparable = hasWeb && property.first_web_on !== null && property.first_web_on <= previous.from;

  const source = property.metric_source ?? property.web_source ?? null;
  return {
    site: siteLabel(property.label ?? "", property.gsc_site_url),
    source: source === "gsc" || source === "ga4" || source === "demo" ? source : null,
    range,
    clicks: hasSearch ? now.clicks : null,
    impressions: hasSearch ? now.impressions : null,
    position: hasSearch ? now.position : null,
    sessions: hasWeb ? webNow.sessions : null,
    change: {
      clicks: searchComparable ? relativeChange(now.clicks, before.clicks) : null,
      impressions: searchComparable ? relativeChange(now.impressions, before.impressions) : null,
      position: searchComparable ? positionGain(now.position, before.position) : null,
      sessions: webComparable ? relativeChange(webNow.sessions, webBefore.sessions) : null,
    },
  };
}
