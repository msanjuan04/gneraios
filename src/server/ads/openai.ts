import "server-only";

const BASE = "https://api.ads.openai.com/v1";

export type AdsAccount = {
  id: string;
  name: string;
  currency: string;
  timezone: string;
};

export type CampaignInsight = {
  id: string;
  name: string;
  impressions: number;
  clicks: number;
  spend: number;
  ctr: number | null;
};

export type AdsReport = {
  account: AdsAccount;
  from: string;
  to: string;
  campaigns: CampaignInsight[];
};

function key(): string | null {
  return process.env.OPENAI_ADS_API_KEY?.trim() || null;
}

export function isOpenAiAdsConfigured(): boolean {
  return Boolean(key());
}

async function get<T>(path: string): Promise<T> {
  const secret = key();
  if (!secret) throw new Error("OpenAI Ads no está configurado.");
  const response = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${secret}`, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`OpenAI Ads devolvió HTTP ${response.status}.`);
  return (await response.json()) as T;
}

function number(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : 0;
}

function dateInZone(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function firstDay(to: string, days: number): string {
  const date = new Date(`${to}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days + 1);
  return date.toISOString().slice(0, 10);
}

function readAccount(data: Record<string, unknown>): AdsAccount {
  if (typeof data.id !== "string" || typeof data.name !== "string") throw new Error("Cuenta de Ads no válida.");
  return {
    id: data.id,
    name: data.name,
    currency: typeof data.currency_code === "string" ? data.currency_code : "EUR",
    timezone: typeof data.timezone === "string" ? data.timezone : "UTC",
  };
}

function readCampaign(data: Record<string, unknown>): CampaignInsight | null {
  if (typeof data.campaign_id !== "string") return null;
  const impressions = number(data.impressions);
  const clicks = number(data.clicks);
  return {
    id: data.campaign_id,
    name: typeof data.campaign_name === "string" ? data.campaign_name : data.campaign_id,
    impressions,
    clicks,
    spend: number(data.spend),
    ctr: data.ctr == null ? (impressions > 0 ? clicks / impressions : null) : number(data.ctr),
  };
}

/** Solo lectura. Cada clave pertenece a una cuenta publicitaria; nunca se entrega al navegador. */
export async function getOpenAiAdsReport(days = 28): Promise<AdsReport> {
  const account = readAccount(await get<Record<string, unknown>>("/ad_account"));
  const to = dateInZone(new Date(), account.timezone);
  const from = firstDay(to, days);
  const params = new URLSearchParams({ aggregation_level: "campaign", time_granularity: "none", limit: "2000" });
  params.append("time_ranges[]", JSON.stringify({ type: "date_range", since: from, until: to, timezone: account.timezone }));
  params.append("includes[]", "zero_impression_items");
  for (const field of ["campaign.id", "campaign.name", "campaign.impressions", "campaign.clicks", "campaign.spend", "campaign.ctr"]) {
    params.append("fields[]", field);
  }

  const campaigns: CampaignInsight[] = [];
  let after: string | null = null;
  for (let page = 0; page < 10; page++) {
    const query = new URLSearchParams(params);
    if (after) query.set("after", after);
    const response: { data?: Record<string, unknown>[]; has_more?: boolean; last_id?: string | null } =
      await get(`/ad_account/insights?${query}`);
    for (const item of response.data ?? []) {
      const campaign = readCampaign(item);
      if (campaign) campaigns.push(campaign);
    }
    if (!response.has_more) return { account, from, to, campaigns };
    if (!response.last_id || response.last_id === after) break;
    after = response.last_id;
  }
  throw new Error("El informe de Ads supera el límite de paginación; no se muestran cifras incompletas.");
}
