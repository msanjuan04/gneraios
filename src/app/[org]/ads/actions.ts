"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOpenAiAdsReport } from "@/server/ads/openai";
import { idSchema, partnerContext } from "@/server/action-utils";

/** Vincula una campaña real a un cliente de la misma org; publicar requiere marcarlo expresamente. */
export async function saveAdsCampaignClient(slug: string, form: FormData): Promise<void> {
  const ctx = await partnerContext(slug);
  if (!ctx) return;
  const page = `/${ctx.org.slug}/ads`;
  const campaignId = form.get("campaign_id");
  const clientId = form.get("client_id");
  if (typeof campaignId !== "string" || campaignId.length > 120 || typeof clientId !== "string") redirect(`${page}?ads_error=input`);
  if (clientId && !idSchema.safeParse(clientId).success) redirect(`${page}?ads_error=input`);
  if (process.env.OPENAI_ADS_ORG_SLUG ? process.env.OPENAI_ADS_ORG_SLUG !== ctx.org.slug : ctx.orgs.length !== 1) {
    redirect(`${page}?ads_error=access`);
  }

  let report;
  try { report = await getOpenAiAdsReport(); } catch { redirect(`${page}?ads_error=api`); }
  if (!report.campaigns.some((campaign) => campaign.id === campaignId)) redirect(`${page}?ads_error=input`);
  const db = await createClient();
  if (!clientId) {
    const { error } = await db.from("ads_client_campaigns").delete()
      .eq("org_id", ctx.org.id).eq("ad_account_id", report.account.id).eq("campaign_id", campaignId);
    if (error) redirect(`${page}?ads_error=save`);
  } else {
    const { data: client, error: clientError } = await db.from("clients").select("id")
      .eq("org_id", ctx.org.id).eq("id", clientId).is("archived_at", null).maybeSingle();
    if (clientError || !client) redirect(`${page}?ads_error=input`);
    const { error } = await db.from("ads_client_campaigns").upsert({
      org_id: ctx.org.id,
      client_id: client.id,
      ad_account_id: report.account.id,
      campaign_id: campaignId,
      visible_to_client: form.get("visible") === "on",
    }, { onConflict: "org_id,ad_account_id,campaign_id" });
    if (error) redirect(`${page}?ads_error=save`);
  }
  revalidatePath(page);
  redirect(`${page}?ads_saved=1`);
}
