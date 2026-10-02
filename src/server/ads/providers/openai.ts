// ChatGPT Ads (API de OpenAI Ads). La clave pertenece a una sola cuenta publicitaria.

import { type AdsCampaign, countOf, moneyToCents } from "@/domain/ads/types";
import { type AccountInfo, type AdsProviderClient, AdsProviderError, type ProviderCredentials, providerJson } from "./types";

const BASE = "https://api.ads.openai.com/v1";

function headers(creds: ProviderCredentials): HeadersInit {
  return { Authorization: `Bearer ${creds.credential}`, Accept: "application/json" };
}

export const openAiAds: AdsProviderClient = {
  async account(creds) {
    const data = await providerJson<Record<string, unknown>>(`${BASE}/ad_account`, { headers: headers(creds) });
    if (typeof data.id !== "string" || typeof data.name !== "string") throw new AdsProviderError("invalid", undefined, "Cuenta de ChatGPT Ads no válida.");
    return {
      externalAccountId: data.id,
      name: data.name,
      currency: typeof data.currency_code === "string" ? data.currency_code : "EUR",
      timezone: typeof data.timezone === "string" ? data.timezone : "UTC",
      email: null,
    } satisfies AccountInfo;
  },

  async campaigns(creds, from, to) {
    const account = await this.account(creds);
    const params = new URLSearchParams({ aggregation_level: "campaign", time_granularity: "none", limit: "2000" });
    params.append("time_ranges[]", JSON.stringify({ type: "date_range", since: from, until: to, timezone: account.timezone }));
    params.append("includes[]", "zero_impression_items");
    for (const field of ["campaign.id", "campaign.name", "campaign.impressions", "campaign.clicks", "campaign.spend"]) params.append("fields[]", field);

    const campaigns: AdsCampaign[] = [];
    let after: string | null = null;
    for (let page = 0; page < 10; page++) {
      const query = new URLSearchParams(params);
      if (after) query.set("after", after);
      const response = await providerJson<{ data?: Record<string, unknown>[]; has_more?: boolean; last_id?: string | null }>(
        `${BASE}/ad_account/insights?${query}`,
        { headers: headers(creds) },
      );
      for (const item of response.data ?? []) {
        if (typeof item.campaign_id !== "string") continue;
        campaigns.push({
          id: item.campaign_id,
          name: typeof item.campaign_name === "string" ? item.campaign_name : item.campaign_id,
          channel: null,
          impressions: countOf(item.impressions),
          clicks: countOf(item.clicks),
          spend_cents: moneyToCents(item.spend),
        });
      }
      if (!response.has_more) return campaigns;
      if (!response.last_id || response.last_id === after) break;
      after = response.last_id;
    }
    throw new AdsProviderError("pagination", undefined, "El informe supera el límite de paginación; no se enseñan cifras incompletas.");
  },
};
