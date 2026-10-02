import "server-only";
import type { PortalAdsData } from "@/components/portal/types";
import { getOpenAiAdsReport, isOpenAiAdsConfigured } from "@/server/ads/openai";
import type { Db } from "@/server/billing/context";

/** Solo campañas vinculadas y publicadas para este cliente. Nunca expone clave ni cuenta completa. */
export async function loadPortalAdsData(admin: Db, orgId: string, clientId: string): Promise<PortalAdsData | null> {
  const { data: links, error } = await admin
    .from("ads_client_campaigns")
    .select("ad_account_id, campaign_id")
    .eq("org_id", orgId)
    .eq("client_id", clientId)
    .eq("visible_to_client", true);
  if (error) throw error;
  if (!links?.length || !isOpenAiAdsConfigured()) return null;

  try {
    const report = await getOpenAiAdsReport();
    const campaignIds = new Set(links.filter((link) => link.ad_account_id === report.account.id).map((link) => link.campaign_id));
    const campaigns = report.campaigns.filter((campaign) => campaignIds.has(campaign.id));
    if (!campaigns.length) return null;
    return { from: report.from, to: report.to, currency: report.account.currency, campaigns };
  } catch {
    return null;
  }
}
