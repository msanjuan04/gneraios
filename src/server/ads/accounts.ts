import "server-only";

import { ADS_PERIOD_DAYS, type AdsCampaign, type AdsProvider, isAdsCampaign, isAdsSnapshotFresh } from "@/domain/ads/types";
import { addDays } from "@/domain/dates/civil-date";
import { nowInZone } from "@/lib/clock";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { secretStoreFromEnv } from "@/server/seo/secret-store";
import { googleAds } from "./providers/google";
import { linkedinAds } from "./providers/linkedin";
import { metaAds } from "./providers/meta";
import { openAiAds } from "./providers/openai";
import { type AccountInfo, type AdsProviderClient, AdsProviderError, describeProviderError, type ProviderCredentials } from "./providers/types";

export const PROVIDERS: Record<AdsProvider, AdsProviderClient> = { openai: openAiAds, google: googleAds, meta: metaAds, linkedin: linkedinAds };

/** Columnas de una cuenta que puede leer cualquier miembro (nunca la credencial). */
export const ACCOUNT_COLUMNS = "id, org_id, provider, label, owner_client_id, external_account_id, login_customer_id, platform_name, currency, timezone, account_email, last_synced_at, last_error, created_at, archived_at";

export type AdsAccountRow = {
  id: string;
  org_id: string;
  provider: AdsProvider;
  label: string;
  owner_client_id: string | null;
  external_account_id: string;
  login_customer_id: string | null;
  platform_name: string | null;
  currency: string | null;
  timezone: string | null;
  account_email: string | null;
  last_synced_at: string | null;
  last_error: string | null;
  created_at: string;
  archived_at: string | null;
};

export type AdsAccountView = AdsAccountRow & {
  /** Nombre del cliente dueño; null si la cuenta es de la propia agencia. */
  owner_name: string | null;
  /** Google: false hasta que se conecta con OAuth. El resto, siempre true. */
  connected: boolean;
};

/** Contexto de cifrado: la credencial de una cuenta no se abre con otra ni en otra org. */
export function credentialContext(orgId: string, accountId: string): string {
  return `ads/${orgId}/${accountId}`;
}

/** Cuentas activas de la org con el nombre del dueño. Con la sesión del miembro (RLS). */
export async function listAdsAccounts(orgId: string): Promise<AdsAccountView[]> {
  const db = await createClient();
  const [accounts, clients, pending] = await Promise.all([
    db.from("ads_accounts").select(ACCOUNT_COLUMNS).eq("org_id", orgId).is("archived_at", null).order("created_at"),
    db.from("clients").select("id, display_name").eq("org_id", orgId),
    // Qué cuentas de Google siguen sin token: la columna cifrada solo la ve el servidor.
    createAdminClient().from("ads_accounts").select("id").eq("org_id", orgId).is("archived_at", null).is("credential_ciphertext", null),
  ]);
  if (accounts.error) throw accounts.error;
  if (clients.error) throw clients.error;
  if (pending.error) throw pending.error;
  const names = new Map((clients.data ?? []).map((c) => [c.id, c.display_name]));
  const notConnected = new Set((pending.data ?? []).map((row) => row.id));
  return (accounts.data ?? []).map((row) => ({
    ...(row as AdsAccountRow),
    owner_name: row.owner_client_id ? (names.get(row.owner_client_id) ?? null) : null,
    connected: !notConnected.has(row.id),
  }));
}

/** Credenciales en claro de una cuenta (solo el servidor; nunca salen de aquí). */
export async function openCredentials(account: Pick<AdsAccountRow, "id" | "org_id" | "external_account_id" | "login_customer_id">): Promise<ProviderCredentials> {
  const { data, error } = await createAdminClient()
    .from("ads_accounts")
    .select("credential_ciphertext, developer_token_ciphertext")
    .eq("org_id", account.org_id)
    .eq("id", account.id)
    .maybeSingle();
  if (error) throw error;
  if (!data?.credential_ciphertext) throw new AdsProviderError("not_connected");
  const store = secretStoreFromEnv();
  const context = credentialContext(account.org_id, account.id);
  return {
    credential: await store.open(data.credential_ciphertext, context),
    developerToken: data.developer_token_ciphertext ? await store.open(data.developer_token_ciphertext, context) : null,
    loginCustomerId: account.login_customer_id,
    externalAccountId: account.external_account_id,
  };
}

/** Comprueba una credencial contra la plataforma antes de guardarla. Lanza `AdsProviderError`. */
export function verifyAccount(provider: AdsProvider, creds: ProviderCredentials): Promise<AccountInfo> {
  return PROVIDERS[provider].account(creds);
}

export type AdsSnapshot = {
  from: string;
  to: string;
  /** Cuándo se pidió a la API lo que se enseña; null si nunca se ha podido. */
  fetchedAt: string | null;
  /** Minutos desde `fetchedAt` en el momento de cargar la página. */
  ageMinutes: number | null;
  campaigns: AdsCampaign[];
  /** Último error de la plataforma, si lo hubo (las cifras pueden ser de la foto anterior). */
  error: string | null;
};

/** Periodo de la foto: los últimos 28 días en la zona de la cuenta (o de la org). */
export function snapshotPeriod(timezone: string, now = new Date()): { from: string; to: string } {
  const to = nowInZone(timezone, now).date;
  return { from: addDays(to, -(ADS_PERIOD_DAYS - 1)), to };
}

/**
 * Las cifras de una cuenta: la foto guardada si tiene menos de 15 minutos; si no (o con `force`),
 * se pide a la plataforma y se guarda. Si la plataforma falla, se enseña la foto anterior con el error.
 */
export async function loadAdsSnapshot(account: AdsAccountRow, opts: { force?: boolean; timezone: string; now?: Date }): Promise<AdsSnapshot> {
  const admin = createAdminClient();
  const now = opts.now ?? new Date();
  const { data: cached, error: cacheError } = await admin
    .from("ads_insights")
    .select("period_from, period_to, fetched_at, campaigns")
    .eq("org_id", account.org_id)
    .eq("account_id", account.id)
    .maybeSingle();
  if (cacheError) throw cacheError;
  const ageOf = (iso: string | null) => (iso ? Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000)) : null);
  const previous: AdsSnapshot | null = cached
    ? {
        from: cached.period_from,
        to: cached.period_to,
        fetchedAt: cached.fetched_at,
        ageMinutes: ageOf(cached.fetched_at),
        campaigns: (Array.isArray(cached.campaigns) ? cached.campaigns : []).filter(isAdsCampaign),
        error: account.last_error,
      }
    : null;
  if (previous && !opts.force && isAdsSnapshotFresh(previous.fetchedAt, now)) return previous;

  const period = snapshotPeriod(account.timezone ?? opts.timezone, now);
  try {
    const creds = await openCredentials(account);
    const campaigns = await PROVIDERS[account.provider].campaigns(creds, period.from, period.to);
    const fetchedAt = now.toISOString();
    const [saved, marked] = await Promise.all([
      admin.from("ads_insights").upsert(
        { org_id: account.org_id, account_id: account.id, period_from: period.from, period_to: period.to, fetched_at: fetchedAt, campaigns },
        { onConflict: "org_id,account_id" },
      ),
      admin.from("ads_accounts").update({ last_synced_at: fetchedAt, last_error: null }).eq("org_id", account.org_id).eq("id", account.id),
    ]);
    if (saved.error) throw saved.error;
    if (marked.error) throw marked.error;
    return { from: period.from, to: period.to, fetchedAt, ageMinutes: 0, campaigns, error: null };
  } catch (error) {
    const message = describeProviderError(error);
    await admin.from("ads_accounts").update({ last_error: message }).eq("org_id", account.org_id).eq("id", account.id);
    if (!(error instanceof AdsProviderError) && !(error instanceof Error && error.name === "TimeoutError")) console.error("[ads] snapshot", account.id, error);
    return previous ? { ...previous, error: message } : { from: period.from, to: period.to, fetchedAt: null, ageMinutes: null, campaigns: [], error: message };
  }
}
