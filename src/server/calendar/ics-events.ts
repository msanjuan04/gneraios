// De eventos del calendario a eventos ICS, con los mismos textos que la pantalla (i18n del idioma
// del socio). Puro: lo usan el enlace de suscripción y sus tests. Sin datos personales de más: la
// descripción lleva lo que se ve en el panel del evento, nunca emails ni teléfonos.

import {
  type CalendarEvent,
  type CalendarEventType,
  DEFAULT_DURATION_MINUTES,
  eventDetail,
  eventSummary,
  type FactFormat,
  factLabel,
  factValue,
  formatAmount,
} from "@/domain/calendar";
import type { IcsEvent } from "./ics";

export type IcsEventFormat = FactFormat & {
  /** URL de la org en la app ("https://os.gnerai.com/gnerai"): los enlaces llevan a la fuente. */
  orgUrl: string;
  /** Dominio de los UID ("os.gnerai.com"). */
  uidDomain: string;
};

/** Tipos cuyo contexto va en el título (sin él, el título no se entiende en un calendario ajeno). */
const DETAIL_IN_TITLE: ReadonlySet<CalendarEventType> = new Set(["fiscal", "deal", "task", "meeting"]);

export function toIcsEvent(event: CalendarEvent, f: IcsEventFormat): IcsEvent {
  const detail = eventDetail(event, f.t);
  const detailInTitle = DETAIL_IN_TITLE.has(event.type);
  const url = event.href ? `${f.orgUrl}${event.href}` : undefined;
  const summary = [
    event.status === "overdue" ? f.t("ics.overdue") : null,
    eventSummary(event, f.t),
    event.amountCents !== null ? formatAmount(event.amountCents, event.amountPeriod, f) : null,
    detailInTitle ? detail : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
  const description = [
    !detailInTitle ? detail : null,
    ...event.facts.map((fact) => `${factLabel(fact, f.t)}: ${factValue(fact, f)}`),
    event.type === "fiscal" ? f.t("fiscal.disclaimer") : null,
    url ? f.t("ics.open", { url }) : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join("\n");
  return {
    uid: `${event.id.replace(/[^A-Za-z0-9-]+/g, "-")}@${f.uidDomain}`,
    summary,
    description,
    url,
    categories: [f.t(`types.${event.type}`)],
    start: event.startsAt
      ? { instant: event.startsAt, minutes: DEFAULT_DURATION_MINUTES[event.kind ?? ""] ?? 30 }
      : { date: event.date },
  };
}
