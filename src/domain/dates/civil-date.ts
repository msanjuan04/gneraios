/**
 * Fechas civiles `YYYY-MM-DD` (sin hora ni zona). Toda la aritmética es entera
 * sobre días UTC, así que no hay sorpresas con horarios de verano.
 *
 * El dominio admitido es el de `parseCivilDate`: años de 4 cifras a partir del 0100
 * (`Date.UTC` convierte los años 0–99 en 1900–1999). Toda función que recibe o
 * devuelve una fecha lanza si queda fuera de él.
 */
export type CivilDate = string;

export type CivilParts = { year: number; month: number; day: number };

const CIVIL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

export function parseCivilDate(value: CivilDate): CivilParts {
  const m = CIVIL_DATE.exec(value);
  if (!m) throw new Error(`Fecha no válida: ${value}`);
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    throw new Error(`Fecha no válida: ${value}`);
  }
  return { year, month, day };
}

function toUtcDays(value: CivilDate): number {
  const { year, month, day } = parseCivilDate(value);
  return Date.UTC(year, month - 1, day) / DAY_MS;
}

function assertWholeNumber(value: number, what: string): void {
  if (!Number.isSafeInteger(value)) throw new Error(`${what} debe ser un número entero: ${String(value)}`);
}

/** Días de `from` a `to` (negativo si `to` es anterior). */
export function daysBetween(from: CivilDate, to: CivilDate): number {
  return toUtcDays(to) - toUtcDays(from);
}

export function isBefore(a: CivilDate, b: CivilDate): boolean {
  return daysBetween(a, b) > 0;
}

/** Año bisiesto del calendario gregoriano: 2028 sí, 2100 no, 2000 sí. */
export function isLeapYear(year: number): boolean {
  assertWholeNumber(year, "El año");
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Días del mes (`month` de 1 a 12): febrero de 2028 tiene 29. */
export function daysInMonth(year: number, month: number): number {
  assertWholeNumber(year, "El año");
  assertWholeNumber(month, "El mes");
  if (month < 1 || month > 12) throw new Error(`Mes no válido: ${month}`);
  return month === 2 && isLeapYear(year) ? 29 : MONTH_DAYS[month - 1];
}

/** `{ year: 2026, month: 3, day: 5 }` → "2026-03-05". Lanza si las partes no forman una fecha real. */
export function formatCivil({ year, month, day }: CivilParts): CivilDate {
  const value = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  parseCivilDate(value);
  return value;
}

/** La fecha `days` días después (o antes, si es negativo) de `date`. */
export function addDays(date: CivilDate, days: number): CivilDate {
  assertWholeNumber(days, "El número de días");
  const probe = new Date((toUtcDays(date) + days) * DAY_MS);
  return formatCivil({ year: probe.getUTCFullYear(), month: probe.getUTCMonth() + 1, day: probe.getUTCDate() });
}

/**
 * Suma meses conservando el día y, si no existe en el mes de destino, usa el último:
 * 31 ene + 1 → 28 feb (29 en 2028); 29 feb 2028 + 12 → 28 feb 2029. No recuerda el día
 * original: 31 ene + 1 + 1 es 28 mar, no 31 mar (para eso, suma 2 desde el 31 ene).
 */
export function addMonthsClamped(date: CivilDate, months: number): CivilDate {
  assertWholeNumber(months, "El número de meses");
  const { year, month, day } = parseCivilDate(date);
  const index = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(index / 12);
  const targetMonth = index - targetYear * 12 + 1;
  return formatCivil({ year: targetYear, month: targetMonth, day: Math.min(day, daysInMonth(targetYear, targetMonth)) });
}

/** −1 si `a` es anterior a `b`, 0 si son el mismo día, 1 si es posterior. Sirve para `sort`. */
export function compareCivil(a: CivilDate, b: CivilDate): -1 | 0 | 1 {
  const diff = toUtcDays(a) - toUtcDays(b);
  return diff < 0 ? -1 : diff > 0 ? 1 : 0;
}

/** La fecha más temprana. */
export function minCivil(first: CivilDate, ...rest: CivilDate[]): CivilDate {
  parseCivilDate(first);
  return rest.reduce((min, date) => (compareCivil(date, min) < 0 ? date : min), first);
}

/** La fecha más tardía. */
export function maxCivil(first: CivilDate, ...rest: CivilDate[]): CivilDate {
  parseCivilDate(first);
  return rest.reduce((max, date) => (compareCivil(date, max) > 0 ? date : max), first);
}

/** Días de `from` a `to` contando los dos extremos (1 si es el mismo día); 0 si `to` es anterior. */
export function daysInclusive(from: CivilDate, to: CivilDate): number {
  return Math.max(0, daysBetween(from, to) + 1);
}
