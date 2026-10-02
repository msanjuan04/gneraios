"use client";

import { ChevronLeft, ChevronRight, Plus, Rss, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CALENDAR_EVENT_TYPES, CALENDAR_VIEWS, type CalendarEventType, type CalendarView, type CollectionTotals, type DateRange } from "@/domain/calendar";
import type { CivilDate } from "@/domain/dates/civil-date";
import { cn } from "@/lib/utils";
import { TYPE_COLORS, TYPE_ICONS } from "./event-style";
import { formatDay, formatDayRange } from "./format";
import { useCalendarText } from "./use-calendar-text";

const VIEW_KEYS: Record<CalendarView, string> = { month: "M", week: "W", agenda: "A" };

type Props = {
  view: CalendarView;
  anchor: CivilDate;
  range: DateRange;
  types: readonly CalendarEventType[];
  mine: boolean;
  /** Eventos del rango por tipo (antes de filtrar por tipo): el número de cada filtro. */
  counts: Partial<Record<CalendarEventType, number>>;
  collections: CollectionTotals;
  isPending: boolean;
  onToday: () => void;
  onShift: (direction: -1 | 1) => void;
  onView: (view: CalendarView) => void;
  onToggleType: (type: CalendarEventType) => void;
  onToggleMine: () => void;
  onResetFilters: (() => void) | null;
  onSubscribe: () => void;
  onCreate: () => void;
  canCreate: boolean;
};

/** Cabecera del calendario: periodo, hoy, anterior/siguiente, vista, filtros por tipo y "solo lo mío". */
export function CalendarToolbar(props: Props) {
  const text = useCalendarText();
  const { view, anchor, range } = props;

  const title =
    view === "month"
      ? formatDay(anchor, text.locale, { month: "long", year: "numeric" })
      : formatDayRange(range.from, range.to, text.locale, { day: "numeric", month: "short", year: "numeric" });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 aria-live="polite" className={cn("min-w-0 text-2xl font-extrabold heading-tight first-letter:uppercase md:text-3xl", props.isPending && "opacity-60")}>
          {title}
        </h2>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="sm" onClick={props.onToday}>
                {text.t("toolbar.today")}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {text.t("toolbar.todayHint")} <Kbd>T</Kbd>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={() => props.onShift(-1)} aria-label={text.t(`toolbar.previous.${view}`)}>
                <ChevronLeft />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {text.t(`toolbar.previous.${view}`)} <Kbd>←</Kbd>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={() => props.onShift(1)} aria-label={text.t(`toolbar.next.${view}`)}>
                <ChevronRight />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {text.t(`toolbar.next.${view}`)} <Kbd>→</Kbd>
            </TooltipContent>
          </Tooltip>
        </div>

        <div role="group" aria-label={text.t("toolbar.views")} className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-full border bg-card/60 p-1 [scrollbar-width:none]">
          {CALENDAR_VIEWS.map((option) => (
            <Tooltip key={option}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-pressed={option === view}
                  onClick={() => props.onView(option)}
                  className={cn(
                    "rounded-full px-3 py-0.5 text-sm font-semibold whitespace-nowrap outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                    option === view ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {text.t(`views.${option}`)}
                </button>
              </TooltipTrigger>
              <TooltipContent>
                {text.t(`views.${option}`)} <Kbd>{VIEW_KEYS[option]}</Kbd>
              </TooltipContent>
            </Tooltip>
          ))}
        </div>

        {props.canCreate && <Button size="sm" className="ml-auto" onClick={props.onCreate}><Plus data-icon="inline-start" />{text.t("toolbar.newEvent")}</Button>}
        <Button variant="outline" size="sm" className={props.canCreate ? "" : "ml-auto"} onClick={props.onSubscribe}>
          <Rss data-icon="inline-start" />
          {text.t("toolbar.subscribe")}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div role="group" aria-label={text.t("toolbar.filters")} className="-mx-1 flex max-w-full gap-1 overflow-x-auto px-1 pb-0.5 sm:flex-wrap sm:overflow-visible">
          <button
            type="button"
            aria-pressed={props.mine}
            onClick={props.onToggleMine}
            title={text.t("toolbar.mineHint")}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60",
              props.mine ? "border-primary/60 bg-primary/12 text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <UserRound aria-hidden className="size-3.5" />
            {text.t("toolbar.mine")}
          </button>
          <span aria-hidden className="mx-1 w-px shrink-0 self-stretch bg-border" />
          {CALENDAR_EVENT_TYPES.map((type) => {
            const Icon = TYPE_ICONS[type];
            const active = props.types.includes(type);
            const count = props.counts[type] ?? 0;
            return (
              <button
                key={type}
                type="button"
                aria-pressed={active}
                onClick={() => props.onToggleType(type)}
                title={text.t(`typeHints.${type}`)}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60",
                  active ? "bg-secondary text-foreground" : "border-dashed text-muted-foreground/80 hover:text-foreground",
                )}
              >
                <Icon aria-hidden className="size-3.5" style={{ color: active ? TYPE_COLORS[type] : undefined }} />
                {text.t(`types.${type}`)}
                {count > 0 && <span className="tabular text-muted-foreground">{count}</span>}
              </button>
            );
          })}
          {props.onResetFilters && (
            <button
              type="button"
              onClick={props.onResetFilters}
              className="shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              {text.t("toolbar.reset")}
            </button>
          )}
        </div>

        {(props.collections.expectedCount > 0 || props.collections.overdueCount > 0) && (
          <p className="text-xs text-muted-foreground tabular lg:ml-auto">
            {props.collections.expectedCount > 0 &&
              text.t("toolbar.expected", { amount: text.money(props.collections.expectedCents), count: props.collections.expectedCount })}
            {props.collections.expectedCount > 0 && props.collections.overdueCount > 0 && " · "}
            {props.collections.overdueCount > 0 && (
              <span className="font-semibold text-destructive">
                {text.t("toolbar.overdue", { amount: text.money(props.collections.overdueCents), count: props.collections.overdueCount })}
              </span>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
