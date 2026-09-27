// Orden, filtros, agrupación por día y avisos de carga del calendario. Puro: lo usan la pantalla,
// el enlace ICS y la tarjeta del dashboard.

import { compareCivil, type CivilDate } from "../dates/civil-date";
import type { Cents } from "../money";
import { CALENDAR_EVENT_TYPES, type CalendarEvent, type CalendarEventStatus, type CalendarEventType } from "./types";

const STATUS_RANK: Record<CalendarEventStatus, number> = { overdue: 0, pending: 1, scheduled: 2, done: 3, past: 4 };
const TYPE_RANK = new Map<CalendarEventType, number>(CALENDAR_EVENT_TYPES.map((type, index) => [type, index]));

/**
 * Orden dentro del calendario: por fecha y, en un mismo día, primero lo que pide algo (vencido,
 * pendiente), luego lo de todo el día y lo que tiene hora por su hora, y después por tipo.
 */
export function compareEvents(a: CalendarEvent, b: CalendarEvent): number {
  return (
    compareCivil(a.date, b.date) ||
    STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
    Number(a.time !== null) - Number(b.time !== null) ||
    (a.time ?? "").localeCompare(b.time ?? "") ||
    (TYPE_RANK.get(a.type) ?? 0) - (TYPE_RANK.get(b.type) ?? 0) ||
    a.title.localeCompare(b.title, "es") ||
    a.id.localeCompare(b.id)
  );
}

export function sortEvents(events: readonly CalendarEvent[]): CalendarEvent[] {
  return [...events].sort(compareEvents);
}

export type CalendarFilter = {
  types: readonly CalendarEventType[];
  /** "Solo lo mío": lo de este socio y lo que es de todos (sin responsable). null = todo. */
  memberId: string | null;
};

export function filterEvents(events: readonly CalendarEvent[], filter: CalendarFilter): CalendarEvent[] {
  const types = new Set(filter.types);
  return events.filter(
    (event) =>
      types.has(event.type) &&
      (filter.memberId === null || event.ownerMemberId === null || event.ownerMemberId === filter.memberId),
  );
}

/** Eventos por día, en orden de fecha y, dentro de cada día, con compareEvents. */
export function groupByDay(events: readonly CalendarEvent[]): Map<CivilDate, CalendarEvent[]> {
  const days = new Map<CivilDate, CalendarEvent[]>();
  for (const event of sortEvents(events)) {
    const list = days.get(event.date);
    if (list) list.push(event);
    else days.set(event.date, [event]);
  }
  return days;
}

/** A partir de cuántos eventos de un día se avisa. */
export const HINT_THRESHOLDS = { collections: 3, deadlines: 3, busy: 8 } as const;

/** Duración con la que se comparan las reuniones y las llamadas (no se guarda ninguna). */
export const DEFAULT_DURATION_MINUTES: Record<string, number> = { call: 30, meeting: 60 };

export type DayHint =
  /** Muchos cobros el mismo día: concentración de caja. */
  | { kind: "collections"; count: number; amountCents: Cents }
  /** Muchos plazos fiscales el mismo día (los días 20). */
  | { kind: "deadlines"; count: number }
  /** Reuniones o llamadas del mismo socio que se pisan. */
  | { kind: "overlap"; count: number }
  /** Día cargado en general. */
  | { kind: "busy"; count: number };

/** Minutos que dura un evento con hora (si no tiene, 0). */
function durationOf(event: CalendarEvent): number {
  return event.startsAt ? (DEFAULT_DURATION_MINUTES[event.kind ?? ""] ?? 30) : 0;
}

/** Reuniones y llamadas que se pisan con otra del mismo socio (con las duraciones por defecto). */
export function overlappingEvents(events: readonly CalendarEvent[]): CalendarEvent[] {
  const timed = events
    .filter((event) => event.startsAt !== null)
    .map((event) => {
      const start = Date.parse(event.startsAt!);
      return { event, start, end: start + durationOf(event) * 60_000 };
    })
    .sort((a, b) => a.start - b.start);
  const clashing = new Set<CalendarEvent>();
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length && timed[j]!.start < timed[i]!.end; j++) {
      if (timed[i]!.event.ownerMemberId === timed[j]!.event.ownerMemberId) {
        clashing.add(timed[i]!.event);
        clashing.add(timed[j]!.event);
      }
    }
  }
  return timed.map((t) => t.event).filter((event) => clashing.has(event));
}

/** Avisos de un día (sus eventos, ya filtrados): lo que conviene ver antes de que llegue. */
export function dayHints(events: readonly CalendarEvent[], thresholds: { collections: number; deadlines: number; busy: number } = HINT_THRESHOLDS): DayHint[] {
  const hints: DayHint[] = [];
  const collections = events.filter((event) => event.type === "collection");
  if (collections.length >= thresholds.collections) {
    hints.push({ kind: "collections", count: collections.length, amountCents: collections.reduce((sum, e) => sum + (e.amountCents ?? 0), 0) });
  }
  const deadlines = events.filter((event) => event.type === "fiscal" && event.kind !== "verifactu");
  if (deadlines.length >= thresholds.deadlines) hints.push({ kind: "deadlines", count: deadlines.length });
  const overlapping = overlappingEvents(events);
  if (overlapping.length > 0) hints.push({ kind: "overlap", count: overlapping.length });
  if (events.length >= thresholds.busy) hints.push({ kind: "busy", count: events.length });
  return hints;
}

export type CollectionTotals = {
  /** Lo que vence en el rango y aún no ha vencido (con IVA, neto de IRPF). */
  expectedCents: Cents;
  expectedCount: number;
  overdueCents: Cents;
  overdueCount: number;
};

/** Cobros previstos y vencidos de una lista de eventos. */
export function collectionTotals(events: readonly CalendarEvent[]): CollectionTotals {
  const totals: CollectionTotals = { expectedCents: 0, expectedCount: 0, overdueCents: 0, overdueCount: 0 };
  for (const event of events) {
    if (event.type !== "collection") continue;
    if (event.status === "overdue") {
      totals.overdueCents += event.amountCents ?? 0;
      totals.overdueCount += 1;
    } else {
      totals.expectedCents += event.amountCents ?? 0;
      totals.expectedCount += 1;
    }
  }
  return totals;
}

/** Si un evento pide que alguien haga algo (lo que se enseña como "atrasado" antes del rango). */
export function isActionable(event: CalendarEvent): boolean {
  return event.status === "overdue" || event.status === "pending";
}
