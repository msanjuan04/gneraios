import type { Metadata } from "next";
import { headers } from "next/headers";
import { userAgent } from "next/server";
import { getTranslations } from "next-intl/server";
import { CalendarView } from "@/components/calendar/calendar-view";
import { type CalendarView as ViewName, inRange, parseCalendarState, viewRange } from "@/domain/calendar";
import { nowInZone } from "@/lib/clock";
import { createClient } from "@/lib/supabase/server";
import { getCalendarEvents } from "@/server/calendar/events";
import { getMyActiveFeed, isLocalAppUrl } from "@/server/calendar/feeds";
import { calendarGoogleConfig, syncGoogleCalendar } from "@/server/calendar/google";
import { getCrmConfig } from "@/server/crm/config";
import { getOrgContext, hasRole } from "@/server/session";

// Tipado a mano (y no con PageProps) para no depender de los tipos de rutas generados.
type Props = {
  params: Promise<{ org: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("calendar"))("title") };
}

/**
 * Calendario: una vista sobre las fechas que ya existen en GNERAI OS (vencimientos, facturación,
 * renovaciones, hitos, acciones, presupuestos, reuniones y plazos fiscales). El estado vive en la
 * URL (?view=&date=&types=&mine=); sin vista, el mes en el ordenador y la agenda en el móvil.
 */
export default async function CalendarPage(props: Props) {
  const [{ org: slug }, searchParams, requestHeaders] = await Promise.all([props.params, props.searchParams, headers()]);
  const { org, member } = await getOrgContext(slug);
  const defaultView: ViewName = userAgent({ headers: requestHeaders }).device.type === "mobile" ? "agenda" : "month";
  const today = nowInZone(org.timezone).date;
  const state = parseCalendarState(searchParams, today, defaultView);
  const range = viewRange(state.view, state.date);
  const supabase = await createClient();
  await syncGoogleCalendar(org.id, member.id, org.timezone, range.from, range.to);

  const [events, config, feed, googleConnection] = await Promise.all([
    // Todos los tipos (filtrar es instantáneo en el navegador) y, si se ve hoy, lo atrasado de antes.
    getCalendarEvents(supabase, org.id, { from: range.from, to: range.to, includeOverdue: inRange(today, range), org, personalMemberId: member.id }),
    getCrmConfig(org.id),
    getMyActiveFeed(supabase, org.id, member.id),
    supabase.from("google_calendar_connections").select("account_email, calendar_id, last_synced_at, last_error").eq("org_id", org.id).eq("member_id", member.id).maybeSingle(),
  ]);

  return (
    <CalendarView
      // Cada vista y fecha empieza limpia (paneles cerrados). Los filtros no: se cambian sin recargar.
      key={`${state.view}:${state.date}`}
      slug={org.slug}
      basePath={`/${org.slug}`}
      today={today}
      state={state}
      defaultView={defaultView}
      range={range}
      events={events}
      members={config.members}
      currentMemberId={member.id}
      canMove={hasRole(member.role, "partner")}
      money={{ locale: org.locale, currency: org.currency }}
      feed={feed}
      localAppUrl={isLocalAppUrl()}
      timeZone={org.timezone}
      googleConfigured={calendarGoogleConfig() !== null}
      googleConnection={googleConnection.data}
      googleError={typeof searchParams.google_error === "string" ? searchParams.google_error : null}
    />
  );
}
