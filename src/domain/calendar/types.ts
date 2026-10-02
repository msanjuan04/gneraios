// Modelo de evento del calendario (ARCHITECTURE.md §6.4): una fecha que ya existe en otra tabla
// (o que se deriva de otras, como los plazos fiscales), vista como evento. Nunca se guarda: el
// calendario lo reconstruye en cada carga desde su fuente, y la fuente es la única que se edita.

import type { CivilDate } from "../dates/civil-date";
import type { Cents } from "../money";

/**
 * Tipos de evento, en el orden en que se ordenan dentro de un día y se ofrecen en los filtros:
 * primero lo que tiene plazo o dinero de por medio.
 */
export const CALENDAR_EVENT_TYPES = [
  "fiscal",
  "collection",
  "reminder",
  "deal",
  "task",
  "meeting",
  "appointment",
  "milestone",
  "billing",
  "renewal",
  "contract",
  "quote",
  "issued",
] as const;
export type CalendarEventType = (typeof CALENDAR_EVENT_TYPES)[number];

/** Lo que se ve sin tocar los filtros. Las facturas emitidas son historia: una capa opcional. */
export const DEFAULT_EVENT_TYPES: readonly CalendarEventType[] = CALENDAR_EVENT_TYPES.filter((type) => type !== "issued");

export function isCalendarEventType(value: unknown): value is CalendarEventType {
  return typeof value === "string" && (CALENDAR_EVENT_TYPES as readonly string[]).includes(value);
}

/**
 * - overdue: pide algo y su fecha ya ha pasado (cobro vencido, acción atrasada, hito sin facturar…).
 * - pending: pide algo hoy o está en plazo (recordatorio por aprobar, plazo fiscal abierto…).
 * - scheduled: está por llegar.
 * - done: ya está hecho (hito facturado, reunión celebrada, factura emitida, tarea terminada).
 * - past: la fecha pasó y no hay nada que hacer (o no se puede saber, como un plazo fiscal).
 */
export const CALENDAR_EVENT_STATUSES = ["overdue", "pending", "scheduled", "done", "past"] as const;
export type CalendarEventStatus = (typeof CALENDAR_EVENT_STATUSES)[number];

/** Tabla de la que sale el evento: la única que guarda su fecha. */
export type CalendarSourceTable =
  | "invoices"
  | "outbound_emails"
  | "contracts"
  | "contract_lines"
  | "contract_milestones"
  | "deals"
  | "quotes"
  | "activities"
  | "issuers"
  | "project_tasks"
  | "projects"
  | "calendar_entries";

export type CalendarSource = { table: CalendarSourceTable; id: string };

/** Periodo que declara un modelo fiscal: un trimestre, un ejercicio o un pago fraccionado del ejercicio. */
export type FiscalPeriod =
  | { kind: "quarter"; year: number; quarter: 1 | 2 | 3 | 4 }
  | { kind: "year"; year: number }
  | { kind: "installment"; year: number; index: 1 | 2 | 3 };

/** Claves (hojas de i18n `calendar.facts.*`) de los datos que enseña el panel de un evento. */
export type CalendarFactKey =
  | "client"
  | "contract"
  | "invoice"
  | "issuedOn"
  | "dueOn"
  | "total"
  | "paid"
  | "outstanding"
  | "daysOverdue"
  | "preparedOn"
  | "deal"
  | "stage"
  | "estOneOff"
  | "estMrr"
  | "probability"
  | "quote"
  | "validUntil"
  | "oneOff"
  | "monthly"
  | "yearly"
  | "usageLines"
  | "line"
  | "lines"
  | "period"
  | "amount"
  | "percent"
  | "auto"
  | "state"
  | "issuer"
  | "window"
  | "statutoryDue"
  | "provider"
  | "time"
  | "kind"
  | "project";

export type CalendarFact =
  | { key: CalendarFactKey; type: "date"; value: CivilDate }
  | { key: CalendarFactKey; type: "money"; value: Cents; period?: "month" | "year" }
  | { key: CalendarFactKey; type: "text"; value: string }
  /** Clave de i18n (`calendar.values.*`) en lugar de un texto libre: estados, tipos, sí/no. */
  | { key: CalendarFactKey; type: "label"; value: string }
  | { key: CalendarFactKey; type: "bps"; value: number }
  | { key: CalendarFactKey; type: "number"; value: number }
  | { key: CalendarFactKey; type: "range"; from: CivilDate; to: CivilDate }
  | { key: CalendarFactKey; type: "fiscalPeriod"; value: FiscalPeriod }
  /** Una partida con su texto: las líneas de un contrato que se facturan, empiezan o terminan. */
  | { key: CalendarFactKey; type: "item"; label: string; cents: Cents | null; period?: "month" | "year" };

/** Enlaces relacionados (hojas de i18n `calendar.links.*`), además del de la fuente (`href`). */
export type CalendarLinkKey = "invoice" | "client" | "contract" | "deal" | "quote" | "outbox" | "issuers";
export type CalendarLink = { key: CalendarLinkKey; href: string };

export type CalendarEvent = {
  /** Estable entre cargas (y UID del ICS): tipo + fuente (+ fecha, si la fuente genera varias). */
  id: string;
  type: CalendarEventType;
  /** Subtipo: modelo fiscal, alta/baja de línea, llamada/reunión, emitida/rectificativa… */
  kind: string | null;
  date: CivilDate;
  /** Hora de pared (HH:mm) en la zona de la org; null = todo el día. */
  time: string | null;
  /** Instante exacto (ISO 8601) de los eventos con hora. */
  startsAt: string | null;
  /** Solo citas editables: fin exacto y descripción. */
  endsAt?: string | null;
  description?: string | null;
  /** Inicio original de una cita que se muestra en varios días. */
  appointmentStart?: { date: CivilDate; time: string | null };
  /** El texto de la propia fuente: número de factura, próxima acción, título, etiqueta del hito… */
  title: string;
  subtitle: string | null;
  amountCents: Cents | null;
  /** "€/mes" o "€/año": lo recurrente nunca se suma con lo puntual. */
  amountPeriod: "month" | "year" | null;
  /** Con IVA y neto de IRPF (lo que se cobra) o base sin IVA (lo que se factura). */
  amountBasis: "gross" | "base" | null;
  status: CalendarEventStatus;
  /** Socio responsable; null = de todos (p. ej. los plazos de la SL). */
  ownerMemberId: string | null;
  /** Ruta dentro de la org ("/invoices/<id>"): donde se cambia el dato. */
  href: string | null;
  source: CalendarSource;
  /**
   * Si se puede mover arrastrando: la fecha vive en un solo sitio y moverla es legítimo (la
   * próxima acción de un deal, un hito sin facturar, una tarea sin hacer). Los permisos los
   * añade la pantalla.
   */
  movable: boolean;
  facts: CalendarFact[];
  links: CalendarLink[];
};
