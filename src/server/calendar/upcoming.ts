import "server-only";
import {
  type CalendarEvent,
  type CollectionTotals,
  collectionTotals,
  DEFAULT_EVENT_TYPES,
  eachDay,
  groupByDay,
  isActionable,
} from "@/domain/calendar";
import { addDays, type CivilDate } from "@/domain/dates/civil-date";
import { nowInZone } from "@/lib/clock";
import type { Tables } from "@/lib/supabase/database.types";
import type { Db } from "@/server/billing/context";
import { getCalendarEvents } from "./events";

/** Lo que pinta la tarjeta "Esta semana" del dashboard. */
export type UpcomingWeek = {
  basePath: string;
  today: CivilDate;
  /** Hoy y los 6 días siguientes, con sus eventos (ya ordenados). */
  days: { date: CivilDate; events: CalendarEvent[] }[];
  /** Lo de antes de hoy que aún pide algo (cobros vencidos, acciones atrasadas…). */
  overdue: CalendarEvent[];
  collections: CollectionTotals;
  money: { locale: string; currency: string };
  /** Si solo incluye lo del socio (y lo que es de todos). */
  mine: boolean;
};

export const UPCOMING_DAYS = 7;

/**
 * Los próximos 7 días del calendario para el dashboard, con la sesión del usuario (RLS).
 * `mine`: solo lo del socio y lo que es de todos.
 */
export async function loadUpcomingWeek(
  db: Db,
  ctx: { org: Pick<Tables<"orgs">, "id" | "slug" | "timezone" | "settings" | "locale" | "currency">; member: { id: string } },
  options: { mine?: boolean; now?: Date } = {},
): Promise<UpcomingWeek> {
  const now = options.now ?? new Date();
  const today = nowInZone(ctx.org.timezone, now).date;
  const to = addDays(today, UPCOMING_DAYS - 1);
  const events = await getCalendarEvents(db, ctx.org.id, {
    from: today,
    to,
    types: DEFAULT_EVENT_TYPES,
    memberId: options.mine ? ctx.member.id : null,
    includeOverdue: true,
    org: ctx.org,
    now,
  });
  const overdue = events.filter((event) => event.date < today && isActionable(event));
  const inWeek = events.filter((event) => event.date >= today);
  const byDay = groupByDay(inWeek);
  return {
    basePath: `/${ctx.org.slug}`,
    today,
    days: eachDay({ from: today, to }).map((date) => ({ date, events: byDay.get(date) ?? [] })),
    overdue,
    collections: collectionTotals(inWeek),
    money: { locale: ctx.org.locale, currency: ctx.org.currency },
    mine: options.mine === true,
  };
}
