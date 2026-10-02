"use client";

import { ArrowLeft, ArrowRight, CalendarX2, ExternalLink, Info, Landmark, Move, Pencil, Plus } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useState } from "react";
import { SettingsSheet } from "@/components/settings/settings-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type CalendarEvent, dayHints } from "@/domain/calendar";
import type { CivilDate } from "@/domain/dates/civil-date";
import { cn } from "@/lib/utils";
import type { AgendaMember } from "./agenda-list";
import { DayHintsList } from "./day-hints";
import { EventChip } from "./event-chip";
import { EventIcon } from "./event-icon";
import { eventColor, STATUS_BADGE } from "./event-style";
import { useCalendarText } from "./use-calendar-text";

export type SheetState = { kind: "event"; eventId: string; fromDay: CivilDate | null } | { kind: "day"; date: CivilDate } | null;

type Props = {
  state: SheetState;
  onStateChange: (state: SheetState) => void;
  /** Todos los eventos cargados (con los movimientos optimistas). */
  events: readonly CalendarEvent[];
  /** Los eventos visibles de un día (ya filtrados). */
  dayEvents: (date: CivilDate) => CalendarEvent[];
  members: ReadonlyMap<string, AgendaMember>;
  basePath: string;
  canMove: boolean;
  /** Quien mira: solo edita sus propias citas (el calendario es compartido). */
  currentMemberId: string | null;
  onMove: (event: CalendarEvent, date: CivilDate) => void;
  onEditAppointment: (event: CalendarEvent) => void;
  onAddAppointment: (date: CivilDate) => void;
};

/** Panel lateral del calendario: el detalle de un evento o todo lo de un día. Nunca un modal encima de otro. */
export function CalendarSheet({ state, onStateChange, events, dayEvents, members, basePath, canMove, currentMemberId, onMove, onEditAppointment, onAddAppointment }: Props) {
  const text = useCalendarText();
  const event = state?.kind === "event" ? events.find((e) => e.id === state.eventId) ?? null : null;
  const open = state !== null && (state.kind === "day" || event !== null);
  const close = () => onStateChange(null);

  const title =
    state?.kind === "day" ? (
      <span className="first-letter:uppercase">{text.longDate(state.date)}</span>
    ) : event ? (
      <EventTitle event={event} />
    ) : null;

  return (
    <SettingsSheet open={open} onOpenChange={(next) => !next && close()} title={title}>
      {state?.kind === "day" && (
        <DayContent
          date={state.date}
          events={dayEvents(state.date)}
          onOpenEvent={(e) => onStateChange({ kind: "event", eventId: e.id, fromDay: state.date })}
          onAdd={canMove ? () => { onStateChange(null); onAddAppointment(state.date); } : null}
        />
      )}
      {state?.kind === "event" && event && (
        <EventContent
          key={event.id}
          event={event}
          members={members}
          basePath={basePath}
          canMove={canMove}
          currentMemberId={currentMemberId}
          onMove={onMove}
          onBack={state.fromDay ? () => onStateChange({ kind: "day", date: state.fromDay! }) : null}
          onNavigate={close}
          onEditAppointment={() => { close(); onEditAppointment(event); }}
        />
      )}
    </SettingsSheet>
  );
}

function EventTitle({ event }: { event: CalendarEvent }) {
  const text = useCalendarText();
  return (
    <span className="flex items-start gap-2.5">
      <span
        aria-hidden
        className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted"
        style={{ color: eventColor(event) }}
      >
        <EventIcon event={event} className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-semibold text-muted-foreground">{text.t(`types.${event.type}`)}</span>
        <span className="block leading-snug">{text.summary(event)}</span>
      </span>
    </span>
  );
}

function DayContent({ date, events, onOpenEvent, onAdd }: { date: CivilDate; events: CalendarEvent[]; onOpenEvent: (event: CalendarEvent) => void; onAdd: (() => void) | null }) {
  const text = useCalendarText();
  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
      <DayHintsList hints={dayHints(events)} />
      {onAdd && <Button size="sm" onClick={onAdd}><Plus data-icon="inline-start" />{text.t("toolbar.newEvent")}</Button>}
      {events.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
          <CalendarX2 aria-hidden className="size-5" />
          {text.t("sheet.dayEmpty")}
        </div>
      ) : (
        <div className="space-y-0.5">
          <p className="mb-2 text-xs text-muted-foreground">{text.t("sheet.dayCount", { count: events.length, date: text.longDate(date) })}</p>
          {events.map((event) => (
            <EventChip key={event.id} event={event} onOpen={onOpenEvent} className="py-1.5 text-sm" />
          ))}
        </div>
      )}
    </div>
  );
}

/** Dónde se cambia la fecha de lo que no se arrastra. */
function readOnlyKey(event: CalendarEvent): string {
  if (event.type === "milestone") return "readOnly.milestoneBilled";
  if (event.type === "task" && event.kind === "project") return "readOnly.project";
  return `readOnly.${event.type}`;
}

/** El botón que lleva a la fuente: una tarea se abre en su proyecto; una entrega, en el proyecto. */
function openKey(event: CalendarEvent): string {
  return event.type === "task" && event.kind === "project" ? "open.project" : `open.${event.type}`;
}

function EventContent({
  event,
  members,
  basePath,
  canMove,
  currentMemberId,
  onMove,
  onBack,
  onNavigate,
  onEditAppointment,
}: {
  event: CalendarEvent;
  members: ReadonlyMap<string, AgendaMember>;
  basePath: string;
  canMove: boolean;
  /** Quien mira: solo edita sus propias citas (el calendario es compartido). */
  currentMemberId: string | null;
  onMove: (event: CalendarEvent, date: CivilDate) => void;
  onBack: (() => void) | null;
  onNavigate: () => void;
  onEditAppointment: () => void;
}) {
  const text = useCalendarText();
  const [date, setDate] = useState(event.date);
  const owner = event.ownerMemberId ? members.get(event.ownerMemberId) : undefined;
  const detail = text.detail(event);
  const amount = text.amount(event);
  const isFiscalModel = event.type === "fiscal" && event.kind !== "verifactu";

  function submitMove(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && date !== event.date) onMove(event, date);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
        {onBack && (
          <Button variant="ghost" size="sm" className="-mt-2 -ml-2" onClick={onBack}>
            <ArrowLeft data-icon="inline-start" />
            {text.t("sheet.backToDay")}
          </Button>
        )}

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", STATUS_BADGE[event.status])}>
              {text.t(`status.${event.status}`)}
            </span>
            <span className="text-sm font-semibold first-letter:uppercase">
              {text.longDate(event.date)}
              {event.time && ` · ${event.time}`}
            </span>
          </div>
          {detail && <p className="text-sm text-muted-foreground">{detail}</p>}
          {amount && (
            <p className="text-2xl font-extrabold tabular heading-tight">
              {amount}
              <span className="ml-2 align-middle text-xs font-medium text-muted-foreground">
                {text.t(event.amountBasis === "gross" ? "sheet.amountGross" : "sheet.amountBase")}
              </span>
            </p>
          )}
        </div>

        {event.facts.length > 0 && (
          <dl className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-4 gap-y-2 rounded-xl border bg-muted/20 px-4 py-3 text-sm">
            {event.facts.map((fact, index) => (
              <div key={`${fact.key}-${index}`} className="contents">
                <dt className="truncate text-muted-foreground">{text.factLabel(fact)}</dt>
                <dd className="min-w-0 break-words font-medium tabular">{text.factValue(fact)}</dd>
              </div>
            ))}
            <div className="contents">
              <dt className="text-muted-foreground">{text.t("sheet.owner")}</dt>
              <dd className="font-medium">{owner ? `${owner.fullName} (${owner.initials})` : text.t("sheet.shared")}</dd>
            </div>
          </dl>
        )}

        {event.type === "fiscal" && (
          <div className="space-y-2 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm">
            <p className="flex items-center gap-2 font-semibold text-warning">
              <Landmark aria-hidden className="size-4" />
              {text.t("fiscal.validate")}
            </p>
            {isFiscalModel && <p>{text.t(`fiscal.models.m${event.kind}.description`)}</p>}
            {event.kind === "verifactu" && <p>{text.t("fiscal.verifactuBody")}</p>}
            <p className="text-xs text-muted-foreground">{text.t("fiscal.disclaimer")}</p>
          </div>
        )}

        {event.type === "appointment" && canMove && event.ownerMemberId === currentMemberId ? (
          <Button variant="secondary" onClick={onEditAppointment}><Pencil data-icon="inline-start" />{text.t("editor.editTitle")}</Button>
        ) : event.movable && canMove ? (
          <form onSubmit={submitMove} className="space-y-2 rounded-xl border px-4 py-3">
            <label htmlFor={`move-${event.id}`} className="flex items-center gap-2 text-sm font-semibold">
              <Move aria-hidden className="size-4 text-muted-foreground" />
              {text.t("sheet.moveLabel")}
            </label>
            <div className="flex gap-2">
              <Input
                id={`move-${event.id}`}
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-44 tabular"
                required
              />
              <Button type="submit" variant="secondary" disabled={date === event.date || date === ""}>
                {text.t("sheet.move")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{text.t(`movable.${event.type}`)}</p>
          </form>
        ) : (
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Info aria-hidden className="mt-px size-3.5 shrink-0" />
            {event.movable ? text.t("readOnly.permission") : text.t(readOnlyKey(event))}
          </p>
        )}
      </div>

      {(event.href || event.links.length > 0) && (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t px-5 py-3">
          {event.links.map((link) => (
            <Button key={`${link.key}-${link.href}`} variant="ghost" size="sm" asChild>
              <Link href={`${basePath}${link.href}`} onClick={onNavigate}>
                {text.t(`links.${link.key}`)}
              </Link>
            </Button>
          ))}
          {event.href && (
            <Button size="sm" asChild>
              <Link href={`${basePath}${event.href}`} onClick={onNavigate}>
                {text.t(openKey(event))}
                {event.type === "fiscal" ? <ExternalLink data-icon="inline-end" /> : <ArrowRight data-icon="inline-end" />}
              </Link>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
