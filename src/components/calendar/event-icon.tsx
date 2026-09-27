import { FolderKanban, type LucideProps, Phone, ShieldCheck } from "lucide-react";
import type { CalendarEvent } from "@/domain/calendar";
import { TYPE_ICONS } from "./event-style";

/**
 * El icono de un evento concreto: una llamada no es una reunión, ni Verifactu un modelo fiscal, ni
 * la entrega de un proyecto una tarea.
 */
export function EventIcon({ event, ...props }: { event: Pick<CalendarEvent, "type" | "kind"> } & LucideProps) {
  if (event.type === "meeting" && event.kind === "call") return <Phone {...props} />;
  if (event.type === "task" && event.kind === "project") return <FolderKanban {...props} />;
  if (event.type === "fiscal" && event.kind === "verifactu") return <ShieldCheck {...props} />;
  const Icon = TYPE_ICONS[event.type];
  return <Icon {...props} />;
}
