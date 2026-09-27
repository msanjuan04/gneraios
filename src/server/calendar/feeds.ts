import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { CALENDAR_EVENT_TYPES, type CalendarEventType } from "@/domain/calendar";
import { addDays, addMonthsClamped } from "@/domain/dates/civil-date";
import { isLocale } from "@/i18n/config";
import { nowInZone } from "@/lib/clock";
import { publicEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { type Db, DbError } from "@/server/billing/context";
import { getCalendarEvents } from "./events";
import { buildIcs } from "./ics";
import { toIcsEvent } from "./ics-events";
import { calendarTranslator } from "./translator";

/**
 * Enlaces privados de suscripción (ICS). El token son 32 bytes aleatorios en base64url (43
 * caracteres); la base de datos solo guarda su SHA-256, así que el enlace se enseña una vez, al
 * crearlo. Quien lo tenga ve el calendario del socio: se revoca (o se cambia) cuando se quiera.
 */

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** Lo que incluye el enlace: los próximos 12 meses y, para que lo reciente no desaparezca de golpe, los últimos 30 días. */
export const FEED_LOOKBACK_DAYS = 30;
export const FEED_MONTHS = 12;
/** Las facturas emitidas son historia: no van al calendario de nadie. */
export const FEED_TYPES: readonly CalendarEventType[] = CALENDAR_EVENT_TYPES.filter((type) => type !== "issued");

export function generateFeedToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashFeedToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** El token de la URL (admite el sufijo .ics), o null si no tiene la forma de uno. */
export function parseFeedToken(param: string): string | null {
  const token = param.replace(/\.ics$/i, "");
  return TOKEN.test(token) ? token : null;
}

function appUrl(): string {
  return publicEnv.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "");
}

/** La URL https del enlace (la que se pega en Google Calendar). */
export function feedUrl(token: string): string {
  return `${appUrl()}/api/calendar/${token}.ics`;
}

/** Si la app corre en local: Google no puede leer un enlace de localhost. */
export function isLocalAppUrl(): boolean {
  const { hostname } = new URL(appUrl());
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname.endsWith(".localhost");
}

export type MemberFeed = { id: string; scope: "mine" | "all"; createdAt: string; lastUsedAt: string | null };

/** El enlace activo del socio (sin el token, que no se guarda). Con el cliente del usuario (RLS). */
export async function getMyActiveFeed(db: Db, orgId: string, memberId: string): Promise<MemberFeed | null> {
  const { data, error } = await db
    .from("calendar_feeds")
    .select("id, scope, created_at, last_used_at")
    .eq("org_id", orgId)
    .eq("member_id", memberId)
    .is("revoked_at", null)
    .maybeSingle();
  if (error) throw new DbError(error, "calendar.myFeed");
  return data ? { id: data.id, scope: data.scope, createdAt: data.created_at, lastUsedAt: data.last_used_at } : null;
}

/**
 * El ICS de un enlace, o null si no existe, está revocado o su socio ya no está activo. Sin sesión:
 * resuelve el enlace con el cliente de servidor y, desde ahí, todo se filtra por la org del enlace.
 */
export async function renderFeedByToken(token: string, now: Date = new Date()): Promise<string | null> {
  const admin = createAdminClient();
  const { data: feed, error } = await admin
    .from("calendar_feeds")
    .select("id, org_id, member_id, scope, last_used_at")
    .eq("token_hash", hashFeedToken(token))
    .is("revoked_at", null)
    .maybeSingle();
  if (error) throw new DbError(error, "calendar.feed");
  if (!feed) return null;

  const [member, org] = await Promise.all([
    admin.from("members").select("id, is_active, locale").eq("org_id", feed.org_id).eq("id", feed.member_id).maybeSingle(),
    admin.from("orgs").select("id, name, slug, timezone, settings, locale, currency").eq("id", feed.org_id).maybeSingle(),
  ]);
  if (member.error) throw new DbError(member.error, "calendar.feed.member");
  if (org.error) throw new DbError(org.error, "calendar.feed.org");
  if (!member.data?.is_active || !org.data) return null;

  // Google lo lee cada pocas horas: basta con apuntarlo como mucho una vez por hora.
  if (!feed.last_used_at || now.getTime() - Date.parse(feed.last_used_at) > 3_600_000) {
    await admin.from("calendar_feeds").update({ last_used_at: now.toISOString() }).eq("id", feed.id).eq("org_id", feed.org_id);
  }

  const orgRow = org.data;
  const today = nowInZone(orgRow.timezone, now).date;
  const events = await getCalendarEvents(admin, orgRow.id, {
    from: addDays(today, -FEED_LOOKBACK_DAYS),
    to: addMonthsClamped(today, FEED_MONTHS),
    types: FEED_TYPES,
    memberId: feed.scope === "mine" ? feed.member_id : null,
    org: orgRow,
    now,
  });

  const locale = isLocale(member.data.locale) ? member.data.locale : "es";
  const t = calendarTranslator(locale);
  const base = appUrl();
  const format = {
    t,
    locale,
    moneyLocale: orgRow.locale,
    currency: orgRow.currency,
    orgUrl: `${base}/${orgRow.slug}`,
    uidDomain: new URL(base).hostname,
  };
  return buildIcs({
    name: t("ics.name", { org: orgRow.name }),
    description: t("ics.description"),
    timeZone: orgRow.timezone,
    generatedAt: now,
    events: events.map((event) => toIcsEvent(event, format)),
  });
}
