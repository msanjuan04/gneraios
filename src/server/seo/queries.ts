import "server-only";
import { cache } from "react";
import { addDays, type CivilDate } from "@/domain/dates/civil-date";
import type { FunnelDeal, StageChange } from "@/domain/pipeline";
import { toDateRange } from "@/domain/pipeline";
import {
  channelBreakdown,
  type ChannelRow,
  type ChartPoint,
  type DataSpan,
  type DayRange,
  findOpportunities,
  minOpportunityImpressions,
  type Mover,
  movers,
  type Opportunity,
  OPPORTUNITY_RULES,
  performanceSeries,
  periodEnd,
  positionGain,
  type QueryStat,
  ratioDiff,
  relativeChange,
  resolveSeoSourceIds,
  type SearchDay,
  searchSpark,
  searchTotals,
  type SeoImpact,
  seoImpact,
  type SeoPeriodSelection,
  sparkBucketDays,
  toMover,
  type WebDay,
  webSpark,
  webTotals,
} from "@/domain/seo";
import { nowInZone } from "@/lib/clock";
import type { Database, Enums, Tables } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { getCrmConfig } from "@/server/crm/config";
import { googleSetup } from "./config";
import { grantedFeatures } from "./google-oauth";

// Lecturas de la pantalla de SEO con la sesión del usuario: todo pasa por RLS. Las agregaciones
// pesadas (consultas y páginas) las hace la RPC seo_query_stats; lo demás son series diarias que
// se agregan aquí con las funciones puras de src/domain/seo.

type Supabase = Awaited<ReturnType<typeof createClient>>;
export type SeoSource = Enums<"seo_source">;

// PostgREST corta cada respuesta en `max_rows` (1000, supabase/config.toml): se pagina.
const PAGE_SIZE = 1000;

async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

// ---------------------------------------------------------------------------
// Conexión y propiedades
// ---------------------------------------------------------------------------

export type SeoIntegrationView = {
  status: Enums<"integration_status">;
  accountEmail: string | null;
  connectedAt: string | null;
  connectedByName: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  features: { searchConsole: boolean; analytics: boolean };
};

export type SeoPropertyView = {
  id: string;
  label: string;
  clientId: string | null;
  clientName: string | null;
  gscSiteUrl: string | null;
  ga4PropertyId: string | null;
  isPrimary: boolean;
  archived: boolean;
  /** Días con datos de Search Console y de GA4. */
  searchSpan: DataSpan;
  webSpan: DataSpan;
  /** De dónde salen los últimos datos: Google o la demo. */
  source: SeoSource | null;
  gsc: { syncedFrom: string | null; syncedTo: string | null; lastRunAt: string | null; lastError: string | null };
  ga4: { syncedFrom: string | null; syncedTo: string | null; lastRunAt: string | null; lastError: string | null };
};

export type SeoSetup = {
  googleConfigured: boolean;
  missingEnv: string[];
  redirectUri: string;
  integration: SeoIntegrationView | null;
  properties: SeoPropertyView[];
};

const span = (first: string | null, last: string | null): DataSpan => (first && last ? { first, last } : null);

type PropertyOverviewRow = Database["public"]["Views"]["seo_properties_overview"]["Row"];

function toPropertyView(row: PropertyOverviewRow): SeoPropertyView | null {
  if (!row.id || !row.label) return null;
  return {
    id: row.id,
    label: row.label,
    clientId: row.client_id,
    clientName: row.client_name,
    gscSiteUrl: row.gsc_site_url,
    ga4PropertyId: row.ga4_property_id,
    isPrimary: Boolean(row.is_primary),
    archived: row.archived_at !== null,
    searchSpan: span(row.first_metric_on, row.last_metric_on),
    webSpan: span(row.first_web_on, row.last_web_on),
    source: row.metric_source ?? row.web_source,
    gsc: { syncedFrom: row.gsc_synced_from, syncedTo: row.gsc_synced_to, lastRunAt: row.gsc_last_run_at, lastError: row.gsc_last_error },
    ga4: { syncedFrom: row.ga4_synced_from, syncedTo: row.ga4_synced_to, lastRunAt: row.ga4_last_run_at, lastError: row.ga4_last_error },
  };
}

/** Orden de la lista: primero la web propia (la principal delante) y luego las de clientes. */
function compareProperties(a: SeoPropertyView, b: SeoPropertyView): number {
  const owner = (p: SeoPropertyView) => (p.clientId === null ? 0 : 1);
  return (
    owner(a) - owner(b) ||
    (a.clientName ?? "").localeCompare(b.clientName ?? "", "es") ||
    Number(b.isPrimary) - Number(a.isPrimary) ||
    a.label.localeCompare(b.label, "es")
  );
}

/** Si Google está configurado y conectado, y las propiedades de la org (también las archivadas). */
export const getSeoSetup = cache(async (orgId: string): Promise<SeoSetup> => {
  const supabase = await createClient();
  const setup = googleSetup();
  const [integrationRes, propertiesRes] = await Promise.all([
    // Nunca `select *`: el token cifrado no es legible para los miembros (y la consulta fallaría).
    supabase
      .from("integrations")
      .select("status, account_email, scopes, connected_at, connected_by, last_sync_at, last_error")
      .eq("org_id", orgId)
      .eq("provider", "google")
      .maybeSingle(),
    supabase.from("seo_properties_overview").select("*").eq("org_id", orgId),
  ]);
  if (integrationRes.error) throw integrationRes.error;
  if (propertiesRes.error) throw propertiesRes.error;

  const integration = integrationRes.data;
  let connectedByName: string | null = null;
  if (integration?.connected_by) {
    const { data } = await supabase
      .from("members")
      .select("full_name")
      .eq("org_id", orgId)
      .eq("user_id", integration.connected_by)
      .maybeSingle();
    connectedByName = data?.full_name ?? null;
  }

  return {
    googleConfigured: setup.config !== null,
    missingEnv: setup.missing,
    redirectUri: setup.redirectUri,
    integration: integration
      ? {
          status: integration.status,
          accountEmail: integration.account_email,
          connectedAt: integration.connected_at,
          connectedByName,
          lastSyncAt: integration.last_sync_at,
          lastError: integration.last_error,
          features: grantedFeatures(integration.scopes),
        }
      : null,
    properties: (propertiesRes.data ?? []).flatMap((row) => toPropertyView(row) ?? []).sort(compareProperties),
  };
});

/** La propiedad que se abre: la pedida, si existe y no está archivada; si no, la principal propia. */
export function pickProperty(properties: readonly SeoPropertyView[], requested: string | null): SeoPropertyView | null {
  const live = properties.filter((p) => !p.archived);
  return (
    live.find((p) => p.id === requested) ??
    live.find((p) => p.clientId === null && p.isPrimary) ??
    live.find((p) => p.clientId === null) ??
    live[0] ??
    null
  );
}

// ---------------------------------------------------------------------------
// Resumen de una propiedad en un periodo
// ---------------------------------------------------------------------------

export type Kpi = {
  value: number | null;
  previous: number | null;
  /** Relativa (0,12 = +12 %), en puntos (CTR) o en posiciones ganadas (posición), según la métrica. */
  change: number | null;
  spark: (number | null)[];
};

export type QueryRow = QueryStat & { ctr: number | null; clicksChange: number | null; positionDelta: number | null };

export type SeoOverview = {
  hasSearch: boolean;
  hasWeb: boolean;
  kpis: {
    clicks: Kpi;
    impressions: Kpi;
    ctr: Kpi;
    position: Kpi;
    sessions: Kpi;
    conversions: Kpi;
  };
  /** Sesiones orgánicas / todas las sesiones del periodo (GA4). */
  organicShare: number | null;
  chart: ChartPoint[];
  topQueries: QueryRow[];
  topPages: QueryRow[];
  winners: Mover[];
  losers: Mover[];
  opportunities: Opportunity[];
};

type StatRow = {
  key: string;
  clicks: number;
  impressions: number;
  avg_position: number | null;
  compare_clicks: number;
  compare_impressions: number;
  compare_avg_position: number | null;
};

function toQueryStat(row: StatRow): QueryStat {
  return {
    key: row.key,
    clicks: Number(row.clicks),
    impressions: Number(row.impressions),
    position: row.avg_position === null ? null : Number(row.avg_position),
    compareClicks: Number(row.compare_clicks),
    compareImpressions: Number(row.compare_impressions),
    comparePosition: row.compare_avg_position === null ? null : Number(row.compare_avg_position),
  };
}

function toQueryRow(stat: QueryStat, comparable: boolean): QueryRow {
  const mover = toMover(stat);
  return {
    ...stat,
    ctr: stat.impressions > 0 ? stat.clicks / stat.impressions : null,
    clicksChange: comparable ? relativeChange(stat.clicks, stat.compareClicks) : null,
    positionDelta: comparable ? mover.positionDelta : null,
  };
}

async function queryStats(
  supabase: Supabase,
  propertyId: string,
  selection: SeoPeriodSelection,
  args: { dimension: "query" | "page"; order: "clicks" | "impressions" | "gain" | "loss"; limit: number; minPosition?: number; maxPosition?: number; minImpressions?: number },
): Promise<QueryStat[]> {
  const compare = selection.comparable ? selection.compare : null;
  const { data, error } = await supabase.rpc("seo_query_stats", {
    p_property_id: propertyId,
    p_dimension: args.dimension,
    p_from: selection.range.from,
    p_to: selection.range.to,
    p_compare_from: compare?.from,
    p_compare_to: compare?.to,
    p_order: args.order,
    p_min_position: args.minPosition,
    p_max_position: args.maxPosition,
    p_min_impressions: args.minImpressions,
    p_limit: args.limit,
  });
  if (error) throw error;
  return ((data ?? []) as StatRow[]).map(toQueryStat);
}

async function loadSearchDays(supabase: Supabase, propertyId: string, range: DayRange): Promise<SearchDay[]> {
  const rows = await fetchAll((from, to) =>
    supabase
      .from("seo_daily_metrics")
      .select("metric_on, clicks, impressions, position")
      .eq("property_id", propertyId)
      .gte("metric_on", range.from)
      .lte("metric_on", range.to)
      .order("metric_on")
      .range(from, to),
  );
  return rows.map((r) => ({ date: r.metric_on, clicks: r.clicks, impressions: r.impressions, position: r.position === null ? null : Number(r.position) }));
}

async function loadWebDays(supabase: Supabase, propertyId: string, range: DayRange): Promise<{ all: WebDay[]; organic: WebDay[] }> {
  const rows = await fetchAll((from, to) =>
    supabase
      .from("web_analytics_daily")
      .select("metric_on, channel, sessions, users, engaged_sessions, conversions")
      .eq("property_id", propertyId)
      .gte("metric_on", range.from)
      .lte("metric_on", range.to)
      .order("metric_on")
      .order("channel")
      .range(from, to),
  );
  const toDay = (r: (typeof rows)[number]): WebDay => ({
    date: r.metric_on,
    sessions: r.sessions,
    users: r.users,
    engagedSessions: r.engaged_sessions,
    conversions: r.conversions,
  });
  return { all: rows.filter((r) => r.channel === "all").map(toDay), organic: rows.filter((r) => r.channel === "organic_search").map(toDay) };
}

const union = (a: DayRange, b: DayRange): DayRange => ({ from: a.from < b.from ? a.from : b.from, to: a.to > b.to ? a.to : b.to });

export async function getSeoOverview(property: SeoPropertyView, selection: SeoPeriodSelection): Promise<SeoOverview> {
  const supabase = await createClient();
  const { range, compare, comparable, days } = selection;
  const window = union(range, compare);
  const bucket = sparkBucketDays(days);
  const hasSearch = property.searchSpan !== null;
  const hasWeb = property.webSpan !== null;

  const [searchDays, web, topQueries, topPages, gains, losses, candidates] = await Promise.all([
    hasSearch ? loadSearchDays(supabase, property.id, window) : Promise.resolve([]),
    hasWeb ? loadWebDays(supabase, property.id, window) : Promise.resolve({ all: [], organic: [] }),
    hasSearch ? queryStats(supabase, property.id, selection, { dimension: "query", order: "clicks", limit: 50 }) : Promise.resolve([]),
    hasSearch ? queryStats(supabase, property.id, selection, { dimension: "page", order: "clicks", limit: 50 }) : Promise.resolve([]),
    hasSearch && comparable ? queryStats(supabase, property.id, selection, { dimension: "query", order: "gain", limit: 20 }) : Promise.resolve([]),
    hasSearch && comparable ? queryStats(supabase, property.id, selection, { dimension: "query", order: "loss", limit: 20 }) : Promise.resolve([]),
    hasSearch
      ? queryStats(supabase, property.id, selection, {
          dimension: "query",
          order: "impressions",
          limit: 100,
          minPosition: OPPORTUNITY_RULES.minPosition,
          maxPosition: OPPORTUNITY_RULES.maxPosition,
          minImpressions: minOpportunityImpressions(days),
        })
      : Promise.resolve([]),
  ]);

  const current = searchTotals(searchDays, range);
  const previous = comparable ? searchTotals(searchDays, compare) : null;
  const organicNow = webTotals(web.organic, range);
  const organicBefore = comparable ? webTotals(web.organic, compare) : null;
  const allNow = webTotals(web.all, range);

  const kpi = (value: number | null, before: number | null, change: number | null, spark: (number | null)[]): Kpi => ({
    value,
    previous: before,
    change,
    spark,
  });

  return {
    hasSearch,
    hasWeb,
    kpis: {
      clicks: kpi(current.clicks, previous?.clicks ?? null, relativeChange(current.clicks, previous?.clicks ?? null), searchSpark(searchDays, range, "clicks", bucket)),
      impressions: kpi(
        current.impressions,
        previous?.impressions ?? null,
        relativeChange(current.impressions, previous?.impressions ?? null),
        searchSpark(searchDays, range, "impressions", bucket),
      ),
      ctr: kpi(current.ctr, previous?.ctr ?? null, ratioDiff(current.ctr, previous?.ctr ?? null), searchSpark(searchDays, range, "ctr", bucket)),
      position: kpi(
        current.position,
        previous?.position ?? null,
        positionGain(current.position, previous?.position ?? null),
        searchSpark(searchDays, range, "position", bucket),
      ),
      sessions: kpi(
        hasWeb ? organicNow.sessions : null,
        organicBefore?.sessions ?? null,
        relativeChange(organicNow.sessions, organicBefore?.sessions ?? null),
        hasWeb ? webSpark(web.organic, range, "sessions", bucket) : [],
      ),
      conversions: kpi(
        hasWeb ? organicNow.conversions : null,
        organicBefore?.conversions ?? null,
        relativeChange(organicNow.conversions, organicBefore?.conversions ?? null),
        hasWeb ? webSpark(web.organic, range, "conversions", bucket) : [],
      ),
    },
    organicShare: hasWeb && allNow.sessions > 0 ? organicNow.sessions / allNow.sessions : null,
    chart: hasSearch ? performanceSeries(searchDays, range, comparable ? compare : null) : [],
    topQueries: topQueries.map((s) => toQueryRow(s, comparable)),
    topPages: topPages.map((s) => toQueryRow(s, comparable)),
    winners: movers(gains, "up", 6),
    losers: movers(losses, "down", 6),
    opportunities: findOpportunities(candidates, days, 8),
  };
}

// ---------------------------------------------------------------------------
// SEO → negocio (CRM)
// ---------------------------------------------------------------------------

export type SeoBusiness = {
  sources: { id: string; name: string }[];
  seoSourceIds: string[];
  /** Si la org ha elegido las fuentes o es la sugerencia por nombre. */
  custom: boolean;
  rows: ChannelRow[];
  impact: SeoImpact;
};

/**
 * Leads, ganados y facturación por fuente de adquisición en el periodo (el mismo de la pantalla),
 * con lo que suman las fuentes que cuentan como SEO.
 */
export async function getSeoBusiness(org: Pick<Tables<"orgs">, "id" | "timezone" | "settings">, range: DayRange): Promise<SeoBusiness> {
  const supabase = await createClient();
  const today = nowInZone(org.timezone).date;
  const [config, deals, history, clients, invoices] = await Promise.all([
    getCrmConfig(org.id),
    fetchAll((from, to) =>
      supabase
        .from("deals")
        .select("id, created_at, stage_id, source_id, brought_by_member_id, owner_member_id, loss_reason_id, est_one_off_cents, est_mrr_cents")
        .eq("org_id", org.id)
        .is("archived_at", null)
        .order("created_at")
        .order("id")
        .range(from, to),
    ),
    fetchAll((from, to) =>
      supabase
        .from("deal_stage_history")
        .select("deal_id, from_stage_id, to_stage_id, changed_at")
        .eq("org_id", org.id)
        .order("changed_at")
        .order("id")
        .range(from, to),
    ),
    fetchAll((from, to) =>
      supabase
        .from("clients_overview")
        .select("id, acquisition_source_id, billed_net_cents")
        .eq("org_id", org.id)
        .order("id")
        .range(from, to),
    ),
    fetchAll((from, to) =>
      supabase
        .from("invoices")
        .select("id, client_id, subtotal_cents")
        .eq("org_id", org.id)
        .eq("lifecycle", "issued")
        .gte("issued_on", range.from)
        .lte("issued_on", range.to)
        .order("id")
        .range(from, to),
    ),
  ]);

  const funnelDeals: FunnelDeal[] = deals.map((d) => ({
    id: d.id,
    createdAt: d.created_at,
    stageId: d.stage_id,
    sourceId: d.source_id,
    broughtById: d.brought_by_member_id,
    ownerId: d.owner_member_id,
    lossReasonId: d.loss_reason_id,
    estOneOffCents: d.est_one_off_cents,
    estMrrCents: d.est_mrr_cents,
  }));
  const live = new Set(funnelDeals.map((d) => d.id));
  const changes: StageChange[] = history
    .filter((h) => live.has(h.deal_id))
    .map((h) => ({ dealId: h.deal_id, fromStageId: h.from_stage_id, toStageId: h.to_stage_id, changedAt: h.changed_at }));

  const rows = channelBreakdown({
    deals: funnelDeals,
    history: changes,
    stages: config.stages.map(({ id, name, position, kind }) => ({ id, name, position, kind })),
    range: toDateRange({ from: range.from, to: range.to }, today, org.timezone),
    clients: clients.flatMap((c) =>
      c.id ? [{ id: c.id, sourceId: c.acquisition_source_id, lifetimeBilledCents: Number(c.billed_net_cents ?? 0) }] : [],
    ),
    invoices: invoices.map((i) => ({ clientId: i.client_id, subtotalCents: Number(i.subtotal_cents) })),
  });
  const { ids, custom } = resolveSeoSourceIds(org.settings, config.sources);
  return { sources: config.sources, seoSourceIds: ids, custom, rows, impact: seoImpact(rows, ids) };
}

// ---------------------------------------------------------------------------
// La web de un cliente: su relación con la agencia
// ---------------------------------------------------------------------------

export type ClientRelation = {
  clientId: string;
  name: string;
  status: Enums<"client_status">;
  billedNetCents: number;
  firstInvoiceOn: string | null;
  /** Clics de los primeros 28 días con datos desde que se trabaja con él frente a los últimos 28. */
  sinceStart: { from: DayRange; to: DayRange; before: number; now: number; change: number | null; fromStart: boolean } | null;
};

export async function getClientRelation(property: SeoPropertyView, today: CivilDate): Promise<ClientRelation | null> {
  if (!property.clientId) return null;
  const supabase = await createClient();
  const { data: client, error } = await supabase
    .from("clients_overview")
    .select("id, display_name, status, billed_net_cents, first_invoice_on")
    .eq("id", property.clientId)
    .maybeSingle();
  if (error) throw error;
  if (!client?.id) return null;

  let sinceStart: ClientRelation["sinceStart"] = null;
  const dataSpan = property.searchSpan;
  if (dataSpan) {
    const end = periodEnd(today, dataSpan.last);
    // Desde la primera factura si cae dentro de los datos; si no, desde el primer día con datos.
    const startAt = client.first_invoice_on && client.first_invoice_on > dataSpan.first ? client.first_invoice_on : dataSpan.first;
    const first = { from: startAt, to: addDays(startAt, 27) };
    const last = { from: addDays(end, -27), to: end };
    if (first.to < last.from) {
      const days = await loadSearchDays(supabase, property.id, { from: first.from, to: last.to });
      const before = searchTotals(days, first).clicks;
      const now = searchTotals(days, last).clicks;
      sinceStart = { from: first, to: last, before, now, change: relativeChange(now, before), fromStart: startAt === client.first_invoice_on };
    }
  }

  return {
    clientId: client.id,
    name: client.display_name ?? "",
    status: client.status ?? "lead",
    billedNetCents: Number(client.billed_net_cents ?? 0),
    firstInvoiceOn: client.first_invoice_on,
    sinceStart,
  };
}

// ---------------------------------------------------------------------------
// Tarjeta de la ficha 360 del cliente
// ---------------------------------------------------------------------------

export type ClientSeoSummary = {
  propertyId: string;
  label: string;
  siteUrl: string | null;
  source: SeoSource | null;
  /** Otras webs del mismo cliente (se ven desde SEO). */
  otherProperties: number;
  range: DayRange;
  clicks: number;
  impressions: number;
  ctr: number | null;
  position: number | null;
  change: { clicks: number | null; impressions: number | null; ctr: number | null; position: number | null };
  /** Clics por día de los últimos 28 días. */
  spark: number[];
  organicSessions: number | null;
  organicConversions: number | null;
};

/**
 * Lo esencial del SEO de un cliente para su ficha: los últimos 28 días con datos de su web
 * principal (o la primera), frente a los 28 anteriores. null si no tiene ninguna web conectada.
 */
export async function getClientSeoSummary(orgId: string, clientId: string): Promise<ClientSeoSummary | null> {
  const supabase = await createClient();
  const [{ data: org, error: orgError }, { data: rows, error }] = await Promise.all([
    supabase.from("orgs").select("timezone").eq("id", orgId).single(),
    supabase.from("seo_properties_overview").select("*").eq("org_id", orgId).eq("client_id", clientId).is("archived_at", null),
  ]);
  if (orgError) throw orgError;
  if (error) throw error;
  const properties = (rows ?? []).flatMap((r) => toPropertyView(r) ?? []);
  const property = properties.find((p) => p.isPrimary) ?? properties.find((p) => p.searchSpan) ?? properties[0];
  if (!property) return null;

  const end = periodEnd(nowInZone(org.timezone).date, property.searchSpan?.last ?? property.webSpan?.last ?? null);
  const range = { from: addDays(end, -27), to: end };
  const previous = { from: addDays(end, -55), to: addDays(end, -28) };
  const [searchDays, web] = await Promise.all([
    property.searchSpan ? loadSearchDays(supabase, property.id, { from: previous.from, to: end }) : Promise.resolve([]),
    property.webSpan ? loadWebDays(supabase, property.id, range) : Promise.resolve({ all: [], organic: [] }),
  ]);
  const now = searchTotals(searchDays, range);
  const before = searchTotals(searchDays, previous);
  const comparable = property.searchSpan !== null && property.searchSpan.first <= previous.from;
  const organic = webTotals(web.organic, range);

  return {
    propertyId: property.id,
    label: property.label,
    siteUrl: property.gscSiteUrl,
    source: property.source,
    otherProperties: properties.length - 1,
    range,
    clicks: now.clicks,
    impressions: now.impressions,
    ctr: now.ctr,
    position: now.position,
    change: comparable
      ? {
          clicks: relativeChange(now.clicks, before.clicks),
          impressions: relativeChange(now.impressions, before.impressions),
          ctr: ratioDiff(now.ctr, before.ctr),
          position: positionGain(now.position, before.position),
        }
      : { clicks: null, impressions: null, ctr: null, position: null },
    spark: searchSpark(searchDays, range, "clicks", 1).map((v) => v ?? 0),
    organicSessions: property.webSpan ? organic.sessions : null,
    organicConversions: property.webSpan ? organic.conversions : null,
  };
}
