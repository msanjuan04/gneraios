// Duraciones en minutos enteros (como time_entries.minutes). "h" y "min" se escriben igual en
// español, catalán e inglés, así que el formato no necesita traducción: solo el separador de miles.

/** Lo máximo que cabe en un registro de horas: un día. */
export const MAX_ENTRY_MINUTES = 24 * 60;

/** Tope del presupuesto de horas de un proyecto (el de la base de datos). */
export const MAX_ESTIMATE_MINUTES = 100_000 * 60;

/** Tope de la estimación de una tarea (el de la base de datos y el de las plantillas). */
export const MAX_TASK_ESTIMATE_MINUTES = 10_000 * 60;

const formatters = new Map<string, Intl.NumberFormat>();

function numberFormat(locale: string, maximumFractionDigits: number): Intl.NumberFormat {
  const key = `${locale}:${maximumFractionDigits}`;
  let cached = formatters.get(key);
  if (!cached) {
    // "always": es-ES no agrupa los números de 4 cifras por defecto ("1234 h").
    cached = new Intl.NumberFormat(locale, { maximumFractionDigits, useGrouping: "always" });
    formatters.set(key, cached);
  }
  return cached;
}

function assertMinutes(minutes: number): number {
  if (!Number.isSafeInteger(minutes)) throw new Error(`Los minutos deben ser un número entero: ${String(minutes)}`);
  return minutes;
}

/** 90 → "1 h 30 min", 45 → "45 min", 120 → "2 h", 0 → "0 min", −90 → "−1 h 30 min". */
export function formatDuration(minutes: number, locale = "es-ES"): string {
  const total = assertMinutes(minutes);
  const sign = total < 0 ? "−" : "";
  const abs = Math.abs(total);
  const hours = Math.floor(abs / 60);
  const rest = abs % 60;
  if (hours === 0) return `${sign}${rest} min`;
  const h = `${numberFormat(locale, 0).format(hours)} h`;
  return rest === 0 ? `${sign}${h}` : `${sign}${h} ${rest} min`;
}

/** Horas con un decimal como mucho, para ejes y totales: 90 → "1,5 h", 1500 → "25 h". */
export function formatHours(minutes: number, locale = "es-ES", maximumFractionDigits = 1): string {
  return `${numberFormat(locale, maximumFractionDigits).format(assertMinutes(minutes) / 60)} h`;
}

/** Cronómetro: 75 s → "1:15", 3725 s → "1:02:05". */
export function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${rest}` : `${m}:${rest}`;
}

/** Lo que se propone al editar una duración: 90 → "1:30", 45 → "0:45". */
export function durationToInput(minutes: number): string {
  const total = assertMinutes(minutes);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

const HOUR_UNIT = "(?:h|hr|hrs|hora|horas|hores)";
const MINUTE_UNIT = "(?:m|min|mins|minuto|minutos|minut|minuts)";
const HOURS_MINUTES = /^(\d{1,6}):([0-5]\d)$/;
const MINUTES = new RegExp(`^(\\d{1,7})${MINUTE_UNIT}$`);
const HOURS_AND_MINUTES = new RegExp(`^(\\d{1,6})${HOUR_UNIT}(\\d{1,2})${MINUTE_UNIT}?$`);
const DECIMAL_HOURS = new RegExp(`^(\\d{1,6})(?:[.,](\\d{1,2}))?${HOUR_UNIT}?$`);

/**
 * Lo que se escribe en un campo de duración, a minutos. Como en Harvest o Toggl, un número solo
 * son horas:
 *
 * - "1:30" → 90 (horas:minutos)
 * - "1,5", "1.5", "1,5 h", "2 horas" → horas con hasta dos decimales (se redondea al minuto)
 * - "45 min", "45m" → minutos
 * - "1h30", "1 h 30 min" → horas y minutos
 *
 * Mayúsculas y espacios dan igual. null si no se entiende, si es 0 o si pasa de `max` (por
 * defecto, un día: un registro de horas es como mucho un día de trabajo).
 */
export function parseDurationInput(input: string, max = MAX_ENTRY_MINUTES): number | null {
  if (typeof input !== "string") return null;
  const text = input.toLowerCase().replace(/\s+/g, "");
  if (text === "") return null;

  let minutes: number | null = null;
  let match: RegExpExecArray | null;
  if ((match = HOURS_MINUTES.exec(text))) {
    minutes = Number(match[1]) * 60 + Number(match[2]);
  } else if ((match = MINUTES.exec(text))) {
    minutes = Number(match[1]);
  } else if ((match = HOURS_AND_MINUTES.exec(text))) {
    const extra = Number(match[2]);
    if (extra > 59) return null;
    minutes = Number(match[1]) * 60 + extra;
  } else if ((match = DECIMAL_HOURS.exec(text))) {
    // Centésimas de hora exactas ("1,25" → 125) para no redondear con decimales binarios.
    const hundredths = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
    minutes = Math.round((hundredths * 60) / 100);
  }
  if (minutes === null || minutes <= 0 || minutes > max) return null;
  return minutes;
}

/** Presupuesto de un proyecto (o, con su tope, estimación de una tarea): como una duración, sin el tope de un día. */
export function parseEstimateInput(input: string, max = MAX_ESTIMATE_MINUTES): number | null {
  return parseDurationInput(input, max);
}
