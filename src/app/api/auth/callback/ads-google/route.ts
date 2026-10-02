import { type NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { publicUrl } from "@/lib/public-url";
import { credentialContext, openCredentials, verifyAccount } from "@/server/ads/accounts";
import { ADS_GOOGLE_OAUTH_COOKIE, adsGoogleConfig } from "@/server/ads/google-oauth";
import { GOOGLE_ADS_SCOPE } from "@/server/ads/providers/google";
import { describeProviderError } from "@/server/ads/providers/types";
import { emailFromIdToken, exchangeCode, revokeToken, verifyState } from "@/server/seo/google-oauth";
import { secretStoreFromEnv } from "@/server/seo/secret-store";
import { getSessionUser } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Vuelta de Google: guarda el token de refresco cifrado en la cuenta de Google Ads y comprueba que lee la cuenta. */
export async function GET(request: NextRequest) {
  const config = adsGoogleConfig();
  const clear = (response: NextResponse) => {
    response.cookies.set(ADS_GOOGLE_OAUTH_COOKIE, "", { path: "/api", maxAge: 0 });
    return response;
  };
  if (!config) return clear(NextResponse.redirect(publicUrl("/")));
  const state = verifyState(request.nextUrl.searchParams.get("state"), config.stateKey);
  if (!state) return clear(NextResponse.redirect(publicUrl("/")));
  const back = (code: string) => clear(NextResponse.redirect(publicUrl(`/${state.slug}/ads?ads_error=${code}`)));
  const [nonce, verifier, accountId] = (request.cookies.get(ADS_GOOGLE_OAUTH_COOKIE)?.value ?? "").split(".");
  const user = await getSessionUser();
  if (!nonce || nonce !== state.nonce || !verifier || !accountId || !user || user.id !== state.userId) return back("oauth_state");
  const db = await createClient();
  const { data: member } = await db.from("members").select("id, role, orgs!inner(id, slug)")
    .eq("org_id", state.orgId).eq("user_id", user.id).eq("is_active", true).maybeSingle();
  if (!member || member.role === "viewer" || member.orgs.slug !== state.slug) return back("permission");
  const admin = createAdminClient();
  const { data: account } = await admin.from("ads_accounts")
    .select("id, org_id, provider, label, owner_client_id, external_account_id, login_customer_id, platform_name, currency, timezone, account_email, last_synced_at, last_error, created_at, archived_at")
    .eq("org_id", state.orgId).eq("id", accountId).is("archived_at", null).maybeSingle();
  if (!account || account.provider !== "google") return back("input");
  if (request.nextUrl.searchParams.get("error")) return back("oauth_denied");
  const code = request.nextUrl.searchParams.get("code");
  if (!code) return back("oauth_google");
  let grant;
  try {
    grant = await exchangeCode(fetch, { code, verifier, config });
  } catch (error) {
    console.error("[ads] token exchange", error);
    return back("oauth_google");
  }
  if (!grant.refreshToken || !grant.scopes.includes(GOOGLE_ADS_SCOPE)) {
    if (grant.refreshToken) await revokeToken(fetch, grant.refreshToken);
    return back("oauth_scope");
  }
  const sealed = await secretStoreFromEnv().seal(grant.refreshToken, credentialContext(state.orgId, account.id));
  const { error } = await admin.from("ads_accounts")
    .update({ credential_ciphertext: sealed, account_email: emailFromIdToken(grant.idToken), last_error: null })
    .eq("org_id", state.orgId).eq("id", account.id);
  if (error) {
    await revokeToken(fetch, grant.refreshToken);
    console.error("[ads] save google credential", error);
    return back("oauth_save");
  }
  // Primera lectura: nombre, moneda y zona de la cuenta. Si falla, queda apuntado en la cuenta.
  try {
    const info = await verifyAccount("google", await openCredentials(account));
    await admin.from("ads_accounts")
      .update({ platform_name: info.name, currency: info.currency, timezone: info.timezone, external_account_id: info.externalAccountId })
      .eq("org_id", state.orgId).eq("id", account.id);
  } catch (verifyError) {
    await admin.from("ads_accounts").update({ last_error: describeProviderError(verifyError) }).eq("org_id", state.orgId).eq("id", account.id);
  }
  const owner = account.owner_client_id ?? "agency";
  return clear(NextResponse.redirect(publicUrl(`/${state.slug}/ads?owner=${owner}&ads=connected`)));
}
