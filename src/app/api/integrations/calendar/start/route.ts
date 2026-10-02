import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { publicIsHttps, publicUrl } from "@/lib/public-url";
import { CALENDAR_OAUTH_COOKIE, CALENDAR_SCOPE, calendarGoogleConfig } from "@/server/calendar/google";
import { authorizationUrl, createPkce, newNonce, OAUTH_TTL_SECONDS, signState } from "@/server/seo/google-oauth";
import { getSessionUser } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SLUG = /^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/;

/** OAuth individual: cada miembro crea o reutiliza su calendario «GNERAI OS». */
export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("org") ?? "";
  if (!SLUG.test(slug)) return NextResponse.redirect(publicUrl("/"));
  const back = (error: string) => NextResponse.redirect(publicUrl(`/${slug}/calendar?google_error=${error}`));
  const user = await getSessionUser();
  if (!user) return NextResponse.redirect(publicUrl(`/login?next=${encodeURIComponent(`/${slug}/calendar`)}`));
  const config = calendarGoogleConfig();
  if (!config) return back("not_configured");
  const db = await createClient();
  const { data: org } = await db.from("orgs").select("id, slug").eq("slug", slug).maybeSingle();
  if (!org) return NextResponse.redirect(publicUrl("/"));
  const { data: member } = await db.from("members").select("id, role").eq("org_id", org.id).eq("user_id", user.id).eq("is_active", true).maybeSingle();
  if (!member || member.role === "viewer") return back("permission");
  const nonce = newNonce();
  const { verifier, challenge } = createPkce();
  const state = signState({ orgId: org.id, slug: org.slug, userId: user.id, nonce, expiresAt: Date.now() + OAUTH_TTL_SECONDS * 1000 }, config.stateKey);
  const response = NextResponse.redirect(authorizationUrl({ config, state, challenge, scopes: ["openid", "email", CALENDAR_SCOPE] }));
  response.cookies.set(CALENDAR_OAUTH_COOKIE, `${nonce}.${verifier}`, {
    httpOnly: true, secure: publicIsHttps(), sameSite: "lax", path: "/api", maxAge: OAUTH_TTL_SECONDS,
  });
  return response;
}
