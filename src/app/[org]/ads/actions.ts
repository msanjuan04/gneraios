"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult } from "@/lib/action-result";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ACCOUNT_COLUMNS, type AdsAccountRow, credentialContext, loadAdsSnapshot, verifyAccount } from "@/server/ads/accounts";
import { googleCustomerId } from "@/server/ads/providers/google";
import { AdsProviderError, describeProviderError } from "@/server/ads/providers/types";
import { failure, forbidden, idSchema, invalidInput, partnerContext } from "@/server/action-utils";
import { secretStoreFromEnv } from "@/server/seo/secret-store";
import { type AddAdsAccountInput, addAdsAccountSchema, campaignLinkSchema } from "./schema";

const adsPath = (slug: string) => `/${slug}/ads`;

/** Da de alta una cuenta publicitaria: comprueba la credencial con la plataforma y la guarda cifrada. */
export async function addAdsAccount(slug: string, input: AddAdsAccountInput): Promise<ActionResult<{ id: string; owner: string; needsGoogle: boolean }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const parsed = addAdsAccountSchema.safeParse(input);
  if (!parsed.success) return invalidInput();
  const v = parsed.data;
  const db = await createClient();
  if (v.owner_client_id) {
    const { data: client } = await db.from("clients").select("id").eq("org_id", ctx.org.id).eq("id", v.owner_client_id).is("archived_at", null).maybeSingle();
    if (!client) return invalidInput();
  }

  const id = randomUUID();
  const store = secretStoreFromEnv();
  const context = credentialContext(ctx.org.id, id);
  let row: {
    external_account_id: string;
    login_customer_id?: string | null;
    developer_token_ciphertext?: string | null;
    credential_ciphertext: string | null;
    platform_name?: string | null;
    currency?: string | null;
    timezone?: string | null;
    account_email?: string | null;
  };
  try {
    if (v.provider === "google") {
      row = {
        external_account_id: googleCustomerId(v.external_account_id),
        login_customer_id: v.login_customer_id ? googleCustomerId(v.login_customer_id) : null,
        developer_token_ciphertext: await store.seal(v.developer_token, context),
        credential_ciphertext: null,
      };
    } else {
      const info = await verifyAccount(v.provider, { credential: v.credential, externalAccountId: v.external_account_id });
      row = {
        external_account_id: info.externalAccountId,
        platform_name: info.name,
        currency: info.currency,
        timezone: info.timezone,
        account_email: info.email,
        credential_ciphertext: await store.seal(v.credential, context),
      };
    }
  } catch (error) {
    if (error instanceof AdsProviderError || (error instanceof Error && error.name === "TimeoutError")) {
      return failure("ads.errors.verify", { message: describeProviderError(error) });
    }
    console.error("[ads] verify account", error);
    return failure("common.errorGeneric");
  }

  const { error } = await createAdminClient().from("ads_accounts").insert({
    id,
    org_id: ctx.org.id,
    provider: v.provider,
    label: v.label,
    owner_client_id: v.owner_client_id || null,
    created_by: ctx.user.id,
    ...row,
  });
  if (error) {
    if (error.code === "23505") return failure("ads.errors.duplicate");
    console.error("[ads] insert account", error);
    return failure("common.errorGeneric");
  }
  revalidatePath(adsPath(ctx.org.slug));
  return { ok: true, id, owner: v.owner_client_id || "agency", needsGoogle: v.provider === "google" };
}

async function ownAccount(orgId: string, accountId: unknown): Promise<AdsAccountRow | null> {
  if (!idSchema.safeParse(accountId).success) return null;
  const db = await createClient();
  const { data } = await db.from("ads_accounts").select(ACCOUNT_COLUMNS).eq("org_id", orgId).eq("id", accountId as string).is("archived_at", null).maybeSingle();
  return (data as AdsAccountRow | null) ?? null;
}

/** Pide las cifras a la plataforma ahora mismo (sin esperar a los 15 minutos). */
export async function refreshAdsAccount(slug: string, accountId: string): Promise<ActionResult<{ error: string | null }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const account = await ownAccount(ctx.org.id, accountId);
  if (!account) return failure("ads.errors.notFound");
  const snapshot = await loadAdsSnapshot(account, { force: true, timezone: ctx.org.timezone });
  revalidatePath(adsPath(ctx.org.slug));
  return { ok: true, error: snapshot.error };
}

/** Deja de leer la cuenta: borra la credencial y la caché, y desvincula sus campañas. */
export async function archiveAdsAccount(slug: string, accountId: string): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const account = await ownAccount(ctx.org.id, accountId);
  if (!account) return failure("ads.errors.notFound");
  const admin = createAdminClient();
  const [links, cache, archived] = await Promise.all([
    admin.from("ads_client_campaigns").delete().eq("org_id", ctx.org.id).eq("ad_account_id", account.id),
    admin.from("ads_insights").delete().eq("org_id", ctx.org.id).eq("account_id", account.id),
    admin.from("ads_accounts").update({ archived_at: new Date().toISOString(), credential_ciphertext: null, developer_token_ciphertext: null }).eq("org_id", ctx.org.id).eq("id", account.id),
  ]);
  const error = links.error ?? cache.error ?? archived.error;
  if (error) {
    console.error("[ads] archive account", error);
    return failure("common.errorGeneric");
  }
  revalidatePath(adsPath(ctx.org.slug));
  return { ok: true };
}

/** Vincula una campaña a un cliente de la misma org; publicarla en su portal exige marcarlo expresamente. */
export async function saveAdsCampaignClient(slug: string, form: FormData): Promise<void> {
  const ctx = await partnerContext(slug);
  if (!ctx) return;
  const page = adsPath(ctx.org.slug);
  const owner = typeof form.get("owner") === "string" ? `?owner=${encodeURIComponent(String(form.get("owner")))}&` : "?";
  const parsed = campaignLinkSchema.safeParse({
    account_id: form.get("account_id"),
    campaign_id: form.get("campaign_id"),
    client_id: form.get("client_id") ?? "",
    visible: form.get("visible") === "on",
  });
  if (!parsed.success) redirect(`${page}${owner}ads_error=input`);
  const v = parsed.data;
  const account = await ownAccount(ctx.org.id, v.account_id);
  if (!account) redirect(`${page}${owner}ads_error=access`);
  const db = await createClient();
  if (!v.client_id) {
    const { error } = await db.from("ads_client_campaigns").delete().eq("org_id", ctx.org.id).eq("ad_account_id", account.id).eq("campaign_id", v.campaign_id);
    if (error) redirect(`${page}${owner}ads_error=save`);
  } else {
    const { data: client } = await db.from("clients").select("id").eq("org_id", ctx.org.id).eq("id", v.client_id).is("archived_at", null).maybeSingle();
    if (!client) redirect(`${page}${owner}ads_error=input`);
    const { error } = await db.from("ads_client_campaigns").upsert(
      { org_id: ctx.org.id, client_id: client.id, ad_account_id: account.id, campaign_id: v.campaign_id, visible_to_client: v.visible },
      { onConflict: "org_id,ad_account_id,campaign_id" },
    );
    if (error) redirect(`${page}${owner}ads_error=save`);
  }
  revalidatePath(page);
  redirect(`${page}${owner}ads=saved`);
}

/** La clave OPENAI_ADS_API_KEY del entorno pasa a ser una cuenta de ChatGPT Ads de la agencia. */
export async function importEnvOpenAiAccount(slug: string): Promise<void> {
  const ctx = await partnerContext(slug);
  if (!ctx) return;
  const page = adsPath(ctx.org.slug);
  const key = process.env.OPENAI_ADS_API_KEY?.trim();
  if (!key) redirect(`${page}?ads_error=input`);
  const result = await addAdsAccount(ctx.org.slug, { provider: "openai", label: "ChatGPT Ads", owner_client_id: "", external_account_id: "", credential: key });
  if (!result.ok) redirect(`${page}?ads_error=api`);
  redirect(`${page}?owner=agency&ads=imported`);
}
