"use server";

import { resolveSearchConsoleSite, siteHost } from "@/domain/seo/site-url";

import type { PostgrestError } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { SEO_SOURCES_SETTING } from "@/domain/seo";
import type { ActionResult } from "@/lib/action-result";
import type { Json } from "@/lib/supabase/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { dbFailure, failure, forbidden, idSchema, invalidInput, ownerContext, partnerContext } from "@/server/action-utils";
import {
  type Ga4PropertyOption,
  listGa4Properties,
  listSearchConsoleSites,
  type SearchConsoleSite,
} from "@/server/seo/google-api";
import { grantedFeatures, revokeToken } from "@/server/seo/google-oauth";
import { openGoogleSession, SeoConnectionError } from "@/server/seo/google-session";
import { SeoSyncBusyError, syncSeo } from "@/server/seo/run";
import { normalizeGa4Id, type PropertyFormInput, propertyFormSchema, seoSourcesSchema } from "./schema";

/** Tiempo de una sincronización lanzada a mano (lo que falte lo hace el cron). */
const MANUAL_SYNC_BUDGET_MS = 25_000;

function revalidateSeo(slug: string) {
  revalidatePath(`/${slug}/seo`);
  revalidatePath(`/${slug}/seo/properties`);
}

const isDuplicate = (error: PostgrestError, index: string) => error.code === "23505" && error.message.includes(index);

function propertyError(error: PostgrestError): string | undefined {
  if (isDuplicate(error, "seo_properties_gsc_idx")) return "seo.errors.duplicateSite";
  if (isDuplicate(error, "seo_properties_ga4_idx")) return "seo.errors.duplicateGa4";
  if (isDuplicate(error, "seo_properties_one_primary_idx")) return "seo.errors.primaryConflict";
  if (error.code === "23503") return "seo.errors.clientNotFound";
  return undefined;
}

/** Sincroniza en segundo plano, después de responder (la primera carga puede tardar un par de minutos). */
function syncLater(orgId: string, propertyIds?: string[]) {
  after(async () => {
    try {
      await syncSeo(createAdminClient(), orgId, { propertyIds });
    } catch (error) {
      if (!(error instanceof SeoConnectionError) && !(error instanceof SeoSyncBusyError)) console.error("[seo] sync", orgId, error);
    }
  });
}

async function googleConnected(orgId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.from("integrations").select("status").eq("org_id", orgId).eq("provider", "google").maybeSingle();
  return data?.status === "connected";
}

/** Crea o edita una propiedad. Si cambia de dónde salen los datos y Google está conectado, sincroniza. */
/** Las propiedades de Search Console de la cuenta conectada, o null si no se pueden consultar. */
async function accountSiteUrls(orgId: string): Promise<string[] | null> {
  try {
    const session = await openGoogleSession(createAdminClient(), orgId);
    if (!grantedFeatures(session.scopes).searchConsole) return null;
    return (await listSearchConsoleSites(session.client)).map((site) => site.siteUrl);
  } catch {
    return null;
  }
}

export async function saveSeoProperty(
  slug: string,
  propertyId: string | null,
  input: PropertyFormInput,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const parsed = propertyFormSchema.safeParse(input);
  const id = propertyId === null ? null : idSchema.safeParse(propertyId);
  if (!parsed.success || (id && !id.success)) return invalidInput();

  const values = parsed.data;
  // Con Google conectado, la web tiene que ser una propiedad real de la cuenta: lo escrito a mano
  // ("https://gnerai.com") se convierte en la propiedad exacta ("sc-domain:gnerai.com").
  let gscSiteUrl = values.gsc_site_url || null;
  if (gscSiteUrl) {
    const sites = await accountSiteUrls(ctx.org.id);
    if (sites) {
      const resolved = resolveSearchConsoleSite(gscSiteUrl, sites);
      if (!resolved) return failure("seo.errors.gscSiteNotFound");
      gscSiteUrl = resolved;
    }
  }
  const row = {
    label: values.label,
    client_id: values.owner === "client" ? values.client_id : null,
    gsc_site_url: gscSiteUrl,
    ga4_property_id: values.ga4_property_id ? normalizeGa4Id(values.ga4_property_id) : null,
    is_primary: values.is_primary,
  };
  const supabase = await createClient();

  let savedId: string;
  let sourcesChanged = true;
  if (id) {
    const { data: before, error: loadError } = await supabase
      .from("seo_properties")
      .select("gsc_site_url, ga4_property_id, archived_at")
      .eq("org_id", ctx.org.id)
      .eq("id", id.data)
      .maybeSingle();
    if (loadError) return dbFailure(loadError, "seo.property.load");
    if (!before) return failure("seo.errors.notFound");
    if (before.archived_at) return failure("seo.errors.archived");
    sourcesChanged = before.gsc_site_url !== row.gsc_site_url || before.ga4_property_id !== row.ga4_property_id;

    const { data, error } = await supabase.from("seo_properties").update(row).eq("org_id", ctx.org.id).eq("id", id.data).select("id");
    if (error) return dbFailure(error, "seo.property.update", propertyError);
    if (data.length === 0) return forbidden();
    savedId = id.data;
  } else {
    const { data, error } = await supabase
      .from("seo_properties")
      .insert({ ...row, org_id: ctx.org.id })
      .select("id")
      .single();
    if (error) return dbFailure(error, "seo.property.insert", propertyError);
    savedId = data.id;
  }

  if (sourcesChanged && (await googleConnected(ctx.org.id))) syncLater(ctx.org.id, [savedId]);
  revalidateSeo(ctx.org.slug);
  return { ok: true, id: savedId };
}

/** Da de alta con un clic una web detectada en el Search Console de la cuenta (y la sincroniza). */
export async function addDiscoveredSite(slug: string, siteUrl: string, clientId: string | null): Promise<ActionResult<{ id: string }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const client = clientId === null ? null : idSchema.safeParse(clientId);
  const host = typeof siteUrl === "string" && siteUrl.length <= 2048 ? siteHost(siteUrl) : null;
  if (!host || (client && !client.success)) return invalidInput();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("seo_properties")
    .insert({
      org_id: ctx.org.id,
      label: host,
      client_id: client?.success ? client.data : null,
      gsc_site_url: siteUrl,
      is_primary: false,
    })
    .select("id")
    .single();
  if (error) return dbFailure(error, "seo.discovered.insert", propertyError);
  syncLater(ctx.org.id, [data.id]);
  revalidateSeo(ctx.org.slug);
  return { ok: true, id: data.id };
}

/** Archiva o recupera una propiedad (sus datos se conservan). */
export async function setSeoPropertyArchived(slug: string, propertyId: string, archived: boolean): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(propertyId);
  if (!id.success || typeof archived !== "boolean") return invalidInput();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("seo_properties")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("org_id", ctx.org.id)
    .eq("id", id.data)
    .select("id");
  if (error) return dbFailure(error, "seo.property.archive", propertyError);
  if (data.length === 0) return forbidden();
  revalidateSeo(ctx.org.slug);
  return { ok: true };
}

export type SyncNowResult = ActionResult<{ rows: number; pending: boolean; errors: number }>;

/** Sincroniza ahora (unos segundos como mucho; si queda histórico por cargar, sigue el cron). */
export async function syncSeoNow(slug: string): Promise<SyncNowResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  try {
    const summary = await syncSeo(createAdminClient(), ctx.org.id, { budgetMs: MANUAL_SYNC_BUDGET_MS });
    revalidateSeo(ctx.org.slug);
    return { ok: true, rows: summary.rows, pending: summary.pending, errors: summary.errors };
  } catch (error) {
    if (error instanceof SeoSyncBusyError) return failure("seo.errors.syncBusy");
    if (error instanceof SeoConnectionError) {
      revalidateSeo(ctx.org.slug);
      return failure(error.code === "reconnect" ? "seo.errors.reconnect" : "seo.errors.notConnected");
    }
    console.error("[seo] syncSeoNow", error);
    return failure("seo.errors.sync");
  }
}

/** Desconecta Google: revoca el acceso en Google y borra el token. Los datos se quedan. */
export async function disconnectGoogle(slug: string): Promise<ActionResult> {
  const ctx = await ownerContext(slug);
  if (!ctx) return failure("common.ownerOnly");
  try {
    const session = await openGoogleSession(createAdminClient(), ctx.org.id);
    await revokeToken((input, init) => fetch(input, init), session.refreshToken);
  } catch (error) {
    // Sin token legible o sin configuración, no hay nada que revocar: se borra igual.
    if (!(error instanceof SeoConnectionError)) console.error("[seo] revoke", error);
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("disconnect_integration", { p_org: ctx.org.id, p_provider: "google" });
  if (error) return dbFailure(error, "seo.disconnect");
  revalidateSeo(ctx.org.slug);
  return { ok: true };
}

export type GoogleOptions = {
  sites: SearchConsoleSite[];
  properties: Ga4PropertyOption[];
  features: { searchConsole: boolean; analytics: boolean };
};

/** Las webs de Search Console y las propiedades de GA4 de la cuenta conectada, para elegir. */
export async function loadGoogleOptions(slug: string): Promise<ActionResult<GoogleOptions>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  try {
    const session = await openGoogleSession(createAdminClient(), ctx.org.id);
    const features = grantedFeatures(session.scopes);
    const [sites, properties] = await Promise.all([
      features.searchConsole ? listSearchConsoleSites(session.client) : Promise.resolve([]),
      features.analytics ? listGa4Properties(session.client) : Promise.resolve([]),
    ]);
    return { ok: true, sites, properties, features };
  } catch (error) {
    if (error instanceof SeoConnectionError) {
      return failure(error.code === "reconnect" ? "seo.errors.reconnect" : "seo.errors.notConnected");
    }
    console.error("[seo] loadGoogleOptions", error);
    return failure("seo.errors.google");
  }
}

/** Qué fuentes de adquisición cuentan como SEO (en `orgs.settings`, como los demás umbrales). null = la sugerencia. */
export async function saveSeoSources(slug: string, sourceIds: string[] | null): Promise<ActionResult> {
  const ctx = await ownerContext(slug);
  if (!ctx) return failure("common.ownerOnly");
  const parsed = seoSourcesSchema.safeParse(sourceIds);
  if (!parsed.success) return invalidInput();

  // Se conservan las demás claves de `settings` (plazos, avisos…), que gestiona Ajustes.
  const current = ctx.org.settings && typeof ctx.org.settings === "object" && !Array.isArray(ctx.org.settings) ? ctx.org.settings : {};
  const settings: Record<string, Json | undefined> = { ...current };
  if (parsed.data === null) delete settings[SEO_SOURCES_SETTING];
  else settings[SEO_SOURCES_SETTING] = [...new Set(parsed.data)];

  const supabase = await createClient();
  const { data, error } = await supabase.from("orgs").update({ settings }).eq("id", ctx.org.id).select("id");
  if (error) return dbFailure(error, "seo.sources");
  if (data.length === 0) return forbidden();
  revalidatePath(`/${ctx.org.slug}/seo`);
  return { ok: true };
}
