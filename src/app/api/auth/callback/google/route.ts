import { after, type NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { googleSetup } from "@/server/seo/config";
import {
  emailFromIdToken,
  exchangeCode,
  grantedFeatures,
  OAUTH_COOKIE,
  OAUTH_COOKIE_PATH,
  revokeToken,
  verifyState,
} from "@/server/seo/google-oauth";
import { SeoConnectionError, SeoSyncBusyError, syncSeo } from "@/server/seo/run";
import { integrationSecretContext, secretStoreFromEnv } from "@/server/seo/secret-store";
import { getSessionUser } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const googleFetch = (input: string, init?: RequestInit) => fetch(input, init);

/**
 * Vuelta de Google. Comprueba el `state` (firma, caducidad, mismo usuario y el nonce de la cookie),
 * cambia el código por los tokens, cifra el de refresco y lo guarda con la RPC connect_integration,
 * que vuelve a exigir que quien conecta sea owner de la org. Después, sincroniza en segundo plano.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const { config } = googleSetup();
  const clearCookie = (response: NextResponse) => {
    response.cookies.set(OAUTH_COOKIE, "", { path: OAUTH_COOKIE_PATH, maxAge: 0 });
    return response;
  };
  if (!config) return clearCookie(NextResponse.redirect(new URL("/", request.url)));

  const state = verifyState(params.get("state"), config.stateKey);
  if (!state) return clearCookie(NextResponse.redirect(new URL("/", request.url)));
  const done = (query: string, path = "seo") =>
    clearCookie(NextResponse.redirect(new URL(`/${state.slug}/${path}?${query}`, request.url)));

  const [nonce, verifier] = (request.cookies.get(OAUTH_COOKIE)?.value ?? "").split(".");
  if (!nonce || !verifier || nonce !== state.nonce) return done("google_error=state");
  const user = await getSessionUser();
  if (!user || user.id !== state.userId) return done("google_error=session");

  const googleError = params.get("error");
  if (googleError) return done(`google_error=${googleError === "access_denied" ? "denied" : "google"}`);
  const code = params.get("code");
  if (!code) return done("google_error=google");

  let grant;
  try {
    grant = await exchangeCode(googleFetch, { code, verifier, config });
  } catch (error) {
    console.error("[seo] google token exchange", error);
    return done("google_error=google");
  }
  if (!grant.refreshToken) return done("google_error=no_refresh_token");
  const features = grantedFeatures(grant.scopes);
  if (!features.searchConsole && !features.analytics) {
    await revokeToken(googleFetch, grant.refreshToken);
    return done("google_error=scopes");
  }

  const sealed = await secretStoreFromEnv().seal(grant.refreshToken, integrationSecretContext(state.orgId, "google"));
  const supabase = await createClient();
  const { error } = await supabase.rpc("connect_integration", {
    p_org: state.orgId,
    p_provider: "google",
    p_account_email: emailFromIdToken(grant.idToken) ?? "",
    p_scopes: grant.scopes,
    p_secret: sealed,
  });
  if (error) {
    await revokeToken(googleFetch, grant.refreshToken);
    if (error.code === "42501") return done("google_error=owner_required");
    console.error("[seo] connect_integration", error);
    return done("google_error=save");
  }

  const { count } = await supabase
    .from("seo_properties")
    .select("id", { count: "exact", head: true })
    .eq("org_id", state.orgId)
    .is("archived_at", null);
  if (!count) return done("google=connected&new=1", "seo/properties");

  // Reconexión con propiedades ya dadas de alta: se pone al día sin esperar al cron.
  after(async () => {
    try {
      await syncSeo(createAdminClient(), state.orgId);
    } catch (e) {
      if (!(e instanceof SeoConnectionError) && !(e instanceof SeoSyncBusyError)) console.error("[seo] sync after connect", e);
    }
  });
  return done("google=connected");
}
