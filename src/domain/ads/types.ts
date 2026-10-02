// Ads: plataformas, tipos de anuncio y cálculos puros sobre las campañas. Sin next, react ni supabase.

/** Plataformas con las que se conecta (cada una, una API y una credencial). */
export const ADS_PROVIDERS = ["openai", "google", "meta", "linkedin"] as const;
export type AdsProvider = (typeof ADS_PROVIDERS)[number];

/** Tipos de anuncio que se enseñan, en este orden. Google Ads y YouTube Ads comparten la conexión de Google. */
export const AD_TYPES = ["chatgpt", "google", "meta", "youtube", "linkedin"] as const;
export type AdType = (typeof AD_TYPES)[number];

export const AD_TYPE_PROVIDER: Record<AdType, AdsProvider> = {
  chatgpt: "openai",
  google: "google",
  meta: "meta",
  youtube: "google",
  linkedin: "linkedin",
};

/** Nombres de marca: no se traducen. */
export const AD_TYPE_LABEL: Record<AdType, string> = {
  chatgpt: "ChatGPT Ads",
  google: "Google Ads",
  meta: "Meta Ads",
  youtube: "YouTube Ads",
  linkedin: "LinkedIn Ads",
};

export const PROVIDER_LABEL: Record<AdsProvider, string> = {
  openai: "ChatGPT Ads (OpenAI)",
  google: "Google Ads (incluye YouTube Ads)",
  meta: "Meta Ads (Facebook e Instagram)",
  linkedin: "LinkedIn Ads",
};

/** Tipos de anuncio que sirve una conexión. */
export function adTypesForProvider(provider: AdsProvider): AdType[] {
  return AD_TYPES.filter((type) => AD_TYPE_PROVIDER[type] === provider);
}

/** Canal de una campaña de Google (de `campaign.advertising_channel_type`); el resto de plataformas lo dejan a null. */
export type CampaignChannel = "search" | "display" | "video" | "shopping" | "performance_max" | "demand_gen" | "other";

/** Una campaña tal y como la normaliza cada proveedor. Dinero en céntimos de la moneda de la cuenta. */
export type AdsCampaign = {
  id: string;
  name: string;
  channel: CampaignChannel | null;
  impressions: number;
  clicks: number;
  spend_cents: number;
};

/** Minutos que vale una foto de la API antes de pedir otra al abrir la página. */
export const ADS_REFRESH_MINUTES = 15;
/** Días que cubre cada foto. */
export const ADS_PERIOD_DAYS = 28;

/** Si una foto tomada en `fetchedAt` sigue valiendo en `now`. */
export function isAdsSnapshotFresh(fetchedAt: Date | string | null, now: Date, minutes = ADS_REFRESH_MINUTES): boolean {
  if (!fetchedAt) return false;
  const at = typeof fetchedAt === "string" ? new Date(fetchedAt) : fetchedAt;
  return now.getTime() - at.getTime() < minutes * 60_000;
}

/**
 * Qué campañas de una conexión pertenecen a un tipo de anuncio. En Google, las de vídeo son YouTube Ads
 * y el resto Google Ads; en las demás plataformas, todas.
 */
export function campaignsForAdType(type: AdType, campaigns: readonly AdsCampaign[]): AdsCampaign[] {
  if (AD_TYPE_PROVIDER[type] !== "google") return [...campaigns];
  return campaigns.filter((campaign) => (campaign.channel === "video") === (type === "youtube"));
}

export type AdsTotals = { impressions: number; clicks: number; spend_cents: number; ctr: number | null };

/** Totales de un conjunto de campañas. El CTR sale de los totales, no de la media de CTRs. */
export function adsTotals(campaigns: readonly AdsCampaign[]): AdsTotals {
  const impressions = campaigns.reduce((sum, c) => sum + c.impressions, 0);
  const clicks = campaigns.reduce((sum, c) => sum + c.clicks, 0);
  const spend_cents = campaigns.reduce((sum, c) => sum + c.spend_cents, 0);
  return { impressions, clicks, spend_cents, ctr: impressions > 0 ? clicks / impressions : null };
}

/** Un importe decimal de la API («12.34», 12.34) a céntimos enteros; lo que no es un número cuenta 0. */
export function moneyToCents(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** Micros de Google (1 € = 1 000 000) a céntimos. */
export function microsToCents(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.round(n / 10_000) : 0;
}

/** Un entero de la API (puede llegar como texto). */
export function countOf(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

/** Comprueba la forma de una campaña leída de la caché (jsonb). */
export function isAdsCampaign(value: unknown): value is AdsCampaign {
  if (!value || typeof value !== "object") return false;
  const c = value as Record<string, unknown>;
  return typeof c.id === "string" && typeof c.name === "string" && typeof c.impressions === "number" && typeof c.clicks === "number" && typeof c.spend_cents === "number";
}
