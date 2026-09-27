import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { googleSetup } from "@/server/seo/config";
import {
  authorizationUrl,
  createPkce,
  newNonce,
  OAUTH_COOKIE,
  OAUTH_COOKIE_PATH,
  OAUTH_TTL_SECONDS,
  signState,
} from "@/server/seo/google-oauth";
import { getSessionUser } from "@/server/session";
import { publicIsHttps, publicUrl } from "@/lib/public-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SLUG = /^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/;

/**
 * Empieza la conexión con Google de una org (`?org=<slug>`). Solo un owner: firma un `state` atado
 * a él y a la org, deja el nonce y el verificador PKCE en una cookie de un solo uso y manda a la
 * pantalla de consentimiento de Google.
 */
export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("org") ?? "";
  if (!SLUG.test(slug)) return NextResponse.redirect(publicUrl("/"));
  const back = (error: string) => NextResponse.redirect(publicUrl(`/${slug}/seo?google_error=${error}`));

  const user = await getSessionUser();
  if (!user) return NextResponse.redirect(publicUrl(`/login?next=${encodeURIComponent(`/${slug}/seo`)}`));

  const { config } = googleSetup();
  if (!config) return back("not_configured");

  const supabase = await createClient();
  const { data: org } = await supabase.from("orgs").select("id, slug").eq("slug", slug).maybeSingle();
  if (!org) return NextResponse.redirect(publicUrl("/"));
  const { data: member } = await supabase
    .from("members")
    .select("role")
    .eq("org_id", org.id)
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();
  if (member?.role !== "owner") return back("owner_required");

  const nonce = newNonce();
  const { verifier, challenge } = createPkce();
  const state = signState(
    { orgId: org.id, slug: org.slug, userId: user.id, nonce, expiresAt: Date.now() + OAUTH_TTL_SECONDS * 1000 },
    config.stateKey,
  );

  const response = NextResponse.redirect(authorizationUrl({ config, state, challenge }));
  response.cookies.set(OAUTH_COOKIE, `${nonce}.${verifier}`, {
    httpOnly: true,
    secure: publicIsHttps(),
    sameSite: "lax",
    path: OAUTH_COOKIE_PATH,
    maxAge: OAUTH_TTL_SECONDS,
  });
  return response;
}
