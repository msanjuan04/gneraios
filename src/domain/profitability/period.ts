// Periodo de la rentabilidad: los últimos 12 o 3 meses (hasta hoy), un mes, un trimestre, un año
// natural, desde siempre o un rango a medida. Viaja en la URL (?period=2026-09, ?period=2026-Q3,
// ?period=2026, ?period=last3m, ?period=all o ?from=…&to=…) para que se pueda compartir y volver
// atrás. Todo son fechas civiles en la zona de la org; ambos extremos cuentan.
//
// «Desde siempre» va de la primera factura emitida o el primer coste (lo que sea antes) hasta hoy.
// Esa primera fecha sale de los datos, así que la URL no la lleva: hasta que el servidor la busca
// (resolveLifetime), el periodo empieza en LIFETIME_FROM, que ya lo incluye todo.

import {
  addDays,
  addMonthsClamped,
  type CivilDate,
  compareCivil,
  daysBetween,
  daysInMonth,
  formatCivil,
  minCivil,
  parseCivilDate,
} from "../dates/civil-date";

export const PERIOD_KINDS = ["last12m", "last3m", "month", "quarter", "year", "all", "custom"] as const;
export type PeriodKind = (typeof PERIOD_KINDS)[number];

/** Los que se mueven con ← →: un mes, un trimestre o un año naturales. */
export const CALENDAR_PERIOD_KINDS = ["month", "quarter", "year"] as const satisfies readonly PeriodKind[];

export type Period = {
  kind: PeriodKind;
  from: CivilDate;
  to: CivilDate;
};

/**
 * Sin nada en la URL: los últimos 12 meses. Lo que se factura por hitos (webs, branding) no cae el
 * mismo mes que las horas: en un año se compensa y se ve quién deja dinero de verdad.
 */
export const DEFAULT_PERIOD_KIND = "last12m" satisfies PeriodKind;

/** Un rango a medida es de tres años como mucho. */
export const MAX_RANGE_DAYS = 3 * 366;

const MIN_YEAR = 2000;
const MAX_YEAR = 2999;

/** El primer día que puede tener «Desde siempre» (el mismo límite que el resto de periodos). */
export const LIFETIME_FROM = `${MIN_YEAR}-01-01` satisfies CivilDate;
const MONTH_VALUE = /^(\d{4})-(\d{2})$/;
const QUARTER_VALUE = /^(\d{4})-[QT]([1-4])$/i;
const YEAR_VALUE = /^(\d{4})$/;

function validYear(year: number): boolean {
  return Number.isInteger(year) && year >= MIN_YEAR && year <= MAX_YEAR;
}

function isCivil(value: string): boolean {
  try {
    parseCivilDate(value);
    return true;
  } catch {
    return false;
  }
}

/** Los `months` meses que acaban hoy: del día siguiente al de hace `months` meses, a hoy. */
export function rollingPeriod(today: CivilDate, months: 3 | 12): Period {
  return { kind: months === 3 ? "last3m" : "last12m", from: addDays(addMonthsClamped(today, -months), 1), to: today };
}

export function monthPeriod(year: number, month: number): Period {
  return { kind: "month", from: formatCivil({ year, month, day: 1 }), to: formatCivil({ year, month, day: daysInMonth(year, month) }) };
}

export function quarterPeriod(year: number, quarter: 1 | 2 | 3 | 4): Period {
  const first = (quarter - 1) * 3 + 1;
  return {
    kind: "quarter",
    from: formatCivil({ year, month: first, day: 1 }),
    to: formatCivil({ year, month: first + 2, day: daysInMonth(year, first + 2) }),
  };
}

export function yearPeriod(year: number): Period {
  return { kind: "year", from: formatCivil({ year, month: 1, day: 1 }), to: formatCivil({ year, month: 12, day: 31 }) };
}

/**
 * Desde siempre hasta hoy. `firstOn`: la primera factura emitida o el primer coste (lo que sea
 * antes); sin él, desde LIFETIME_FROM (lo incluye todo). Sin nada anterior a hoy, solo hoy.
 */
export function lifetimePeriod(today: CivilDate, firstOn?: CivilDate | null): Period {
  if (firstOn === undefined) return { kind: "all", from: LIFETIME_FROM, to: today };
  const from = firstOn !== null && compareCivil(firstOn, today) <= 0 && compareCivil(firstOn, LIFETIME_FROM) >= 0 ? firstOn : today;
  return { kind: "all", from, to: today };
}

/** Un rango a medida válido (fechas reales, en orden, de 3 años como mucho y que no empieza en el futuro), o null. */
export function customPeriod(from: string, to: string, today: CivilDate): Period | null {
  if (!isCivil(from) || !isCivil(to)) return null;
  if (!validYear(parseCivilDate(from).year) || !validYear(parseCivilDate(to).year)) return null;
  if (compareCivil(from, to) > 0 || daysBetween(from, to) >= MAX_RANGE_DAYS) return null;
  if (compareCivil(from, today) > 0) return null;
  return { kind: "custom", from, to };
}

/** Trimestre (1-4) de una fecha. */
export function quarterOfDate(date: CivilDate): 1 | 2 | 3 | 4 {
  return (Math.floor((parseCivilDate(date).month - 1) / 3) + 1) as 1 | 2 | 3 | 4;
}

/**
 * El periodo de un tipo que contiene `anchor` (el mes, trimestre o año de ese día), los últimos
 * meses hasta hoy o, a medida, el rango `custom` (por defecto, el del ancla hasta hoy).
 */
export function periodOfKind(kind: PeriodKind, anchor: CivilDate, today: CivilDate, custom?: { from: CivilDate; to: CivilDate }): Period {
  const { year, month } = parseCivilDate(anchor);
  switch (kind) {
    case "last3m":
      return rollingPeriod(today, 3);
    case "last12m":
      return rollingPeriod(today, 12);
    case "month":
      return monthPeriod(year, month);
    case "quarter":
      return quarterPeriod(year, quarterOfDate(anchor));
    case "year":
      return yearPeriod(year);
    case "all":
      return lifetimePeriod(today);
    case "custom": {
      // Desde un periodo más largo que un rango a medida (desde siempre), los últimos 3 años de él.
      const to = custom?.to ?? today;
      const from = custom?.from ?? anchor;
      return { kind: "custom", from: daysBetween(from, to) >= MAX_RANGE_DAYS ? addDays(to, -(MAX_RANGE_DAYS - 1)) : from, to };
    }
  }
}

/** "last3m", "last12m", "all", "2026-09", "2026-Q3" (o "2026-T3") o "2026" → periodo; null si no es válido o empieza en el futuro. */
export function parsePeriodValue(value: string, today: CivilDate): Period | null {
  const text = value.trim();
  let period: Period | null = null;
  let match: RegExpExecArray | null;
  if (text === "last3m") period = rollingPeriod(today, 3);
  else if (text === "last12m") period = rollingPeriod(today, 12);
  else if (text === "all") period = lifetimePeriod(today);
  else if ((match = MONTH_VALUE.exec(text))) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (validYear(year) && month >= 1 && month <= 12) period = monthPeriod(year, month);
  } else if ((match = QUARTER_VALUE.exec(text))) {
    const year = Number(match[1]);
    if (validYear(year)) period = quarterPeriod(year, Number(match[2]) as 1 | 2 | 3 | 4);
  } else if ((match = YEAR_VALUE.exec(text))) {
    const year = Number(match[1]);
    if (validYear(year)) period = yearPeriod(year);
  }
  if (!period || compareCivil(period.from, today) > 0) return null;
  return period;
}

const first = (value: string | string[] | undefined): string => (Array.isArray(value) ? (value[0] ?? "") : (value ?? "")).trim();

/** El periodo de la URL (searchParams de la página); lo que no se entienda, el de por defecto (12 meses). */
export function readPeriod(params: Readonly<Record<string, string | string[] | undefined>>, today: CivilDate): Period {
  const from = first(params.from);
  const to = first(params.to);
  if (from || to) {
    const custom = customPeriod(from, to, today);
    if (custom) return custom;
  }
  return parsePeriodValue(first(params.period), today) ?? rollingPeriod(today, 12);
}

/** Lo que va en la URL para un periodo (vacío para el de por defecto). */
export function periodParams(period: Period): Record<string, string> {
  switch (period.kind) {
    case "last12m":
      return {};
    case "last3m":
      return { period: "last3m" };
    case "all":
      return { period: "all" };
    case "month":
      return { period: period.from.slice(0, 7) };
    case "quarter":
      return { period: `${period.from.slice(0, 4)}-Q${quarterOfDate(period.from)}` };
    case "year":
      return { period: period.from.slice(0, 4) };
    case "custom":
      return { from: period.from, to: period.to };
  }
}

/** "?period=2026-Q3", "?from=…&to=…" o "" (el de por defecto). */
export function periodQuery(period: Period): string {
  const query = new URLSearchParams(periodParams(period)).toString();
  return query ? `?${query}` : "";
}

/**
 * El mes, trimestre o año anterior (−1) o siguiente (+1). null si el periodo no es natural o si el
 * siguiente aún no ha empezado (no hay nada que medir en el futuro).
 */
export function shiftPeriod(period: Period, delta: -1 | 1, today: CivilDate): Period | null {
  let next: Period;
  switch (period.kind) {
    case "month": {
      const target = parseCivilDate(addMonthsClamped(period.from, delta));
      next = monthPeriod(target.year, target.month);
      break;
    }
    case "quarter": {
      const start = addMonthsClamped(period.from, delta * 3);
      next = quarterPeriod(parseCivilDate(start).year, quarterOfDate(start));
      break;
    }
    case "year":
      next = yearPeriod(parseCivilDate(period.from).year + delta);
      break;
    default:
      return null;
  }
  if (!validYear(parseCivilDate(next.from).year) || compareCivil(next.from, today) > 0) return null;
  return next;
}

/** ¿Está en curso (hoy cae dentro y aún no ha acabado)? */
export function isPeriodInProgress(period: Period, today: CivilDate): boolean {
  return compareCivil(period.from, today) <= 0 && compareCivil(today, period.to) < 0;
}

/** El día del periodo desde el que se ancla un cambio de tipo: su último día, sin pasar de hoy. */
export function periodAnchor(period: Period, today: CivilDate): CivilDate {
  return minCivil(period.to, today);
}
