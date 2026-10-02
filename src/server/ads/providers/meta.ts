// Meta Ads (Facebook e Instagram) por la Marketing API. Credencial: token de acceso de usuario del
// sistema (larga duración) con permiso ads_read sobre la cuenta publicitaria `act_…`.

import { type AdsCampaign, countOf, moneyToCents } from "@/domain/ads/types";
import { type AccountInfo, type AdsProviderClient, AdsProviderError, type ProviderCredentials, providerJson } from "./types";

const BASE = "https://graph.facebook.com/v21.0";

/** `123456` o `act_123456` → `act_123456`. */
export function metaAccountId(raw: string): string {
  const digits = raw.trim().replace(/^act_/, "");
  if (!/^\d{1,30}$/.test(digits)) throw new AdsProviderError("invalid", undefined, "El ID de la cuenta de Meta tiene que ser act_ seguido de números.");
  return `act_${digits}`;
}

function headers(creds: ProviderCredentials): HeadersInit {
  return { Authorization: `Bearer ${creds.credential}`, Accept: "application/json" };
}

type Paged<T> = { data?: T[]; paging?: { next?: string } };

async function allPages<T>(url: string, creds: ProviderCredentials): Promise<T[]> {
  const items: T[] = [];
  let next: string | undefined = url;
  for (let page = 0; page < 20 && next; page++) {
    const body: Paged<T> = await providerJson<Paged<T>>(next, { headers: headers(creds) });
    items.push(...(body.data ?? []));
    next = body.paging?.next;
  }
  if (next) throw new AdsProviderError("pagination");
  return items;
}

export const metaAds: AdsProviderClient = {
  async account(creds) {
    const id = metaAccountId(creds.externalAccountId);
    const data = await providerJson<Record<string, unknown>>(`${BASE}/${id}?fields=name,currency,timezone_name`, { headers: headers(creds) });
    if (typeof data.name !== "string") throw new AdsProviderError("invalid", undefined, "Cuenta de Meta Ads no válida.");
    return {
      externalAccountId: id,
      name: data.name,
      currency: typeof data.currency === "string" ? data.currency : "EUR",
      timezone: typeof data.timezone_name === "string" ? data.timezone_name : "UTC",
      email: null,
    } satisfies AccountInfo;
  },

  async campaigns(creds, from, to) {
    const id = metaAccountId(creds.externalAccountId);
    // Todas las campañas (también las que no han servido impresiones) y, aparte, sus métricas del periodo.
    const listed = await allPages<{ id?: string; name?: string }>(`${BASE}/${id}/campaigns?fields=id,name&limit=500`, creds);
    const params = new URLSearchParams({
      level: "campaign",
      fields: "campaign_id,campaign_name,impressions,clicks,spend",
      time_range: JSON.stringify({ since: from, until: to }),
      limit: "500",
    });
    const insights = await allPages<Record<string, unknown>>(`${BASE}/${id}/insights?${params}`, creds);
    const byId = new Map<string, AdsCampaign>();
    for (const item of listed) {
      if (typeof item.id !== "string") continue;
      byId.set(item.id, { id: item.id, name: typeof item.name === "string" ? item.name : item.id, channel: null, impressions: 0, clicks: 0, spend_cents: 0 });
    }
    for (const row of insights) {
      if (typeof row.campaign_id !== "string") continue;
      const name = typeof row.campaign_name === "string" ? row.campaign_name : row.campaign_id;
      byId.set(row.campaign_id, {
        id: row.campaign_id,
        name,
        channel: null,
        impressions: countOf(row.impressions),
        clicks: countOf(row.clicks),
        spend_cents: moneyToCents(row.spend),
      });
    }
    return [...byId.values()];
  },
};
