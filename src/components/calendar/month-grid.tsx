"use client";

import { useDroppable } from "@dnd-kit/core";
import { type CalendarEvent, dayHints, monthWeeks } from "@/domain/calendar";
import type { CivilDate } from "@/domain/dates/civil-date";
import { cn } from "@/lib/utils";
import { DayHintsBadge } from "./day-hints";
import { DraggableChip, EventChip } from "./event-chip";
import { eventColor } from "./event-style";
import { formatDay } from "./format";
import { useCalendarText } from "./use-calendar-text";

/** Chips visibles por día; el resto, en "+N más" (abre el día). */
const MAX_CHIPS = 3;

export type GridProps = {
  anchor: CivilDate;
  today: CivilDate;
  byDay: ReadonlyMap<CivilDate, CalendarEvent[]>;
  /** Si el socio puede mover (partner u owner). */
  canMove: boolean;
  onOpenEvent: (event: CalendarEvent) => void;
  onOpenDay: (date: CivilDate) => void;
};

/** Mes en semanas de lunes a domingo. En el móvil, puntos por día (el detalle, al tocarlo). */
export function MonthGrid({ anchor, today, byDay, canMove, onOpenEvent, onOpenDay }: GridProps) {
  const text = useCalendarText();
  const weeks = monthWeeks(anchor);
  const month = anchor.slice(0, 7);
  const weekdays = weeks[0]!.map((day) => formatDay(day, text.locale, { weekday: "short" }).replace(".", ""));

  return (
    <div role="table" aria-label={formatDay(anchor, text.locale, { month: "long", year: "numeric" })} className="overflow-hidden rounded-2xl border bg-card">
      <div role="row" className="grid grid-cols-7 border-b bg-muted/30">
        {weekdays.map((weekday) => (
          <div key={weekday} role="columnheader" className="px-2 py-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
            {weekday}
          </div>
        ))}
      </div>
      {weeks.map((week) => (
        <div key={week[0]} role="row" className="grid grid-cols-7 border-b last:border-b-0">
          {week.map((date) => (
            <DayCell
              key={date}
              date={date}
              inMonth={date.startsWith(month)}
              isToday={date === today}
              events={byDay.get(date) ?? []}
              canMove={canMove}
              onOpenEvent={onOpenEvent}
              onOpenDay={onOpenDay}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function DayCell({
  date,
  inMonth,
  isToday,
  events,
  canMove,
  onOpenEvent,
  onOpenDay,
}: {
  date: CivilDate;
  inMonth: boolean;
  isToday: boolean;
  events: CalendarEvent[];
  canMove: boolean;
  onOpenEvent: (event: CalendarEvent) => void;
  onOpenDay: (date: CivilDate) => void;
}) {
  const text = useCalendarText();
  const { setNodeRef, isOver } = useDroppable({ id: date, disabled: !canMove });
  const visible = events.slice(0, MAX_CHIPS);
  const hidden = events.length - visible.length;
  const longDate = text.longDate(date);

  return (
    <div
      ref={setNodeRef}
      role="cell"
      aria-label={longDate}
      className={cn(
        "flex min-h-16 min-w-0 flex-col gap-0.5 border-r p-1 transition-colors last:border-r-0 sm:min-h-32",
        !inMonth && "bg-muted/25",
        isOver && "bg-primary/10 ring-2 ring-primary/50 ring-inset",
      )}
    >
      <div className="flex items-center justify-between gap-1 px-0.5">
        <button
          type="button"
          onClick={() => onOpenDay(date)}
          aria-label={text.t("month.openDay", { date: longDate, count: events.length })}
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60",
            isToday ? "bg-brand-gradient text-white" : inMonth ? "hover:bg-muted" : "text-muted-foreground/60 hover:bg-muted",
          )}
        >
          {Number(date.slice(8, 10))}
        </button>
        <DayHintsBadge hints={dayHints(events)} />
      </div>

      <div className="hidden min-w-0 flex-col gap-0.5 sm:flex">
        {visible.map((event) =>
          event.movable && canMove ? (
            <DraggableChip key={event.id} event={event} onOpen={onOpenEvent} disabled={false} hideAmount={false} />
          ) : (
            <EventChip key={event.id} event={event} onOpen={onOpenEvent} />
          ),
        )}
        {hidden > 0 && (
          <button
            type="button"
            onClick={() => onOpenDay(date)}
            className="rounded-md px-1.5 text-left text-[11px] font-semibold text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            {text.t("month.more", { count: hidden })}
          </button>
        )}
      </div>

      {events.length > 0 && (
        <button
          type="button"
          onClick={() => onOpenDay(date)}
          aria-label={text.t("month.openDay", { date: longDate, count: events.length })}
          className="flex flex-wrap gap-1 px-1 pt-0.5 sm:hidden"
        >
          {events.slice(0, 6).map((event) => (
            <span
              key={event.id}
              aria-hidden
              className="size-1.5 rounded-full"
              style={{ background: eventColor(event) }}
            />
          ))}
        </button>
      )}
    </div>
  );
}
