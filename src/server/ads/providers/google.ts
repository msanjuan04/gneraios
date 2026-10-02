// Google Ads (y YouTube Ads, que son campañas de vídeo de la misma cuenta) por la API de Google Ads.
// Credencial: token de refresco de OAuth (scope adwords) + developer token; opcionalmente la cuenta
// administradora (MCC) con la que se accede.

import { type AdsCampaign, type CampaignChannel, countOf, microsToCents } from "@/domain/ads/types";
import { googleSetup } from "@/server/seo/config";
import { GoogleAuthError, refreshAccessToken } from "@/server/seo/google-oauth";
import { type AccountInfo, type AdsProviderClient, AdsProviderError, type ProviderCredentials, providerJson } from "./types";

export const GOOGLE_ADS_SCOPE = "https://www.googleapis.com/auth/adwords";
const BASE = "https://googleads.googleapis.com/v18";

/** `123-456-7890` → `1234567890`. */
export function googleCustomerId(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 10) throw new AdsProviderError("invalid", undefined, "El ID de cliente de Google Ads tiene 10 cifras.");
  return digits;
}

const CHANNELS: Record<string, CampaignChannel> = {
  SEARCH: "search",
  DISPLAY: "display",
  VIDEO: "video",
  SHOPPING: "shopping",
  PERFORMANCE_MAX: "performance_max",
  DEMAND_GEN: "demand_gen",
};

async function accessToken(creds: ProviderCredentials): Promise<string> {
  if (!creds.credential) throw new AdsProviderError("not_connected");
  const config = googleSetup().config;
  if (!config) throw new AdsProviderError("invalid", undefined, "Google no está configurado en el servidor (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).");
  try {
    return (await refreshAccessToken(fetch, { refreshToken: creds.credential, config })).accessToken;
  } catch (error) {
    if (error instanceof GoogleAuthError && error.code === "invalid_grant") throw new AdsProviderError("unauthorized", undefined, "Google ha revocado el acceso: vuelve a conectar la cuenta.");
    throw error;
  }
}

type SearchRow = { campaign?: Record<string, unknown>; metrics?: Record<string, unknown>; customer?: Record<string, unknown> };

async function search(creds: ProviderCredentials, query: string): Promise<SearchRow[]> {
  if (!creds.developerToken) throw new AdsProviderError("invalid", undefined, "Falta el developer token de Google Ads.");
  const token = await accessToken(creds);
  const customer = googleCustomerId(creds.externalAccountId);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "developer-token": creds.developerToken,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (creds.loginCustomerId) headers["login-customer-id"] = googleCustomerId(creds.loginCustomerId);
  const chunks = await providerJson<{ results?: SearchRow[] }[]>(`${BASE}/customers/${customer}/googleAds:searchStream`, {
    method: "POST",
    headers,
    body: JSON.stringify({ query }),
    timeoutMs: 30_000,
  });
  return (Array.isArray(chunks) ? chunks : []).flatMap((chunk) => chunk.results ?? []);
}

export const googleAds: AdsProviderClient = {
  async account(creds) {
    const rows = await search(creds, "SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone FROM customer LIMIT 1");
    const customer = rows[0]?.customer;
    if (!customer || typeof customer.id !== "string") throw new AdsProviderError("invalid", undefined, "Google Ads no devolvió la cuenta.");
    return {
      externalAccountId: googleCustomerId(creds.externalAccountId),
      name: typeof customer.descriptiveName === "string" ? customer.descriptiveName : customer.id,
      currency: typeof customer.currencyCode === "string" ? customer.currencyCode : "EUR",
      timezone: typeof customer.timeZone === "string" ? customer.timeZone : "UTC",
      email: null,
    } satisfies AccountInfo;
  },

  async campaigns(creds, from, to) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new AdsProviderError("invalid");
    const rows = await search(
      creds,
      `SELECT campaign.id, campaign.name, campaign.advertising_channel_type, metrics.impressions, metrics.clicks, metrics.cost_micros FROM campaign WHERE segments.date BETWEEN '${from}' AND '${to}' AND campaign.status != 'REMOVED'`,
    );
    const campaigns: AdsCampaign[] = [];
    for (const row of rows) {
      const campaign = row.campaign;
      if (!campaign || campaign.id == null) continue;
      const channel = typeof campaign.advertisingChannelType === "string" ? (CHANNELS[campaign.advertisingChannelType] ?? "other") : null;
      campaigns.push({
        id: String(campaign.id),
        name: typeof campaign.name === "string" ? campaign.name : String(campaign.id),
        channel,
        impressions: countOf(row.metrics?.impressions),
        clicks: countOf(row.metrics?.clicks),
        spend_cents: microsToCents(row.metrics?.costMicros),
      });
    }
    return campaigns;
  },
};
