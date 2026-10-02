// LinkedIn Ads por la Marketing API versionada. Credencial: token de acceso OAuth (r_ads_reporting,
// r_ads) de la cuenta publicitaria. LinkedIn no expone zona horaria de cuenta: se usa UTC.

import { type AdsCampaign, countOf, moneyToCents } from "@/domain/ads/types";
import { type AccountInfo, type AdsProviderClient, AdsProviderError, type ProviderCredentials, providerJson } from "./types";

const BASE = "https://api.linkedin.com/rest";
const VERSION = "202409";

/** `urn:li:sponsoredAccount:123` o `123` → `123`. */
export function linkedinAccountId(raw: string): string {
  const digits = raw.trim().replace(/^urn:li:sponsoredAccount:/, "");
  if (!/^\d{1,20}$/.test(digits)) throw new AdsProviderError("invalid", undefined, "El ID de la cuenta de LinkedIn Ads tiene que ser numérico.");
  return digits;
}

function headers(creds: ProviderCredentials): HeadersInit {
  return {
    Authorization: `Bearer ${creds.credential}`,
    "LinkedIn-Version": VERSION,
    "X-Restli-Protocol-Version": "2.0.0",
    Accept: "application/json",
  };
}

function dateParts(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return `(year:${year},month:${month},day:${day})`;
}

export const linkedinAds: AdsProviderClient = {
  async account(creds) {
    const id = linkedinAccountId(creds.externalAccountId);
    const data = await providerJson<Record<string, unknown>>(`${BASE}/adAccounts/${id}`, { headers: headers(creds) });
    if (typeof data.name !== "string") throw new AdsProviderError("invalid", undefined, "Cuenta de LinkedIn Ads no válida.");
    return {
      externalAccountId: id,
      name: data.name,
      currency: typeof data.currency === "string" ? data.currency : "EUR",
      timezone: "UTC",
      email: null,
    } satisfies AccountInfo;
  },

  async campaigns(creds, from, to) {
    const id = linkedinAccountId(creds.externalAccountId);
    const listed = await providerJson<{ elements?: { id?: number | string; name?: string }[] }>(
      `${BASE}/adAccounts/${id}/adCampaigns?q=search&pageSize=500`,
      { headers: headers(creds) },
    );
    const byId = new Map<string, AdsCampaign>();
    for (const item of listed.elements ?? []) {
      if (item.id == null) continue;
      const key = String(item.id);
      byId.set(key, { id: key, name: typeof item.name === "string" ? item.name : key, channel: null, impressions: 0, clicks: 0, spend_cents: 0 });
    }
    const params = [
      "q=analytics",
      "pivot=CAMPAIGN",
      "timeGranularity=ALL",
      `dateRange=(start:${dateParts(from)},end:${dateParts(to)})`,
      `accounts=List(urn%3Ali%3AsponsoredAccount%3A${id})`,
      "fields=impressions,clicks,costInLocalCurrency,pivotValues",
    ].join("&");
    const analytics = await providerJson<{ elements?: Record<string, unknown>[] }>(`${BASE}/adAnalytics?${params}`, { headers: headers(creds) });
    for (const row of analytics.elements ?? []) {
      const pivot = Array.isArray(row.pivotValues) ? row.pivotValues.find((v): v is string => typeof v === "string") : undefined;
      const key = pivot?.replace(/^urn:li:sponsoredCampaign:/, "");
      if (!key) continue;
      const base = byId.get(key) ?? { id: key, name: key, channel: null, impressions: 0, clicks: 0, spend_cents: 0 };
      byId.set(key, { ...base, impressions: countOf(row.impressions), clicks: countOf(row.clicks), spend_cents: moneyToCents(row.costInLocalCurrency) });
    }
    return [...byId.values()];
  },
};
