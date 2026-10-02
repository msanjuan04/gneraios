"use client";

import { CalendarCheck2, Clock3 } from "lucide-react";
import { type ReactNode, useRef } from "react";
import { useHotkeys } from "@/components/app-shell/use-hotkeys";
import { type CalendarEvent, dayHints } from "@/domain/calendar";
import { addDays, type CivilDate } from "@/domain/dates/civil-date";
import { cn } from "@/lib/utils";
import { DayHintsBadge } from "./day-hints";
import { EventIcon } from "./event-icon";
import { eventColor, STATUS_BADGE } from "./event-style";
import { formatDay } from "./format";
import { useCalendarText } from "./use-calendar-text";

export type AgendaMember = { id: string; fullName: string; initials: string };

type AgendaProps = {
  today: CivilDate;
  /** Días del rango con eventos, en orden. */
  days: { date: CivilDate; events: CalendarEvent[] }[];
  /** Lo de antes del rango que aún pide algo. */
  overdue: CalendarEvent[];
  members: ReadonlyMap<string, AgendaMember>;
  onOpenEvent: (event: CalendarEvent) => void;
  /** Sin eventos: qué enseñar (lo decide quien sabe si hay filtros puestos). */
  empty: ReactNode;
  /** Atajos desactivados (con un panel abierto). */
  hotkeysDisabled?: boolean;
};

/** Lista por días (con lo atrasado arriba): la vista por defecto en el móvil. j/k para moverse. */
export function AgendaList({ today, days, overdue, members, onOpenEvent, empty, hotkeysDisabled }: AgendaProps) {
  const text = useCalendarText();
  const listRef = useRef<HTMLDivElement>(null);

  function move(direction: 1 | -1) {
    const rows = [...(listRef.current?.querySelectorAll<HTMLButtonElement>("[data-agenda-row]") ?? [])];
    if (rows.length === 0) return;
    const index = rows.findIndex((row) => row === document.activeElement);
    const next = rows[index === -1 ? (direction === 1 ? 0 : rows.length - 1) : Math.min(rows.length - 1, Math.max(0, index + direction))];
    next?.focus();
    next?.scrollIntoView({ block: "nearest" });
  }

  useHotkeys({
    j: () => !hotkeysDisabled && move(1),
    k: () => !hotkeysDisabled && move(-1),
  });

  if (days.length === 0 && overdue.length === 0) return <>{empty}</>;

  const dayTitle = (date: CivilDate) => {
    const long = formatDay(date, text.locale, { weekday: "long", day: "numeric", month: "long" });
    if (date === today) return text.t("agenda.today", { date: long });
    if (date === addDays(today, 1)) return text.t("agenda.tomorrow", { date: long });
    return long;
  };

  return (
    <div ref={listRef} className="space-y-6">
      {overdue.length > 0 && (
        <section aria-labelledby="agenda-overdue">
          <h3 id="agenda-overdue" className="mb-2 flex items-center gap-2 text-sm font-bold text-destructive">
            <Clock3 aria-hidden className="size-4" />
            {text.t("agenda.overdue", { count: overdue.length })}
          </h3>
          <ul className="divide-y overflow-hidden rounded-2xl border border-destructive/25 bg-card">
            {overdue.map((event) => (
              <li key={event.id}>
                <AgendaRow event={event} members={members} onOpen={onOpenEvent} showDate />
              </li>
            ))}
          </ul>
        </section>
      )}

      {days.map(({ date, events }) => (
        <section key={date} aria-labelledby={`agenda-${date}`}>
          <h3
            id={`agenda-${date}`}
            className={cn(
              "sticky top-12 z-10 -mx-1 mb-2 flex items-center gap-2 rounded-lg px-1 py-1 text-sm font-bold glass",
              date === today && "text-primary",
            )}
          >
            <span className="first-letter:uppercase">{dayTitle(date)}</span>
            <DayHintsBadge hints={dayHints(events)} />
          </h3>
          <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
            {events.map((event) => (
              <li key={event.id}>
                <AgendaRow event={event} members={members} onOpen={onOpenEvent} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function AgendaRow({
  event,
  members,
  onOpen,
  showDate,
}: {
  event: CalendarEvent;
  members: ReadonlyMap<string, AgendaMember>;
  onOpen: (event: CalendarEvent) => void;
  showDate?: boolean;
}) {
  const text = useCalendarText();
  const detail = text.detail(event);
  const amount = text.amount(event);
  const owner = event.ownerMemberId ? members.get(event.ownerMemberId) : undefined;
  const quiet = event.status === "done" || event.status === "past";

  return (
    <button
      type="button"
      data-agenda-row=""
      onClick={() => onOpen(event)}
      className={cn(
        "flex w-full items-center gap-3 px-3 py-2.5 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset",
        quiet && "text-muted-foreground",
      )}
    >
      <span className="w-14 shrink-0 text-xs font-semibold tabular text-muted-foreground">
        {showDate ? formatDay(event.date, text.locale, { day: "numeric", month: "short" }).replace(".", "") : (event.time ?? text.t("agenda.allDay"))}
      </span>
      <span
        aria-hidden
        className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted"
        style={{ color: eventColor(event) }}
      >
        <EventIcon event={event} className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-sm font-semibold", event.status === "overdue" && "text-destructive", quiet && "font-medium")}>
          {text.summary(event)}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {[text.t(`types.${event.type}`), detail].filter(Boolean).join(" · ")}
        </span>
      </span>
      {amount && <span className="shrink-0 text-sm font-semibold tabular">{amount}</span>}
      <span className={cn("hidden shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold sm:inline", STATUS_BADGE[event.status])}>
        {event.status === "done" && <CalendarCheck2 aria-hidden className="mr-1 inline size-3 align-[-2px]" />}
        {text.t(`status.${event.status}`)}
      </span>
      <span
        title={owner?.fullName ?? text.t("sheet.shared")}
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
          owner ? "bg-brand-gradient text-white" : "border border-dashed text-muted-foreground",
        )}
      >
        {owner?.initials ?? "·"}
      </span>
    </button>
  );
}
