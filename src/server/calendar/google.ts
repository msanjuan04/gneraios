import "server-only";

import { addDays, type CivilDate } from "@/domain/dates/civil-date";
import { fromDateTimeLocal } from "@/domain/dates/zoned-time";
import { publicEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Tables } from "@/lib/supabase/database.types";
import { googleSetup } from "@/server/seo/config";
import { refreshAccessToken } from "@/server/seo/google-oauth";
import { secretStoreFromEnv } from "@/server/seo/secret-store";

// Permite crear un calendario secundario y gestionar solo los eventos creados en él.
export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.app.created";
export const CALENDAR_OAUTH_COOKIE = "gnerai_calendar_oauth";

export function calendarGoogleConfig() {
  const base = googleSetup().config;
  return base ? { ...base, redirectUri: `${publicEnv.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "")}/api/auth/callback/calendar` } : null;
}

export function calendarSecretContext(orgId: string, memberId: string) {
  return `google-calendar/${orgId}/${memberId}`;
}

type GoogleEvent = {
  id?: string;
  status?: string;
  summary?: string;
  description?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
};

export class CalendarGoogleError extends Error {
  constructor(readonly status: number, readonly operation: string) {
    super(`Google Calendar ${operation}: HTTP ${status}`);
  }
}

async function googleRequest(token: string, calendarId: string, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers },
    cache: "no-store",
  });
}

/** Crea el calendario seleccionable «GNERAI OS» en la cuenta Google del miembro. */
export async function createDedicatedCalendar(token: string, timeZone: string): Promise<string> {
  const response = await fetch("https://www.googleapis.com/calendar/v3/calendars", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ summary: "GNERAI OS", description: "Eventos sincronizados con GNERAI OS", timeZone }),
    cache: "no-store",
  });
  if (!response.ok) throw new CalendarGoogleError(response.status, "create_calendar");
  const body = (await response.json()) as { id?: string };
  if (!body.id) throw new Error("Google no devolvió el ID del calendario creado.");
  return body.id;
}

function googleBody(row: Tables<"calendar_entries">): Record<string, unknown> {
  return {
    summary: row.title,
    description: row.description,
    start: row.all_day ? { date: row.starts_at.slice(0, 10) } : { dateTime: row.starts_at },
    end: row.all_day ? { date: row.ends_at.slice(0, 10) } : { dateTime: row.ends_at },
    extendedProperties: { private: { gnerai_entry_id: row.id } },
  };
}

/** ID estable: si Google aceptó un alta pero se perdió la respuesta, reintentar no duplica cita. */
function googleId(id: string) {
  return `gnerai${id.replace(/-/g, "")}`;
}

async function publishPending(token: string, calendarId: string, orgId: string, memberId: string) {
  const db = createAdminClient();
  const { data: pending, error } = await db.from("calendar_entries").select("*")
    .eq("org_id", orgId).eq("member_id", memberId).eq("dirty", true).order("updated_at").limit(100);
  if (error) throw error;
  for (const row of pending ?? []) {
    if (row.deleted_at) {
      if (row.google_event_id) {
        const response = await googleRequest(token, calendarId, `/${encodeURIComponent(row.google_event_id)}`, { method: "DELETE" });
        if (!response.ok && response.status !== 404 && response.status !== 410) throw new CalendarGoogleError(response.status, "delete");
      }
      const deleted = await db.from("calendar_entries").delete().eq("id", row.id).eq("org_id", orgId).eq("member_id", memberId).eq("dirty", true).eq("updated_at", row.updated_at);
      if (deleted.error) throw deleted.error;
      continue;
    }
    const id = row.google_event_id ?? googleId(row.id);
    const response = row.google_event_id
      ? await googleRequest(token, calendarId, `/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(googleBody(row)) })
      : await googleRequest(token, calendarId, "", { method: "POST", body: JSON.stringify({ ...googleBody(row), id }) });
    if (!response.ok && !(response.status === 409 && !row.google_event_id)) throw new CalendarGoogleError(response.status, "save");
    const saved = await db.from("calendar_entries").update({ google_event_id: id, dirty: false })
      .eq("id", row.id).eq("org_id", orgId).eq("member_id", memberId).eq("dirty", true).eq("updated_at", row.updated_at);
    if (saved.error) throw saved.error;
  }
}

function parseGoogleEvent(event: GoogleEvent): { title: string; description: string; starts_at: string; ends_at: string; all_day: boolean } | null {
  const allDay = Boolean(event.start?.date && event.end?.date);
  const start = allDay ? `${event.start?.date}T00:00:00.000Z` : event.start?.dateTime;
  const end = allDay ? `${event.end?.date}T00:00:00.000Z` : event.end?.dateTime;
  if (!start || !end) return null;
  const startsAt = new Date(start);
  const endsAt = new Date(end);
  if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt) return null;
  // La tabla limita duración a 31 días. Eventos extraordinariamente largos se quedan en Google.
  if (endsAt.getTime() - startsAt.getTime() > 31 * 86400000) return null;
  return { title: (event.summary || "(Sin título)").slice(0, 200), description: (event.description || "").slice(0, 10000), starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(), all_day: allDay };
}

async function pullWindow(token: string, calendarId: string, orgId: string, memberId: string, timeZone: string, from: CivilDate, to: CivilDate) {
  const db = createAdminClient();
  const start = fromDateTimeLocal(`${from}T00:00`, timeZone);
  const end = fromDateTimeLocal(`${addDays(to, 1)}T00:00`, timeZone);
  if (!start || !end) throw new Error("Invalid calendar range");
  const { data: linked, error: readError } = await db.from("calendar_entries").select("id, google_event_id, dirty, updated_at")
    .eq("org_id", orgId).eq("member_id", memberId).lt("starts_at", end.toISOString()).gt("ends_at", start.toISOString()).not("google_event_id", "is", null);
  if (readError) throw readError;
  const byGoogleId = new Map((linked ?? []).map((row) => [row.google_event_id, row]));
  const seen = new Set<string>();
  let pageToken: string | null = null;
  do {
    const params = new URLSearchParams({ singleEvents: "true", showDeleted: "true", maxResults: "2500", timeMin: start.toISOString(), timeMax: end.toISOString() });
    if (pageToken) params.set("pageToken", pageToken);
    const response = await googleRequest(token, calendarId, `?${params.toString()}`);
    if (!response.ok) throw new CalendarGoogleError(response.status, "list");
    const body = (await response.json()) as { items?: GoogleEvent[]; nextPageToken?: string };
    for (const event of body.items ?? []) {
      if (!event.id) continue;
      if (event.status === "cancelled") {
        const existing = byGoogleId.get(event.id);
        if (existing && !existing.dirty) {
          const deleted = await db.from("calendar_entries").delete().eq("id", existing.id).eq("org_id", orgId).eq("member_id", memberId).eq("dirty", false).eq("updated_at", existing.updated_at);
          if (deleted.error) throw deleted.error;
        }
        continue;
      }
      const parsed = parseGoogleEvent(event);
      if (!parsed) continue;
      seen.add(event.id);
      const existing = byGoogleId.get(event.id);
      if (existing?.dirty) continue;
      const record = { ...parsed, org_id: orgId, member_id: memberId, google_event_id: event.id, dirty: false, deleted_at: null };
      const result = existing
        ? await db.from("calendar_entries").update(record).eq("id", existing.id).eq("org_id", orgId).eq("member_id", memberId).eq("dirty", false).eq("updated_at", existing.updated_at)
        : await db.from("calendar_entries").upsert(record, { onConflict: "org_id,member_id,google_event_id" });
      if (result.error) throw result.error;
    }
    pageToken = body.nextPageToken ?? null;
  } while (pageToken);
  for (const row of linked ?? []) {
    if (!row.dirty && row.google_event_id && !seen.has(row.google_event_id)) {
      const deleted = await db.from("calendar_entries").delete().eq("id", row.id).eq("org_id", orgId).eq("member_id", memberId).eq("dirty", false).eq("updated_at", row.updated_at);
      if (deleted.error) throw deleted.error;
    }
  }
}

/** Sube cambios locales y lee cambios del móvil en el rango visible. Cada socio usa su cuenta. */
export async function syncGoogleCalendar(orgId: string, memberId: string, timeZone: string, from: CivilDate, to: CivilDate): Promise<boolean> {
  const config = calendarGoogleConfig();
  if (!config) return false;
  const db = createAdminClient();
  const { data: connection, error } = await db.from("google_calendar_connections").select("id, calendar_id, refresh_token_ciphertext")
    .eq("org_id", orgId).eq("member_id", memberId).maybeSingle();
  if (error) throw error;
  if (!connection) return false;
  try {
    const secret = await secretStoreFromEnv().open(connection.refresh_token_ciphertext, calendarSecretContext(orgId, memberId));
    const grant = await refreshAccessToken(fetch, { refreshToken: secret, config });
    const calendarId = connection.calendar_id ?? "primary";
    await publishPending(grant.accessToken, calendarId, orgId, memberId);
    await pullWindow(grant.accessToken, calendarId, orgId, memberId, timeZone, from, to);
    const updated = await db.from("google_calendar_connections").update({ last_synced_at: new Date().toISOString(), last_error: null })
      .eq("id", connection.id).eq("org_id", orgId).eq("member_id", memberId);
    if (updated.error) throw updated.error;
    return true;
  } catch (error) {
    console.error("[calendar] google sync", error);
    await db.from("google_calendar_connections").update({ last_error: error instanceof Error ? error.message.slice(0, 200) : "sync_failed" })
      .eq("id", connection.id).eq("org_id", orgId).eq("member_id", memberId);
    return false;
  }
}
