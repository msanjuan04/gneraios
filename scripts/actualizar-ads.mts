// Refresca la caché de cifras (28 días) de todas las cuentas publicitarias conectadas, igual que el
// botón «Actualizar» de /ads pero para todas y desde la terminal (vale para un cron).
//
//   tsx --env-file=deploy/.env.production scripts/actualizar-ads.mts

import { createClient } from "@supabase/supabase-js";
import { ADS_PERIOD_DAYS, type AdsProvider, adsTotals } from "../src/domain/ads/types";
import { googleAds } from "../src/server/ads/providers/google";
import { linkedinAds } from "../src/server/ads/providers/linkedin";
import { metaAds } from "../src/server/ads/providers/meta";
import { openAiAds } from "../src/server/ads/providers/openai";
import { describeProviderError } from "../src/server/ads/providers/types";
import { secretStoreFromEnv } from "../src/server/seo/secret-store";

const providers = { openai: openAiAds, google: googleAds, meta: metaAds, linkedin: linkedinAds } as const;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !secret) throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SECRET_KEY.");
const admin = createClient(url, secret, { auth: { persistSession: false } });
const store = secretStoreFromEnv();

const { data: accounts, error } = await admin
  .from("ads_accounts")
  .select("id, org_id, provider, label, external_account_id, login_customer_id, timezone, credential_ciphertext, developer_token_ciphertext")
  .is("archived_at", null)
  .not("credential_ciphertext", "is", null);
if (error) throw error;

const civil = (timezone: string, date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);

for (const account of accounts ?? []) {
  const context = `ads/${account.org_id}/${account.id}`;
  const now = new Date();
  const to = civil(account.timezone ?? "Europe/Madrid", now);
  const fromDate = new Date(`${to}T12:00:00Z`);
  fromDate.setUTCDate(fromDate.getUTCDate() - (ADS_PERIOD_DAYS - 1));
  const from = fromDate.toISOString().slice(0, 10);
  try {
    const creds = {
      credential: await store.open(account.credential_ciphertext as string, context),
      developerToken: account.developer_token_ciphertext ? await store.open(account.developer_token_ciphertext, context) : null,
      loginCustomerId: account.login_customer_id,
      externalAccountId: account.external_account_id,
    };
    const campaigns = await providers[account.provider as AdsProvider].campaigns(creds, from, to);
    const fetchedAt = now.toISOString();
    const saved = await admin.from("ads_insights").upsert({ org_id: account.org_id, account_id: account.id, period_from: from, period_to: to, fetched_at: fetchedAt, campaigns }, { onConflict: "org_id,account_id" });
    if (saved.error) throw saved.error;
    await admin.from("ads_accounts").update({ last_synced_at: fetchedAt, last_error: null }).eq("id", account.id);
    const t = adsTotals(campaigns);
    console.log(`✓ ${account.label} (${account.provider}) ${from}→${to}: ${campaigns.length} campañas · ${t.impressions} impresiones · ${t.clicks} clics · ${(t.spend_cents / 100).toFixed(2)}`);
  } catch (err) {
    const message = describeProviderError(err);
    await admin.from("ads_accounts").update({ last_error: message }).eq("id", account.id);
    console.error(`✗ ${account.label} (${account.provider}): ${message}`);
  }
}
