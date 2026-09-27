"use client";

import { useDroppable } from "@dnd-kit/core";
import { type CalendarEvent, dayHints, eachDay, viewRange } from "@/domain/calendar";
import type { CivilDate } from "@/domain/dates/civil-date";
import { cn } from "@/lib/utils";
import { DayHintsBadge } from "./day-hints";
import { DraggableChip, EventChip } from "./event-chip";
import type { GridProps } from "./month-grid";
import { formatDay } from "./format";
import { useCalendarText } from "./use-calendar-text";

/**
 * La semana de lunes a domingo, con todo lo de cada día (sin límite). Casi todo es de día entero;
 * lo que tiene hora (reuniones y llamadas) va detrás, por su hora. En el móvil, un día debajo de otro.
 */
export function WeekView({ anchor, today, byDay, canMove, onOpenEvent, onOpenDay }: GridProps) {
  const days = eachDay(viewRange("week", anchor));
  return (
    <div className="grid gap-2 md:grid-cols-7">
      {days.map((date) => (
        <WeekDay
          key={date}
          date={date}
          isToday={date === today}
          events={byDay.get(date) ?? []}
          canMove={canMove}
          onOpenEvent={onOpenEvent}
          onOpenDay={onOpenDay}
        />
      ))}
    </div>
  );
}

function WeekDay({
  date,
  isToday,
  events,
  canMove,
  onOpenEvent,
  onOpenDay,
}: {
  date: CivilDate;
  isToday: boolean;
  events: CalendarEvent[];
  canMove: boolean;
  onOpenEvent: (event: CalendarEvent) => void;
  onOpenDay: (date: CivilDate) => void;
}) {
  const text = useCalendarText();
  const { setNodeRef, isOver } = useDroppable({ id: date, disabled: !canMove });
  const longDate = text.longDate(date);

  return (
    <section
      ref={setNodeRef}
      aria-label={longDate}
      className={cn(
        "flex min-w-0 flex-col rounded-2xl border bg-card transition-colors md:min-h-[26rem]",
        isToday && "border-primary/50",
        isOver && "bg-primary/10 ring-2 ring-primary/50",
      )}
    >
      <header className="flex items-center justify-between gap-2 border-b px-2.5 py-2">
        <button
          type="button"
          onClick={() => onOpenDay(date)}
          aria-label={text.t("month.openDay", { date: longDate, count: events.length })}
          className="flex min-w-0 items-baseline gap-1.5 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
            {formatDay(date, text.locale, { weekday: "short" }).replace(".", "")}
          </span>
          <span
            className={cn(
              "flex size-6 items-center justify-center rounded-full text-sm font-bold tabular",
              isToday && "bg-brand-gradient text-white",
            )}
          >
            {Number(date.slice(8, 10))}
          </span>
        </button>
        <DayHintsBadge hints={dayHints(events)} />
      </header>
      <div className="flex min-h-12 flex-1 flex-col gap-0.5 p-1">
        {events.map((event) =>
          event.movable && canMove ? (
            <DraggableChip key={event.id} event={event} onOpen={onOpenEvent} disabled={false} />
          ) : (
            <EventChip key={event.id} event={event} onOpen={onOpenEvent} />
          ),
        )}
        {events.length === 0 && <p className="m-auto py-3 text-xs text-muted-foreground/60">{text.t("week.empty")}</p>}
      </div>
    </section>
  );
}
