"use client";

import { DndContext, type DragEndEvent, DragOverlay, type DragStartEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { CalendarDays, Clock3, Rss } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useOptimistic, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { useHotkeys } from "@/components/app-shell/use-hotkeys";
import { Button } from "@/components/ui/button";
import {
  CALENDAR_EVENT_TYPES,
  type CalendarEvent,
  type CalendarEventType,
  type CalendarState,
  type CalendarView as ViewName,
  calendarSearch,
  collectionTotals,
  DEFAULT_EVENT_TYPES,
  type DateRange,
  filterEvents,
  groupByDay,
  inRange,
  moveEvent,
  shiftAnchor,
} from "@/domain/calendar";
import type { CivilDate } from "@/domain/dates/civil-date";
import type { ActionResult } from "@/lib/action-result";
import { cn } from "@/lib/utils";
import { rescheduleDealAction, rescheduleMilestoneAction, rescheduleTaskAction } from "@/server/calendar/actions";
import type { MemberFeed } from "@/server/calendar/feeds";
import { AgendaList, type AgendaMember } from "./agenda-list";
import { CalendarToolbar } from "./calendar-toolbar";
import { EventChip } from "./event-chip";
import { CalendarSheet, type SheetState } from "./event-sheet";
import { MonthGrid } from "./month-grid";
import { SubscribeDialog } from "./subscribe-dialog";
import { CalendarMoneyContext, type MoneyFormat, useCalendarText } from "./use-calendar-text";
import { WeekView } from "./week-view";

export type CalendarViewProps = {
  slug: string;
  basePath: string;
  today: CivilDate;
  /** Estado de la URL (vista, fecha, filtros). */
  state: CalendarState;
  /** La vista por defecto del dispositivo (agenda en el móvil). */
  defaultView: ViewName;
  range: DateRange;
  /** Todo lo del rango (todos los tipos) y, si el rango incluye hoy, lo atrasado de antes. */
  events: CalendarEvent[];
  members: AgendaMember[];
  currentMemberId: string;
  /** Partner u owner: puede mover fechas. */
  canMove: boolean;
  money: MoneyFormat;
  feed: MemberFeed | null;
  localAppUrl: boolean;
};

type Move = { event: CalendarEvent; date: CivilDate };

/** La acción que mueve la fecha de cada tipo movible, en su única fuente (source.id). */
const RESCHEDULE: Partial<Record<CalendarEventType, (slug: string, sourceId: string, date: string) => Promise<ActionResult>>> = {
  deal: rescheduleDealAction,
  milestone: rescheduleMilestoneAction,
  task: rescheduleTaskAction,
};

export function CalendarView(props: CalendarViewProps) {
  return (
    <CalendarMoneyContext.Provider value={props.money}>
      <CalendarScreen {...props} />
    </CalendarMoneyContext.Provider>
  );
}

function CalendarScreen(props: CalendarViewProps) {
  const { slug, today, range, state, canMove } = props;
  const text = useCalendarText();
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startNavigation] = useTransition();
  const [, startMove] = useTransition();
  const [filters, setFilters] = useState({ types: state.types, mine: state.mine });
  const [events, applyMove] = useOptimistic(props.events, (current: CalendarEvent[], move: Move) =>
    current.map((event) => (event.id === move.event.id ? moveEvent(event, move.date, today) : event)),
  );
  const [sheet, setSheet] = useState<SheetState>(null);
  const [subscribeOpen, setSubscribeOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  const members = useMemo(() => new Map(props.members.map((m) => [m.id, m])), [props.members]);
  const memberFilter = filters.mine ? props.currentMemberId : null;
  const ofMember = useMemo(() => filterEvents(events, { types: CALENDAR_EVENT_TYPES, memberId: memberFilter }), [events, memberFilter]);
  const visible = useMemo(() => filterEvents(ofMember, { types: filters.types, memberId: null }), [ofMember, filters.types]);
  const inView = visible.filter((event) => inRange(event.date, range));
  const overdue = visible.filter((event) => event.date < range.from);
  const byDay = groupByDay(inView);
  const counts: Partial<Record<CalendarEventType, number>> = {};
  for (const event of ofMember) if (inRange(event.date, range)) counts[event.type] = (counts[event.type] ?? 0) + 1;

  const current: CalendarState = { view: state.view, date: state.date, ...filters };
  const filtersAreDefault =
    !filters.mine && filters.types.length === DEFAULT_EVENT_TYPES.length && DEFAULT_EVENT_TYPES.every((t) => filters.types.includes(t));

  function navigate(next: Partial<CalendarState>) {
    const href = `${pathname}${calendarSearch({ ...current, ...next }, today, props.defaultView)}`;
    startNavigation(() => router.push(href, { scroll: false }));
  }

  /** Los filtros solo cambian lo que se ve: la URL se actualiza sin volver a cargar. */
  function updateFilters(next: { types: CalendarEventType[]; mine: boolean }) {
    setFilters(next);
    window.history.replaceState(null, "", `${pathname}${calendarSearch({ ...current, ...next }, today, props.defaultView)}`);
  }

  function toggleType(type: CalendarEventType) {
    const types = filters.types.includes(type) ? filters.types.filter((t) => t !== type) : [...filters.types, type];
    updateFilters({ ...filters, types });
  }

  function commitMove(event: CalendarEvent, date: CivilDate) {
    const reschedule = RESCHEDULE[event.type];
    if (!reschedule) return;
    const from = event.date;
    startMove(async () => {
      applyMove({ event, date });
      const result = await reschedule(slug, event.source.id, date);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const autoNow = event.type === "milestone" && event.kind === "auto" && date <= today;
      toast.success(text.t("move.done", { summary: text.summary(event), date: text.longDate(date) }), {
        description: autoNow ? text.t("move.autoMilestone") : undefined,
        action: { label: text.t("move.undo"), onClick: () => commitMove({ ...event, date }, from) },
      });
    });
  }

  const sensors = useSensors(
    // Un clic abre el evento; arrastrar empieza a partir de 6 px.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const event = events.find((candidate) => candidate.id === e.active.id);
    const date = e.over ? String(e.over.id) : null;
    if (!event || !date || !canMove || !event.movable || date === event.date) return;
    commitMove(event, date);
  }

  // Atajos: t hoy, ←/→ anterior/siguiente, m/w/a vistas. No con un panel abierto ni arrastrando,
  // ni justo después de "g" (g a, g d… son de navegación global).
  const lastG = useRef(0);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "g") lastG.current = Date.now();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  // Un panel de un evento que ya no está (filtrado o borrado) cuenta como cerrado.
  const sheetOpen = sheet !== null && (sheet.kind === "day" || events.some((e) => e.id === sheet.eventId));
  const blocked = () => sheetOpen || subscribeOpen || activeId !== null || Date.now() - lastG.current < 1000;
  useHotkeys({
    t: () => !blocked() && navigate({ date: today }),
    ArrowLeft: () => !blocked() && navigate({ date: shiftAnchor(state.view, state.date, -1) }),
    ArrowRight: () => !blocked() && navigate({ date: shiftAnchor(state.view, state.date, 1) }),
    m: () => !blocked() && navigate({ view: "month" }),
    w: () => !blocked() && navigate({ view: "week" }),
    a: () => !blocked() && navigate({ view: "agenda" }),
  });

  const openEvent = (event: CalendarEvent) => setSheet({ kind: "event", eventId: event.id, fromDay: null });
  const openDay = (date: CivilDate) => setSheet({ kind: "day", date });
  const activeEvent = activeId ? events.find((e) => e.id === activeId) : undefined;
  const nothingAtAll = inView.length === 0 && overdue.length === 0;

  const empty = (
    <EmptyCalendar
      filtered={!filtersAreDefault}
      onReset={() => updateFilters({ types: [...DEFAULT_EVENT_TYPES], mine: false })}
      onSubscribe={() => setSubscribeOpen(true)}
    />
  );

  return (
    <div className="mx-auto max-w-[96rem] space-y-4">
      <CalendarToolbar
        view={state.view}
        anchor={state.date}
        range={range}
        types={filters.types}
        mine={filters.mine}
        counts={counts}
        collections={collectionTotals(inView)}
        isPending={isPending}
        onToday={() => navigate({ date: today })}
        onShift={(direction) => navigate({ date: shiftAnchor(state.view, state.date, direction) })}
        onView={(view) => navigate({ view })}
        onToggleType={toggleType}
        onToggleMine={() => updateFilters({ ...filters, mine: !filters.mine })}
        onResetFilters={filtersAreDefault ? null : () => updateFilters({ types: [...DEFAULT_EVENT_TYPES], mine: false })}
        onSubscribe={() => setSubscribeOpen(true)}
      />

      {state.view !== "agenda" && overdue.length > 0 && (
        <button
          type="button"
          onClick={() => navigate({ view: "agenda", date: today })}
          className="flex w-full items-center gap-2 rounded-xl border border-destructive/25 bg-destructive/8 px-3 py-2 text-left text-sm text-destructive outline-none transition-colors hover:bg-destructive/12 focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          <Clock3 aria-hidden className="size-4 shrink-0" />
          <span className="font-semibold">{text.t("overdueBanner.title", { count: overdue.length })}</span>
          <span className="hidden text-destructive/80 sm:inline">{text.t("overdueBanner.body")}</span>
          <span className="ml-auto font-semibold">{text.t("overdueBanner.action")}</span>
        </button>
      )}

      <div aria-busy={isPending || undefined} className={cn("transition-opacity duration-200", isPending && "opacity-60")}>
        {state.view === "agenda" ? (
          <AgendaList
            today={today}
            days={[...byDay.entries()].map(([date, dayEvents]) => ({ date, events: dayEvents }))}
            overdue={overdue}
            members={members}
            onOpenEvent={openEvent}
            empty={empty}
            hotkeysDisabled={sheetOpen || subscribeOpen}
          />
        ) : (
          <DndContext id="calendar" sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
            {state.view === "month" ? (
              <MonthGrid anchor={state.date} today={today} byDay={byDay} canMove={canMove} onOpenEvent={openEvent} onOpenDay={openDay} />
            ) : (
              <WeekView anchor={state.date} today={today} byDay={byDay} canMove={canMove} onOpenEvent={openEvent} onOpenDay={openDay} />
            )}
            <DragOverlay dropAnimation={null}>
              {activeEvent ? <EventChip event={activeEvent} onOpen={() => {}} overlay className="w-56" /> : null}
            </DragOverlay>
          </DndContext>
        )}
        {state.view !== "agenda" && nothingAtAll && <div className="mt-4">{empty}</div>}
      </div>

      {canMove && state.view !== "agenda" && (
        <p className="text-xs text-muted-foreground">{text.t("move.hint")}</p>
      )}

      <CalendarSheet
        state={sheet}
        onStateChange={setSheet}
        events={events}
        dayEvents={(date) => byDay.get(date) ?? []}
        members={members}
        basePath={props.basePath}
        canMove={canMove}
        onMove={commitMove}
      />
      <SubscribeDialog open={subscribeOpen} onOpenChange={setSubscribeOpen} slug={slug} feed={props.feed} localAppUrl={props.localAppUrl} />
    </div>
  );
}

function EmptyCalendar({ filtered, onReset, onSubscribe }: { filtered: boolean; onReset: () => void; onSubscribe: () => void }) {
  const text = useCalendarText();
  return (
    <div className="mx-auto max-w-lg rounded-3xl border bg-card/50 px-8 py-12 text-center">
      <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-brand-gradient text-white shadow-[0_10px_40px_rgb(46_128_255/0.35)]">
        <CalendarDays className="size-6" />
      </div>
      <h2 className="mt-6 text-2xl font-extrabold heading-tight">{text.t(filtered ? "empty.filteredTitle" : "empty.title")}</h2>
      <p className="mt-3 text-muted-foreground">{text.t(filtered ? "empty.filteredBody" : "empty.body")}</p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        {filtered && (
          <Button variant="secondary" onClick={onReset}>
            {text.t("toolbar.reset")}
          </Button>
        )}
        <Button variant={filtered ? "outline" : "default"} onClick={onSubscribe}>
          <Rss data-icon="inline-start" />
          {text.t("toolbar.subscribe")}
        </Button>
      </div>
      <p className="mt-4 text-xs text-muted-foreground">{text.t("empty.shortcuts")}</p>
    </div>
  );
}
