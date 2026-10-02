import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { publicIsHttps, publicUrl } from "@/lib/public-url";
import { ADS_GOOGLE_OAUTH_COOKIE, adsGoogleConfig } from "@/server/ads/google-oauth";
import { GOOGLE_ADS_SCOPE } from "@/server/ads/providers/google";
import { authorizationUrl, createPkce, newNonce, OAUTH_TTL_SECONDS, signState } from "@/server/seo/google-oauth";
import { getSessionUser } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SLUG = /^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Autoriza la lectura de una cuenta de Google Ads ya dada de alta (scope adwords) con la cuenta Google que la ve. */
export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("org") ?? "";
  const accountId = request.nextUrl.searchParams.get("account") ?? "";
  if (!SLUG.test(slug)) return NextResponse.redirect(publicUrl("/"));
  const back = (error: string) => NextResponse.redirect(publicUrl(`/${slug}/ads?ads_error=${error}`));
  if (!UUID.test(accountId)) return back("input");
  const user = await getSessionUser();
  if (!user) return NextResponse.redirect(publicUrl(`/login?next=${encodeURIComponent(`/${slug}/ads`)}`));
  const config = adsGoogleConfig();
  if (!config) return back("not_configured");
  const db = await createClient();
  const { data: org } = await db.from("orgs").select("id, slug").eq("slug", slug).maybeSingle();
  if (!org) return NextResponse.redirect(publicUrl("/"));
  const { data: member } = await db.from("members").select("id, role").eq("org_id", org.id).eq("user_id", user.id).eq("is_active", true).maybeSingle();
  if (!member || member.role === "viewer") return back("permission");
  const { data: account } = await db.from("ads_accounts").select("id, provider").eq("org_id", org.id).eq("id", accountId).is("archived_at", null).maybeSingle();
  if (!account || account.provider !== "google") return back("input");
  const nonce = newNonce();
  const { verifier, challenge } = createPkce();
  const state = signState({ orgId: org.id, slug: org.slug, userId: user.id, nonce, expiresAt: Date.now() + OAUTH_TTL_SECONDS * 1000 }, config.stateKey);
  const response = NextResponse.redirect(authorizationUrl({ config, state, challenge, scopes: ["openid", "email", GOOGLE_ADS_SCOPE] }));
  response.cookies.set(ADS_GOOGLE_OAUTH_COOKIE, `${nonce}.${verifier}.${account.id}`, {
    httpOnly: true, secure: publicIsHttps(), sameSite: "lax", path: "/api", maxAge: OAUTH_TTL_SECONDS,
  });
  return response;
}
