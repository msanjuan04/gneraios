"use client";

import { useDraggable } from "@dnd-kit/core";
import type { CalendarEvent } from "@/domain/calendar";
import { cn } from "@/lib/utils";
import { EventIcon } from "./event-icon";
import { eventColor } from "./event-style";
import { useCalendarText } from "./use-calendar-text";

type ChipProps = {
  event: CalendarEvent;
  onOpen: (event: CalendarEvent) => void;
  /** Sin importe (celdas estrechas del mes en pantallas pequeñas). */
  hideAmount?: boolean;
  dragging?: boolean;
  overlay?: boolean;
  className?: string;
};

/**
 * Un evento en la cuadrícula: icono del tipo, hora si la tiene, el resumen y el importe. Lo
 * vencido, en rojo; lo hecho o pasado, atenuado.
 */
export function EventChip({ event, onOpen, hideAmount, dragging, overlay, className }: ChipProps) {
  const text = useCalendarText();
  const summary = text.summary(event);
  const amount = hideAmount ? null : text.amount(event);
  const overdue = event.status === "overdue";
  const quiet = event.status === "done" || event.status === "past";
  const label = [summary, text.detail(event), amount, text.t(`status.${event.status}`)].filter(Boolean).join(" · ");

  return (
    <button
      type="button"
      onClick={() => onOpen(event)}
      aria-label={label}
      title={label}
      data-calendar-chip=""
      className={cn(
        "group/chip flex w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left text-xs leading-5 outline-none transition-colors",
        "hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60",
        overdue && "bg-destructive/10 text-destructive hover:bg-destructive/15",
        quiet && "text-muted-foreground",
        event.movable && "cursor-grab active:cursor-grabbing",
        dragging && "opacity-40",
        overlay && "cursor-grabbing border bg-popover shadow-xl",
        className,
      )}
    >
      <EventIcon event={event} aria-hidden className="size-3.5 shrink-0" style={{ color: overdue ? undefined : eventColor(event) }} />
      {event.time && <span className="shrink-0 font-semibold tabular text-muted-foreground">{event.time}</span>}
      <span className={cn("min-w-0 flex-1 truncate font-medium", event.status === "done" && "line-through decoration-current/30")}>
        {summary}
      </span>
      {amount && <span className="shrink-0 font-semibold tabular">{amount}</span>}
    </button>
  );
}

/**
 * El mismo chip, arrastrable con el ratón o el dedo (solo los eventos cuya fecha se puede mover,
 * y si hay permiso). Con el teclado se mueve desde su panel ("Mover a"), así que el botón conserva
 * su rol y su foco: dnd-kit solo añade los manejadores del puntero.
 */
export function DraggableChip(props: ChipProps & { disabled: boolean }) {
  const { disabled, ...chip } = props;
  const { setNodeRef, listeners, isDragging } = useDraggable({ id: chip.event.id, disabled });
  return (
    <div ref={setNodeRef} {...(disabled ? {} : listeners)} className="min-w-0 touch-manipulation">
      <EventChip {...chip} dragging={isDragging || chip.dragging} />
    </div>
  );
}
