import {
  Banknote,
  CalendarPlus,
  BellRing,
  FileSignature,
  FileText,
  Flag,
  Landmark,
  ListChecks,
  type LucideIcon,
  Receipt,
  RefreshCw,
  Repeat,
  Target,
  Users,
} from "lucide-react";
import type { CalendarEvent, CalendarEventStatus, CalendarEventType } from "@/domain/calendar";

/*
 * Identidad de cada tipo: un icono y un color derivado de los tokens de marca (--chart-*, estados
 * y texto), así que cambian solos con el tema. Con doce tipos ningún color basta solo: el icono y
 * la etiqueta llevan la identidad y el color la refuerza. El rojo no es de ningún tipo: está
 * reservado para lo vencido. Las tareas van en magenta (el violeta de marca con algo de rojo): el
 * tono que quedaba libre, entre el violeta de los hitos y el rojo de lo vencido y lejos de ambos.
 */
export const TYPE_COLORS: Record<CalendarEventType, string> = {
  fiscal: "color-mix(in oklab, var(--foreground) 72%, transparent)",
  collection: "var(--success)",
  reminder: "var(--warning)",
  deal: "var(--chart-1)",
  task: "color-mix(in oklab, var(--chart-2) 55%, var(--destructive))",
  meeting: "color-mix(in oklab, var(--chart-1) 45%, var(--success))",
  appointment: "var(--chart-3)",
  milestone: "var(--chart-2)",
  billing: "color-mix(in oklab, var(--chart-2) 55%, var(--chart-1))",
  renewal: "var(--chart-3)",
  contract: "color-mix(in oklab, var(--chart-1) 45%, var(--foreground))",
  quote: "color-mix(in oklab, var(--chart-2) 40%, var(--foreground))",
  issued: "color-mix(in oklab, var(--success) 45%, var(--foreground))",
};

export const TYPE_ICONS: Record<CalendarEventType, LucideIcon> = {
  fiscal: Landmark,
  collection: Banknote,
  reminder: BellRing,
  deal: Target,
  task: ListChecks,
  meeting: Users,
  appointment: CalendarPlus,
  milestone: Flag,
  billing: Repeat,
  renewal: RefreshCw,
  contract: FileSignature,
  quote: FileText,
  issued: Receipt,
};

/** Punto de estado: rojo lo vencido, ámbar lo pendiente, verde lo hecho. */
export const STATUS_DOT: Record<CalendarEventStatus, string> = {
  overdue: "bg-destructive",
  pending: "bg-warning",
  scheduled: "bg-primary",
  done: "bg-success",
  past: "bg-muted-foreground/50",
};

/** Texto del estado en las pastillas del panel y la agenda. */
export const STATUS_BADGE: Record<CalendarEventStatus, string> = {
  overdue: "bg-destructive/10 text-destructive",
  pending: "bg-warning/15 text-warning",
  scheduled: "bg-primary/12 text-primary",
  done: "bg-success/12 text-success",
  past: "bg-muted text-muted-foreground",
};

/** El color con el que se pinta un evento: rojo si está vencido; si no, el suyo (una cita lleva el del socio) o el de su tipo. */
export function eventColor(event: Pick<CalendarEvent, "type" | "status" | "accent">): string {
  if (event.status === "overdue") return "var(--destructive)";
  return event.accent || TYPE_COLORS[event.type];
}
