import { type LucideIcon, Mail, Phone, StickyNote, Users } from "lucide-react";
import type { ActivityKind } from "@/app/[org]/clients/schema";

/** Icono de cada tipo de actividad humana, en el timeline y en el formulario. */
export const ACTIVITY_ICONS: Record<ActivityKind, LucideIcon> = {
  call: Phone,
  meeting: Users,
  email: Mail,
  note: StickyNote,
};
