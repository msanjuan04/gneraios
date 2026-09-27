// Sin "server-only": el cron diario (y quien lo necesite, como un script) importa este módulo tal
// cual, igual que src/server/billing/engine.ts. Usa la clave secreta: solo servidor.
//
// Sincronización de SEO de una org: por cada propiedad y proveedor (Search Console, GA4) planifica
// los tramos que faltan (src/domain/seo/sync-plan.ts), los descarga con respeto a las cuotas y los
// guarda con upserts por su clave natural. Repetir un día no duplica nada; si se agota el tiempo,
// la siguiente ejecución sigue donde se quedó. Cada ejecución queda en job_runs.

import type { PostgrestError } from "@supabase/supabase-js";
import type { CivilDate } from "@/domain/dates/civil-date";
import {
  type Coverage,
  type DayRange,
  type FactSink,
  mergeCoverage,
  planSync,
  type SeoProvider,
  type SeoProviderId,
  type SyncProperty,
} from "@/domain/seo";
import { nowInZone } from "@/lib/clock";
import type { Json } from "@/lib/supabase/database.types";
import { googleSetup } from "./config";
import { resolveSearchConsoleSite } from "@/domain/seo/site-url";
import { GoogleApiError, listSearchConsoleSites } from "./google-api";
import { grantedFeatures } from "./google-oauth";
import { type AdminDb, type GoogleSessionOptions, markReconnectNeeded, openGoogleSession, SeoConnectionError } from "./google-session";
import { AnalyticsProvider, SearchConsoleProvider } from "./providers";

export { SeoConnectionError } from "./google-session";

export const SEO_SYNC_JOB = "seo_sync";
/** Tiempo por defecto de una ejecución; lo que no quepa se hace en la siguiente. */
const DEFAULT_BUDGET_MS = 4 * 60_000;
/** Filas por upsert (PostgREST acepta más, pero así ninguna petición es enorme). */
const UPSERT_BATCH = 1000;

/** Ya hay una sincronización en curso para esa org (índice único de job_runs). */
export class SeoSyncBusyError extends Error {
  constructor() {
    super("seo_sync_busy");
    this.name = "SeoSyncBusyError";
  }
}

export type SeoSyncOptions = GoogleSessionOptions & {
  /** Rango explícito (ambos incluidos): se vuelve a descargar tal cual. Sin él, lo que falte. */
  from?: CivilDate;
  to?: CivilDate;
  /** Solo estas propiedades (p. ej. la que se acaba de añadir). */
  propertyIds?: readonly string[];
  /** Milisegundos antes de dejar lo que falte para la próxima ejecución. */
  budgetMs?: number;
  /** "Hoy" en la zona de la org (para tests y para reconstruir un día concreto). */
  today?: CivilDate;
};

export type SeoSyncItem = {
  propertyId: string;
  provider: SeoProviderId;
  rows: number;
  coverage: Coverage;
  /** Quedan tramos por descargar (se acabó el tiempo): los hará la siguiente ejecución. */
  pending: boolean;
  error: string | null;
};

export type SeoSyncSummary = { orgId: string; runOn: CivilDate; rows: number; items: SeoSyncItem[]; pending: boolean; errors: number };

function dbError(error: PostgrestError, where: string): Error {
  return new Error(`${where}: ${error.message}`);
}

async function inBatches<T>(rows: readonly T[], write: (batch: T[]) => PromiseLike<{ error: PostgrestError | null }>, where: string) {
  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    const { error } = await write(rows.slice(i, i + UPSERT_BATCH));
    if (error) throw dbError(error, where);
  }
}

/** Dónde dejan los proveedores lo que descargan: upserts por la clave primaria de cada tabla. */
export function createFactSink(admin: AdminDb, property: SyncProperty): FactSink {
  const ids = { org_id: property.orgId, property_id: property.id };
  return {
    searchDaily: (rows) =>
      inBatches(
        rows.map((r) => ({ ...ids, metric_on: r.metricOn, clicks: r.clicks, impressions: r.impressions, position: r.position, source: "gsc" as const })),
        (batch) => admin.from("seo_daily_metrics").upsert(batch, { onConflict: "property_id,metric_on" }),
        "seo.searchDaily",
      ),
    queryDaily: (rows) =>
      inBatches(
        rows.map((r) => ({
          ...ids,
          metric_on: r.metricOn,
          query: r.query,
          page: r.page,
          clicks: r.clicks,
          impressions: r.impressions,
          position: r.position,
          source: "gsc" as const,
        })),
        (batch) => admin.from("seo_query_daily").upsert(batch, { onConflict: "property_id,metric_on,key_hash" }),
        "seo.queryDaily",
      ),
    webDaily: (rows) =>
      inBatches(
        rows.map((r) => ({
          ...ids,
          metric_on: r.metricOn,
          channel: r.channel,
          sessions: r.sessions,
          users: r.users,
          engaged_sessions: r.engagedSessions,
          conversions: r.conversions,
          source: "ga4" as const,
        })),
        (batch) => admin.from("web_analytics_daily").upsert(batch, { onConflict: "property_id,metric_on,channel" }),
        "seo.webDaily",
      ),
  };
}

/** La primera sincronización real de una propiedad borra los datos de demo que tuviera. */
async function dropDemoFacts(admin: AdminDb, propertyId: string, provider: SeoProviderId) {
  const tables = provider === "gsc" ? (["seo_daily_metrics", "seo_query_daily"] as const) : (["web_analytics_daily"] as const);
  for (const table of tables) {
    const { error } = await admin.from(table).delete().eq("property_id", propertyId).eq("source", "demo");
    if (error) throw dbError(error, `seo.dropDemo.${table}`);
  }
}

async function saveState(
  admin: AdminDb,
  property: SyncProperty,
  provider: SeoProviderId,
  coverage: Coverage,
  lastError: string | null,
) {
  const { error } = await admin.from("seo_sync_state").upsert(
    {
      org_id: property.orgId,
      property_id: property.id,
      provider,
      synced_from: coverage?.from ?? null,
      synced_to: coverage?.to ?? null,
      last_run_at: new Date().toISOString(),
      last_error: lastError?.slice(0, 500) ?? null,
    },
    { onConflict: "property_id,provider" },
  );
  if (error) throw dbError(error, "seo.state");
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Sincroniza una org. Lanza SeoConnectionError si Google no está configurado o conectado (o hay que
 * reconectar) y SeoSyncBusyError si ya hay otra ejecución en curso. Los fallos de una propiedad
 * (p. ej. la cuenta ya no tiene acceso a esa web) se anotan en ella y no paran a las demás.
 */
export async function syncSeo(admin: AdminDb, orgId: string, opts: SeoSyncOptions = {}): Promise<SeoSyncSummary> {
  const config = opts.config ?? googleSetup().config;
  if (!config) throw new SeoConnectionError("not_configured");
  const { data: org, error: orgError } = await admin.from("orgs").select("id, timezone").eq("id", orgId).single();
  if (orgError) throw dbError(orgError, "seo.org");
  const today = opts.today ?? nowInZone(org.timezone).date;
  const session = await openGoogleSession(admin, orgId, { ...opts, config });

  // Una ejecución colgada más de 15 minutos se da por fallida para no bloquear la siguiente.
  await admin
    .from("job_runs")
    .update({ status: "failed", finished_at: new Date().toISOString(), error: "timeout" })
    .eq("org_id", orgId)
    .eq("job", SEO_SYNC_JOB)
    .eq("status", "running")
    .lt("started_at", new Date(Date.now() - 15 * 60_000).toISOString());
  const started = await admin.from("job_runs").insert({ org_id: orgId, job: SEO_SYNC_JOB, run_on: today }).select("id").single();
  if (started.error) {
    if (started.error.code === "23505") throw new SeoSyncBusyError();
    throw dbError(started.error, "seo.lock");
  }

  const deadline = Date.now() + (opts.budgetMs ?? DEFAULT_BUDGET_MS);
  const explicit: DayRange | undefined = opts.from && opts.to ? { from: opts.from, to: opts.to } : undefined;
  const granted = grantedFeatures(session.scopes);
  const providers: SeoProvider[] = [
    ...(granted.searchConsole ? [new SearchConsoleProvider(session.client)] : []),
    ...(granted.analytics ? [new AnalyticsProvider(session.client)] : []),
  ];

  try {
    let query = admin
      .from("seo_properties")
      .select("id, org_id, gsc_site_url, ga4_property_id")
      .eq("org_id", orgId)
      .is("archived_at", null)
      .order("created_at");
    if (opts.propertyIds) query = query.in("id", [...opts.propertyIds]);
    const [{ data: properties, error: propertiesError }, { data: states, error: statesError }] = await Promise.all([
      query,
      admin.from("seo_sync_state").select("property_id, provider, synced_from, synced_to").eq("org_id", orgId),
    ]);
    if (propertiesError) throw dbError(propertiesError, "seo.properties");
    if (statesError) throw dbError(statesError, "seo.states");

    // La web de Search Console tiene que ser la propiedad EXACTA de la cuenta (p. ej.
    // "sc-domain:gnerai.com"): lo escrito a mano se resuelve y se corrige aquí, una vez por sync.
    let siteUrls: string[] | null = null;
    if (granted.searchConsole) {
      try {
        const sites = await listSearchConsoleSites(session.client);
        siteUrls = sites.map((site) => site.siteUrl);
        // La lista exacta queda guardada: la pantalla de webs propone las que faltan.
        await admin
          .from("integrations")
          .update({ discovered_sites: sites as unknown as Json, discovered_at: new Date().toISOString() })
          .eq("id", session.integrationId);
      } catch (error) {
        if (error instanceof GoogleApiError && error.status === 401) {
          await markReconnectNeeded(admin, session.integrationId, error.message);
          throw new SeoConnectionError("reconnect");
        }
        siteUrls = null;
      }
    }

    const items: SeoSyncItem[] = [];
    for (const row of properties) {
      if (row.gsc_site_url && siteUrls) {
        const resolved = resolveSearchConsoleSite(row.gsc_site_url, siteUrls);
        if (resolved && resolved !== row.gsc_site_url) {
          await admin.from("seo_properties").update({ gsc_site_url: resolved }).eq("id", row.id);
          row.gsc_site_url = resolved;
        }
      }
      const property: SyncProperty = { id: row.id, orgId: row.org_id, gscSiteUrl: row.gsc_site_url, ga4PropertyId: row.ga4_property_id };
      const sink = createFactSink(admin, property);
      for (const provider of providers.filter((p) => p.appliesTo(property))) {
        const state = states.find((s) => s.property_id === property.id && s.provider === provider.id);
        let coverage: Coverage = state?.synced_from && state.synced_to ? { from: state.synced_from, to: state.synced_to } : null;
        const item: SeoSyncItem = { propertyId: property.id, provider: provider.id, rows: 0, coverage, pending: false, error: null };
        items.push(item);
        try {
          if (!state) await dropDemoFacts(admin, property.id, provider.id);
          const plan = planSync(
            coverage,
            { availability: provider.availability(today), resyncDays: provider.resyncDays, windowDays: provider.windowDays },
            explicit,
          );
          for (const range of plan) {
            if (Date.now() > deadline) {
              item.pending = true;
              break;
            }
            item.rows += await provider.fetchRange(property, range, sink);
            coverage = mergeCoverage(coverage, range);
            item.coverage = coverage;
            await saveState(admin, property, provider.id, coverage, null);
          }
          if (plan.length === 0) await saveState(admin, property, provider.id, coverage, null);
        } catch (error) {
          if (error instanceof SeoConnectionError) throw error;
          // Un 401 que persiste tras refrescar: el acceso a Google ya no vale para nada.
          if (error instanceof GoogleApiError && error.status === 401) {
            await markReconnectNeeded(admin, session.integrationId, error.message);
            throw new SeoConnectionError("reconnect");
          }
          item.error = errorMessage(error);
          await saveState(admin, property, provider.id, coverage, item.error);
        }
      }
    }

    const summary: SeoSyncSummary = {
      orgId,
      runOn: today,
      rows: items.reduce((sum, i) => sum + i.rows, 0),
      items,
      pending: items.some((i) => i.pending),
      errors: items.filter((i) => i.error).length,
    };
    const firstError = items.find((i) => i.error)?.error ?? null;
    await admin
      .from("integrations")
      .update({ last_sync_at: new Date().toISOString(), last_error: firstError?.slice(0, 500) ?? null })
      .eq("id", session.integrationId);
    await admin
      .from("job_runs")
      .update({ status: "succeeded", finished_at: new Date().toISOString(), summary: summary as unknown as Json })
      .eq("id", started.data.id);
    return summary;
  } catch (error) {
    await admin
      .from("job_runs")
      .update({ status: "failed", finished_at: new Date().toISOString(), error: errorMessage(error).slice(0, 1000) })
      .eq("id", started.data.id);
    if (!(error instanceof SeoConnectionError)) {
      await admin.from("integrations").update({ last_error: errorMessage(error).slice(0, 500) }).eq("id", session.integrationId);
    }
    throw error;
  }
}

/**
 * El cron de todas las orgs con Google conectado, una detrás de otra (las cuotas de Google son por
 * proyecto de Cloud: en paralelo solo se estorbarían). Sin Google configurado, no hace nada.
 */
export async function runDailySeoSync(
  admin: AdminDb,
  opts: Omit<SeoSyncOptions, "from" | "to" | "propertyIds" | "today"> = {},
): Promise<Array<SeoSyncSummary | { orgId: string; error: string }>> {
  if (!(opts.config ?? googleSetup().config)) return [];
  const { data, error } = await admin.from("integrations").select("org_id").eq("provider", "google").eq("status", "connected");
  if (error) throw dbError(error, "seo.cron.orgs");
  const results: Array<SeoSyncSummary | { orgId: string; error: string }> = [];
  for (const { org_id: orgId } of data) {
    try {
      results.push(await syncSeo(admin, orgId, opts));
    } catch (e) {
      console.error("[cron] seo", orgId, e);
      results.push({ orgId, error: errorMessage(e) });
    }
  }
  return results;
}
