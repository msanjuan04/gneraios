/**
 * Fechas y horas "de pared" en la zona horaria de la org (Europe/Madrid), sin
 * depender de la zona del navegador ni del servidor. Lo usan el formulario de
 * actividad (<input type="datetime-local">) y los días en etapa de los deals.
 */

type WallClock = { year: number; month: number; day: number; hour: number; minute: number; second: number };

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let cached = formatters.get(timeZone);
  if (!cached) {
    cached = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, cached);
  }
  return cached;
}

function wallClock(ms: number, timeZone: string): WallClock {
  const parts = formatter(timeZone).formatToParts(new Date(ms));
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  };
}

/** Diferencia entre la hora de pared de la zona y UTC en ese instante, en ms (+2 h en verano en Madrid). */
function zoneOffset(ms: number, timeZone: string): number {
  const w = wallClock(ms, timeZone);
  const wallAsUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return wallAsUtc - (ms - (((ms % 1000) + 1000) % 1000));
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Fecha civil (YYYY-MM-DD) de un instante en la zona. */
export function dateInZone(instant: Date, timeZone: string): string {
  const w = wallClock(instant.getTime(), timeZone);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}`;
}

/** Valor de un <input type="datetime-local"> (YYYY-MM-DDTHH:mm) para un instante en la zona. */
export function toDateTimeLocal(instant: Date, timeZone: string): string {
  const w = wallClock(instant.getTime(), timeZone);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}`;
}

const LOCAL_DATETIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * Instante de una fecha y hora de pared en la zona: "2026-09-26T14:30" en Madrid →
 * 12:30 UTC. null si el texto no es una fecha y hora real. Una hora que no existe
 * (el salto de marzo) avanza como el reloj; una repetida (octubre) toma la segunda.
 */
export function fromDateTimeLocal(value: string, timeZone: string): Date | null {
  const match = LOCAL_DATETIME.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map((part) => Number(part ?? "0")) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const naive = Date.UTC(year, month - 1, day, hour, minute, second);
  const check = new Date(naive);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    check.getUTCHours() !== hour ||
    check.getUTCMinutes() !== minute
  ) {
    return null;
  }
  // Primera aproximación con el desfase de la hora "ingenua"; la segunda corrige los cambios de hora.
  const guess = naive - zoneOffset(naive, timeZone);
  return new Date(naive - zoneOffset(guess, timeZone));
}

/** Días naturales entre dos instantes contados en la zona (0 = el mismo día). Nunca negativo. */
export function calendarDaysBetween(from: Date, to: Date, timeZone: string): number {
  const toUtcDay = (date: string) => {
    const [y, m, d] = date.split("-").map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
  };
  const days = Math.round((toUtcDay(dateInZone(to, timeZone)) - toUtcDay(dateInZone(from, timeZone))) / 86_400_000);
  return Math.max(0, days);
}
