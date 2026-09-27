// Vistas del calendario y su estado en la URL (?view=&date=&types=&mine=): qué días pinta cada
// vista, cómo se navega y cómo se lee y se escribe la URL. Las semanas empiezan en lunes.

import { addDays, addMonthsClamped, compareCivil, daysInMonth, formatCivil, parseCivilDate, type CivilDate } from "../dates/civil-date";
import { isoWeekday } from "./fiscal";
import { CALENDAR_EVENT_TYPES, type CalendarEventType, DEFAULT_EVENT_TYPES, isCalendarEventType } from "./types";

export const CALENDAR_VIEWS = ["month", "week", "agenda"] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];

/** Días que abarca la agenda desde su fecha. */
export const AGENDA_DAYS = 30;

export type DateRange = { from: CivilDate; to: CivilDate };

export function isCalendarView(value: unknown): value is CalendarView {
  return typeof value === "string" && (CALENDAR_VIEWS as readonly string[]).includes(value);
}

/** Lunes de la semana de `date`. */
export function weekStart(date: CivilDate): CivilDate {
  return addDays(date, 1 - isoWeekday(date));
}

export function monthStart(date: CivilDate): CivilDate {
  const { year, month } = parseCivilDate(date);
  return formatCivil({ year, month, day: 1 });
}

export function monthEnd(date: CivilDate): CivilDate {
  const { year, month } = parseCivilDate(date);
  return formatCivil({ year, month, day: daysInMonth(year, month) });
}

/** Días de `from` a `to`, ambos incluidos. */
export function eachDay({ from, to }: DateRange): CivilDate[] {
  const days: CivilDate[] = [];
  for (let d = from; compareCivil(d, to) <= 0; d = addDays(d, 1)) days.push(d);
  return days;
}

/**
 * Lo que pinta cada vista: el mes en semanas completas (de lunes a domingo, 4 a 6 semanas), la
 * semana de lunes a domingo o los AGENDA_DAYS días desde la fecha.
 */
export function viewRange(view: CalendarView, anchor: CivilDate): DateRange {
  if (view === "month") return { from: weekStart(monthStart(anchor)), to: addDays(weekStart(monthEnd(anchor)), 6) };
  if (view === "week") {
    const from = weekStart(anchor);
    return { from, to: addDays(from, 6) };
  }
  return { from: anchor, to: addDays(anchor, AGENDA_DAYS - 1) };
}

/** La cuadrícula del mes: semanas de 7 días. */
export function monthWeeks(anchor: CivilDate): CivilDate[][] {
  const days = eachDay(viewRange("month", anchor));
  const weeks: CivilDate[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return weeks;
}

/** Fecha de la vista anterior o siguiente (← / →). El mes se ancla en su día 1. */
export function shiftAnchor(view: CalendarView, anchor: CivilDate, direction: -1 | 1): CivilDate {
  if (view === "month") return addMonthsClamped(monthStart(anchor), direction);
  return addDays(anchor, direction * (view === "week" ? 7 : AGENDA_DAYS));
}

export function inRange(date: CivilDate, { from, to }: DateRange): boolean {
  return compareCivil(date, from) >= 0 && compareCivil(date, to) <= 0;
}

export type CalendarState = {
  view: CalendarView;
  date: CivilDate;
  types: CalendarEventType[];
  /** Solo lo del socio (y lo que es de todos). */
  mine: boolean;
};

type RawParams = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

function validDate(value: string | undefined): CivilDate | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  try {
    const { year } = parseCivilDate(value);
    // Fuera de lo razonable no hay nada que pintar (y evita rangos absurdos).
    return year >= 2000 && year <= 2100 ? value : null;
  } catch {
    return null;
  }
}

/**
 * Estado del calendario a partir de la URL. Sin vista, la que toque por dispositivo (la agenda en
 * el móvil); sin fecha, hoy; sin tipos, los de por defecto (`types=` vacío = ninguno).
 */
export function parseCalendarState(params: RawParams, today: CivilDate, defaultView: CalendarView = "month"): CalendarState {
  const view = first(params.view);
  const rawTypes = first(params.types);
  const requested = new Set((rawTypes ?? "").split(",").filter(isCalendarEventType));
  const types = rawTypes === undefined ? [...DEFAULT_EVENT_TYPES] : CALENDAR_EVENT_TYPES.filter((type) => requested.has(type));
  return {
    view: isCalendarView(view) ? view : defaultView,
    date: validDate(first(params.date)) ?? today,
    types,
    mine: first(params.mine) === "1",
  };
}

/**
 * La URL de un estado, sin lo que coincide con los valores por defecto: `?view=week&date=…`.
 * `defaultView` es la del dispositivo, para no fijarla en la URL si no se ha elegido.
 */
export function calendarSearch(state: CalendarState, today: CivilDate, defaultView: CalendarView = "month"): string {
  const params = new URLSearchParams();
  if (state.view !== defaultView) params.set("view", state.view);
  if (state.date !== today) params.set("date", state.date);
  const sameAsDefault =
    state.types.length === DEFAULT_EVENT_TYPES.length && DEFAULT_EVENT_TYPES.every((type) => state.types.includes(type));
  if (!sameAsDefault) params.set("types", CALENDAR_EVENT_TYPES.filter((type) => state.types.includes(type)).join(","));
  if (state.mine) params.set("mine", "1");
  const query = params.toString();
  return query ? `?${query}` : "";
}
