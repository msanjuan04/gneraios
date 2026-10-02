import { type NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { publicUrl } from "@/lib/public-url";
import { CALENDAR_OAUTH_COOKIE, CALENDAR_SCOPE, calendarGoogleConfig, calendarSecretContext, createDedicatedCalendar, syncGoogleCalendar } from "@/server/calendar/google";
import { emailFromIdToken, exchangeCode, revokeToken, verifyState } from "@/server/seo/google-oauth";
import { secretStoreFromEnv } from "@/server/seo/secret-store";
import { getSessionUser } from "@/server/session";
import { nowInZone } from "@/lib/clock";
import { addDays } from "@/domain/dates/civil-date";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const config = calendarGoogleConfig();
  const clear = (response: NextResponse) => {
    response.cookies.set(CALENDAR_OAUTH_COOKIE, "", { path: "/api", maxAge: 0 });
    return response;
  };
  if (!config) return clear(NextResponse.redirect(publicUrl("/")));
  const state = verifyState(request.nextUrl.searchParams.get("state"), config.stateKey);
  if (!state) return clear(NextResponse.redirect(publicUrl("/")));
  const back = (code: string) => clear(NextResponse.redirect(publicUrl(`/${state.slug}/calendar?google_error=${code}`)));
  const [nonce, verifier] = (request.cookies.get(CALENDAR_OAUTH_COOKIE)?.value ?? "").split(".");
  const user = await getSessionUser();
  if (!nonce || nonce !== state.nonce || !verifier || !user || user.id !== state.userId) return back("state");
  const db = await createClient();
  const { data: member } = await db.from("members").select("id, role, orgs!inner(id, slug, timezone)")
    .eq("org_id", state.orgId).eq("user_id", user.id).eq("is_active", true).maybeSingle();
  if (!member || member.role === "viewer" || member.orgs.slug !== state.slug) return back("permission");
  if (request.nextUrl.searchParams.get("error")) return back("denied");
  const code = request.nextUrl.searchParams.get("code");
  if (!code) return back("google");
  let grant;
  try {
    grant = await exchangeCode(fetch, { code, verifier, config });
  } catch (error) {
    console.error("[calendar] token exchange", error);
    return back("google");
  }
  if (!grant.refreshToken || !grant.scopes.includes(CALENDAR_SCOPE)) {
    if (grant.refreshToken) await revokeToken(fetch, grant.refreshToken);
    return back("scope");
  }
  const sealed = await secretStoreFromEnv().seal(grant.refreshToken, calendarSecretContext(state.orgId, member.id));
  const admin = createAdminClient();
  const { data: existing, error: existingError } = await admin.from("google_calendar_connections")
    .select("calendar_id").eq("org_id", state.orgId).eq("member_id", member.id).maybeSingle();
  if (existingError) return back("save");
  let calendarId = existing?.calendar_id;
  if (!calendarId) {
    if (existing) {
      const { count, error: linkedError } = await admin.from("calendar_entries")
        .select("id", { count: "exact", head: true })
        .eq("org_id", state.orgId).eq("member_id", member.id).not("google_event_id", "is", null);
      if (linkedError || (count ?? 0) > 0) {
        await revokeToken(fetch, grant.refreshToken);
        return back("legacy_calendar");
      }
    }
    try {
      calendarId = await createDedicatedCalendar(grant.accessToken, member.orgs.timezone);
    } catch (error) {
      console.error("[calendar] create dedicated calendar", error);
      await revokeToken(fetch, grant.refreshToken);
      return back("google");
    }
  }
  const { error } = await admin.from("google_calendar_connections").upsert({
    org_id: state.orgId, member_id: member.id, account_email: emailFromIdToken(grant.idToken) ?? "",
    calendar_id: calendarId, refresh_token_ciphertext: sealed, granted_scopes: grant.scopes, connected_at: new Date().toISOString(), last_error: null,
  }, { onConflict: "org_id,member_id" });
  if (error) {
    await revokeToken(fetch, grant.refreshToken);
    console.error("[calendar] save connection", error);
    return back("save");
  }
  const today = nowInZone(member.orgs.timezone).date;
  await syncGoogleCalendar(state.orgId, member.id, member.orgs.timezone, addDays(today, -30), addDays(today, 90));
  return clear(NextResponse.redirect(publicUrl(`/${state.slug}/calendar?google=connected`)));
}
