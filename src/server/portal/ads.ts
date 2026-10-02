import "server-only";
import type { PortalAdsData } from "@/components/portal/types";
import { ACCOUNT_COLUMNS, type AdsAccountRow, loadAdsSnapshot } from "@/server/ads/accounts";
import type { Db } from "@/server/billing/context";

/**
 * Solo campañas vinculadas y publicadas para este cliente, de las cuentas conectadas. Nunca expone
 * credenciales ni la cuenta completa. Usa la caché de 15 minutos: el portal no dispara peticiones
 * a las plataformas por cada visita.
 */
export async function loadPortalAdsData(admin: Db, orgId: string, clientId: string): Promise<PortalAdsData | null> {
  const { data: links, error } = await admin
    .from("ads_client_campaigns")
    .select("ad_account_id, campaign_id")
    .eq("org_id", orgId)
    .eq("client_id", clientId)
    .eq("visible_to_client", true);
  if (error) throw error;
  if (!links?.length) return null;

  const accountIds = [...new Set(links.map((link) => link.ad_account_id))];
  const [{ data: accounts, error: accountsError }, { data: org, error: orgError }] = await Promise.all([
    admin.from("ads_accounts").select(ACCOUNT_COLUMNS).eq("org_id", orgId).in("id", accountIds).is("archived_at", null),
    admin.from("orgs").select("timezone").eq("id", orgId).maybeSingle(),
  ]);
  if (accountsError) throw accountsError;
  if (orgError) throw orgError;
  const timezone = org?.timezone ?? "Europe/Madrid";

  let period: { from: string; to: string } | null = null;
  let currency: string | null = null;
  const campaigns: PortalAdsData["campaigns"] = [];
  for (const row of (accounts ?? []) as AdsAccountRow[]) {
    const snapshot = await loadAdsSnapshot(row, { timezone });
    if (!snapshot.fetchedAt) continue;
    const accountCurrency = row.currency ?? "EUR";
    // Una moneda por portal: si un cliente tiene cuentas en monedas distintas, se enseña la primera.
    if (currency && currency !== accountCurrency) continue;
    currency ??= accountCurrency;
    period ??= { from: snapshot.from, to: snapshot.to };
    const wanted = new Set(links.filter((link) => link.ad_account_id === row.id).map((link) => link.campaign_id));
    for (const campaign of snapshot.campaigns) {
      if (!wanted.has(campaign.id)) continue;
      campaigns.push({
        id: campaign.id,
        name: campaign.name,
        impressions: campaign.impressions,
        clicks: campaign.clicks,
        spend: campaign.spend_cents / 100,
        ctr: campaign.impressions > 0 ? campaign.clicks / campaign.impressions : null,
      });
    }
  }
  if (!campaigns.length || !period || !currency) return null;
  return { from: period.from, to: period.to, currency, campaigns };
}
