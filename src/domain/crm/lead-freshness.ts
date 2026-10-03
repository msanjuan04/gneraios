// Qué es un lead de verdad. Un contacto del que no se sabe nada desde hace semanas no es una
// oportunidad que se esté trabajando: sigue en el pipeline, pero no es un lead «vivo». Se deriva de
// las fechas (último contacto, alta) y de la calificación; no se guarda.

import type { LeadTemperature } from "./lead-board";

/** Cuántos días sin novedad hacen que un lead deje de contar como vivo. */
export const LIVE_LEAD_DAYS = 14;

const DAY_MS = 86_400_000;

/**
 * Vivo si es caliente (se calificó a mano) o ha habido novedad —un contacto o el propio alta— en las
 * últimas dos semanas. Frío calificado a mano nunca cuenta. Lo demás se queda fuera de la portada de
 * Leads (sigue en el pipeline y se puede ver con «ver todos»).
 */
export function isLiveLead(
  lead: { lastContactAt: string | null; createdAt: string; temperature: LeadTemperature | null },
  now: Date,
  days: number = LIVE_LEAD_DAYS,
): boolean {
  if (lead.temperature === "hot") return true;
  if (lead.temperature === "cold") return false;
  const latest = Math.max(
    lead.lastContactAt ? Date.parse(lead.lastContactAt) : Number.NEGATIVE_INFINITY,
    Date.parse(lead.createdAt),
  );
  if (!Number.isFinite(latest)) return false;
  return now.getTime() - latest <= days * DAY_MS;
}
