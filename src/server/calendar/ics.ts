// Generador de iCalendar (RFC 5545) para el enlace de suscripción. Puro y sin dependencias: texto
// con escapes, líneas plegadas a 75 octetos sin partir caracteres UTF-8, CRLF, eventos de todo
// el día (VALUE=DATE, fin exclusivo) y con hora en la zona de la org. Para Europe/Madrid se
// incluye su VTIMEZONE (CET/CEST); con otra zona, las horas van en UTC, que siempre es correcto.

import { addDays, type CivilDate } from "@/domain/dates/civil-date";
import { toDateTimeLocal } from "@/domain/dates/zoned-time";

export type IcsEvent = {
  /** Estable entre descargas: el calendario actualiza el evento en lugar de duplicarlo. */
  uid: string;
  summary: string;
  description?: string;
  url?: string;
  categories?: string[];
  /** Todo el día (fecha civil) o con hora (instante ISO y duración). */
  start: { date: CivilDate } | { instant: string; minutes: number };
};

export type IcsCalendar = {
  name: string;
  description?: string;
  timeZone: string;
  events: readonly IcsEvent[];
  /** Instante de la generación (DTSTAMP). */
  generatedAt: Date;
  /** Cada cuánto se sugiere al calendario que vuelva a leerlo. */
  refreshMinutes?: number;
};

const CRLF = "\r\n";
const MAX_OCTETS = 75;
const encoder = new TextEncoder();

/** Escapes de un valor TEXT: barra invertida, punto y coma, coma y saltos de línea. */
export function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");
}

/** Pliega una línea a 75 octetos: CRLF + espacio, sin partir un carácter de varios bytes. */
export function foldLine(line: string): string {
  if (encoder.encode(line).length <= MAX_OCTETS) return line;
  const parts: string[] = [];
  let current = "";
  let octets = 0;
  // La primera línea admite 75 octetos; las siguientes, 74 (el espacio inicial cuenta).
  let limit = MAX_OCTETS;
  for (const char of line) {
    const size = encoder.encode(char).length;
    if (octets + size > limit) {
      parts.push(current);
      current = "";
      octets = 0;
      limit = MAX_OCTETS - 1;
    }
    current += char;
    octets += size;
  }
  parts.push(current);
  return parts.join(`${CRLF} `);
}

const compactDate = (date: CivilDate) => date.slice(0, 10).replace(/-/g, "");

/** Instante en UTC: 20261020T083000Z. */
export function utcStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Hora de pared en la zona: 20261020T103000. */
function localStamp(instant: Date, timeZone: string): string {
  return `${toDateTimeLocal(instant, timeZone).replace(/[-:]/g, "")}00`;
}

/**
 * Si el instante es la segunda vez que el reloj marca esa hora (la hora repetida al volver al
 * horario de invierno). RFC 5545 lee una hora local repetida como la primera, así que ese caso
 * va en UTC para no desplazarlo una hora.
 */
function isRepeatedWallTime(instant: Date, timeZone: string): boolean {
  return toDateTimeLocal(new Date(instant.getTime() - 3_600_000), timeZone) === toDateTimeLocal(instant, timeZone);
}

/** DTSTART/DTEND de un instante: hora local con TZID o, si no se puede sin ambigüedad, UTC. */
function dateTimeProperty(name: "DTSTART" | "DTEND", instant: Date, timeZone: string, withTimezone: boolean): string {
  return withTimezone && !isRepeatedWallTime(instant, timeZone)
    ? `${name};TZID=${timeZone}:${localStamp(instant, timeZone)}`
    : `${name}:${utcStamp(instant)}`;
}

/** VTIMEZONE de Europe/Madrid: CET (+01:00) y CEST (+02:00), del último domingo de marzo al de octubre. */
const MADRID_VTIMEZONE = [
  "BEGIN:VTIMEZONE",
  "TZID:Europe/Madrid",
  "X-LIC-LOCATION:Europe/Madrid",
  "BEGIN:DAYLIGHT",
  "TZOFFSETFROM:+0100",
  "TZOFFSETTO:+0200",
  "TZNAME:CEST",
  "DTSTART:19700329T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:+0200",
  "TZOFFSETTO:+0100",
  "TZNAME:CET",
  "DTSTART:19701025T030000",
  "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
  "END:STANDARD",
  "END:VTIMEZONE",
];

function eventLines(event: IcsEvent, stamp: string, timeZone: string, withTimezone: boolean): string[] {
  const lines = ["BEGIN:VEVENT", `UID:${escapeText(event.uid)}`, `DTSTAMP:${stamp}`];
  if ("date" in event.start) {
    // Todo el día: el fin es exclusivo (el día siguiente) y no ocupa la agenda.
    lines.push(`DTSTART;VALUE=DATE:${compactDate(event.start.date)}`, `DTEND;VALUE=DATE:${compactDate(addDays(event.start.date, 1))}`, "TRANSP:TRANSPARENT");
  } else {
    const start = new Date(event.start.instant);
    const end = new Date(start.getTime() + event.start.minutes * 60_000);
    lines.push(
      dateTimeProperty("DTSTART", start, timeZone, withTimezone),
      dateTimeProperty("DTEND", end, timeZone, withTimezone),
      "TRANSP:OPAQUE",
    );
  }
  lines.push(`SUMMARY:${escapeText(event.summary)}`);
  if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
  if (event.url) lines.push(`URL:${event.url}`);
  if (event.categories?.length) lines.push(`CATEGORIES:${event.categories.map(escapeText).join(",")}`);
  lines.push("END:VEVENT");
  return lines;
}

/** El calendario entero, listo para servir como text/calendar. */
export function buildIcs(calendar: IcsCalendar): string {
  const withTimezone = calendar.timeZone === "Europe/Madrid";
  const stamp = utcStamp(calendar.generatedAt);
  const refresh = `PT${Math.max(15, calendar.refreshMinutes ?? 60)}M`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//GNERAI//GNERAI OS//ES",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(calendar.name)}`,
    ...(calendar.description ? [`X-WR-CALDESC:${escapeText(calendar.description)}`] : []),
    `X-WR-TIMEZONE:${calendar.timeZone}`,
    `REFRESH-INTERVAL;VALUE=DURATION:${refresh}`,
    `X-PUBLISHED-TTL:${refresh}`,
    ...(withTimezone ? MADRID_VTIMEZONE : []),
    ...calendar.events.flatMap((event) => eventLines(event, stamp, calendar.timeZone, withTimezone)),
    "END:VCALENDAR",
  ];
  return lines.map(foldLine).join(CRLF) + CRLF;
}
