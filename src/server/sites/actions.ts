"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import {
  bulkSitesSchema,
  type BulkSitesInput,
  siteFormSchema,
  type SiteFormInput,
  siteRow,
  siteThresholdsSchema,
  type SiteThresholdsInput,
} from "@/app/[org]/sites/schema";
import { suggestClientForSite } from "@/domain/seo/site-url";
import { type CheckError, parseSiteList } from "@/domain/sites";
import type { ActionResult } from "@/lib/action-result";
import type { Json } from "@/lib/supabase/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { dbFailure, failure, forbidden, idSchema, invalidInput, ownerContext, partnerContext } from "@/server/action-utils";
import { dispatchPendingPushes } from "@/server/push/dispatch";
import { checkSite } from "./check";
import { recordSiteChecks, runSiteChecks } from "./engine";
import { knownSiteError } from "./errors";
import { isSiteRow, OVERVIEW_COLUMNS } from "./rows";

/**
 * Acciones de Webs. Las webs se escriben con el cliente del usuario (la RLS es la barrera: un socio
 * las lleva). Las comprobaciones de «Comprobar ahora» también; los avisos que salgan de ellas, con
 * el admin (nadie los escribe a mano). Al dar de alta webs, la primera comprobación se hace nada más
 * responder, sin esperar al cron.
 */

const fail = (error: PostgrestError, where: string) => dbFailure(error, where, knownSiteError);

/** Vuelve a pintar Webs (listado y fichas) y lo que las enseña fuera. */
function revalidateSites(slug: string, clientIds: (string | null | undefined)[] = []) {
  revalidatePath(`/${slug}/sites`, "layout");
  for (const clientId of new Set(clientIds)) if (clientId) revalidatePath(`/${slug}/clients/${clientId}`);
}

/** Primeras comprobaciones de webs recién dadas de alta (o con otra URL), después de responder. */
function checkSoon(orgId: string, siteIds: string[]) {
  if (siteIds.length === 0) return;
  after(async () => {
    try {
      const admin = createAdminClient();
      const summary = await runSiteChecks(admin, { orgId, siteIds });
      if (summary.alerts > 0) await dispatchPendingPushes(admin, { orgId });
    } catch (error) {
      console.error("[sites] first checks", orgId, error);
    }
  });
}

/** Crea o edita una web. */
export async function saveSite(slug: string, siteId: string | null, input: SiteFormInput): Promise<ActionResult<{ id: string }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const parsed = siteFormSchema.safeParse(input);
  const id = siteId === null ? null : idSchema.safeParse(siteId);
  if (!parsed.success || (id && !id.success)) return invalidInput();
  const row = siteRow(parsed.data);
  const supabase = await createClient();

  if (id) {
    const { data: before, error: loadError } = await supabase.from("sites").select("url, client_id").eq("org_id", ctx.org.id).eq("id", id.data).maybeSingle();
    if (loadError) return fail(loadError, "saveSite.load");
    if (!before) return failure("sites.errors.notFound");
    const { data, error } = await supabase.from("sites").update(row).eq("org_id", ctx.org.id).eq("id", id.data).select("id").maybeSingle();
    if (error) return fail(error, "saveSite.update");
    if (!data) return forbidden();
    // Otra URL es otra web: las comprobaciones de la anterior ya no cuentan su historia.
    if (before.url !== row.url) {
      const { error: pruneError } = await createAdminClient().from("site_checks").delete().eq("org_id", ctx.org.id).eq("site_id", id.data);
      if (pruneError) console.error("[sites] url changed", pruneError);
      if (row.is_active) checkSoon(ctx.org.id, [id.data]);
    }
    revalidateSites(ctx.org.slug, [before.client_id, row.client_id]);
    return { ok: true, id: id.data };
  }

  const { data, error } = await supabase
    .from("sites")
    .insert({ ...row, org_id: ctx.org.id })
    .select("id")
    .single();
  if (error) return fail(error, "saveSite.insert");
  if (row.is_active) checkSoon(ctx.org.id, [data.id]);
  revalidateSites(ctx.org.slug, [row.client_id]);
  return { ok: true, id: data.id };
}

/**
 * Da de alta varias webs pegadas de golpe. Las que ya se vigilan se saltan. Cada una va con el
 * cliente elegido o, si se pide, con el que la tiene en su ficha.
 */
export async function addSitesInBulk(slug: string, input: BulkSitesInput): Promise<ActionResult<{ added: number; skipped: number }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const parsed = bulkSitesSchema.safeParse(input);
  if (!parsed.success) return invalidInput();
  const { urls } = parseSiteList(parsed.data.text);
  const supabase = await createClient();

  let clients: { id: string; website: string | null }[] = [];
  if (!parsed.data.client_id && parsed.data.match_clients) {
    const { data, error } = await supabase.from("clients").select("id, website").eq("org_id", ctx.org.id).is("archived_at", null).not("website", "is", null);
    if (error) return fail(error, "addSitesInBulk.clients");
    clients = data ?? [];
  }
  const rows = urls.map((url) => ({
    org_id: ctx.org.id,
    url,
    client_id: parsed.data.client_id || suggestClientForSite(url, clients),
    hosted_by_us: parsed.data.hosted_by_us,
  }));
  const { data, error } = await supabase.from("sites").upsert(rows, { onConflict: "org_id,url", ignoreDuplicates: true }).select("id, client_id");
  if (error) return fail(error, "addSitesInBulk");
  const added = data ?? [];
  checkSoon(
    ctx.org.id,
    added.map((s) => s.id),
  );
  revalidateSites(
    ctx.org.slug,
    added.map((s) => s.client_id),
  );
  return { ok: true, added: added.length, skipped: urls.length - added.length };
}

/** Pausa (deja de comprobarla y de avisar) o reanuda una web. */
export async function setSiteActive(slug: string, siteId: string, active: boolean): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(siteId);
  if (!id.success || typeof active !== "boolean") return invalidInput();
  const supabase = await createClient();
  const { data, error } = await supabase.from("sites").update({ is_active: active }).eq("org_id", ctx.org.id).eq("id", id.data).select("client_id").maybeSingle();
  if (error) return fail(error, "setSiteActive");
  if (!data) return failure("sites.errors.notFound");
  if (active) checkSoon(ctx.org.id, [id.data]);
  revalidateSites(ctx.org.slug, [data.client_id]);
  return { ok: true };
}

/** Quita una web de la vigilancia (con sus comprobaciones). */
export async function deleteSite(slug: string, siteId: string): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(siteId);
  if (!id.success) return invalidInput();
  const supabase = await createClient();
  const { data, error } = await supabase.from("sites").delete().eq("org_id", ctx.org.id).eq("id", id.data).select("client_id").maybeSingle();
  if (error) return fail(error, "deleteSite");
  if (!data) return failure("sites.errors.notFound");
  revalidateSites(ctx.org.slug, [data.client_id]);
  return { ok: true };
}

export type CheckNowResult = { ok: boolean; statusCode: number | null; responseMs: number | null; error: CheckError | null };

/** «Comprobar ahora»: comprueba una web al momento, lo guarda y avisa si algo ha cambiado. */
export async function checkSiteNow(slug: string, siteId: string): Promise<ActionResult<{ check: CheckNowResult }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(siteId);
  if (!id.success) return invalidInput();
  const supabase = await createClient();
  const { data: row, error } = await supabase.from("sites_overview").select(OVERVIEW_COLUMNS).eq("org_id", ctx.org.id).eq("id", id.data).maybeSingle();
  if (error) return fail(error, "checkSiteNow.load");
  if (!row || !isSiteRow(row)) return failure("sites.errors.notFound");

  const check = await checkSite(row.url);
  try {
    const admin = createAdminClient();
    const { alerts } = await recordSiteChecks({ writer: supabase, admin, org: ctx.org, entries: [{ row, check }] });
    if (alerts > 0) after(() => dispatchPendingPushes(admin, { orgId: ctx.org.id }).then(() => undefined, (e: unknown) => console.error("[sites] push", e)));
  } catch (recordError) {
    console.error("[sites] checkSiteNow", recordError);
    return failure("common.errorGeneric");
  }
  revalidateSites(ctx.org.slug, [row.client_id]);
  return { ok: true, check: { ok: check.ok, statusCode: check.statusCode, responseMs: check.responseMs, error: check.error } };
}

/** Umbrales de Webs de la org (orgs.settings.sites). Solo un owner; se conservan las demás claves de `settings`. */
export async function saveSiteThresholds(slug: string, input: SiteThresholdsInput): Promise<ActionResult> {
  const ctx = await ownerContext(slug);
  if (!ctx) return forbidden();
  const parsed = siteThresholdsSchema.safeParse(input);
  if (!parsed.success) return invalidInput();
  const current = typeof ctx.org.settings === "object" && ctx.org.settings !== null && !Array.isArray(ctx.org.settings) ? ctx.org.settings : {};
  const settings: Json = { ...current, sites: parsed.data };
  const supabase = await createClient();
  const { data, error } = await supabase.from("orgs").update({ settings }).eq("id", ctx.org.id).select("id");
  if (error) return fail(error, "saveSiteThresholds");
  if (data.length === 0) return forbidden();
  revalidateSites(ctx.org.slug);
  return { ok: true };
}
