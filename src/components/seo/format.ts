import type { useFormatter } from "next-intl";

/**
 * Formato de las cifras de SEO, igual en servidor y cliente (recibe el formateador de next-intl).
 * Las fechas son civiles (YYYY-MM-DD): se formatean a mediodía UTC para que ninguna zona las mueva.
 */

export type Formatter = Pick<ReturnType<typeof useFormatter>, "number" | "dateTime" | "dateTimeRange">;

export const civilToDate = (date: string) => new Date(`${date}T12:00:00Z`);

export const DAY_SHORT = { day: "numeric", month: "short", timeZone: "UTC" } as const;
export const DAY_LONG = { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" } as const;

export function formatCount(format: Formatter, value: number, compact = false): string {
  if (compact && Math.abs(value) >= 100_000) {
    return format.number(value, { notation: "compact", maximumFractionDigits: 1 });
  }
  return format.number(Math.round(value), { useGrouping: "always" });
}

export const formatPercent = (format: Formatter, value: number, digits = 1) =>
  format.number(value, { style: "percent", minimumFractionDigits: value > 0 && value < 0.1 ? digits : 0, maximumFractionDigits: digits });

export const formatPosition = (format: Formatter, value: number) =>
  format.number(value, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Variación relativa con signo: "+12 %", "−8 %". */
export const formatChange = (format: Formatter, value: number) =>
  format.number(value, { style: "percent", maximumFractionDigits: Math.abs(value) < 0.1 ? 1 : 0, signDisplay: "exceptZero" });

/** Diferencia de CTR en puntos porcentuales, sin unidad: "+0,4". */
export const formatPoints = (format: Formatter, value: number) =>
  format.number(value * 100, { maximumFractionDigits: 1, minimumFractionDigits: 1, signDisplay: "exceptZero" });

/** Posiciones ganadas (+) o perdidas (−): "+1,2". */
export const formatPositionDelta = (format: Formatter, value: number) =>
  format.number(value, { maximumFractionDigits: 1, minimumFractionDigits: 1, signDisplay: "exceptZero" });

export const formatDay = (format: Formatter, date: string, long = false) =>
  format.dateTime(civilToDate(date), long ? DAY_LONG : DAY_SHORT);

export const formatRange = (format: Formatter, range: { from: string; to: string }) =>
  format.dateTimeRange(civilToDate(range.from), civilToDate(range.to), DAY_LONG);

/** "https://gnerai.com/servicios/seo/" → "/servicios/seo/"; "sc-domain:gnerai.com" → "gnerai.com". */
export function pagePath(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}` || "/";
  } catch {
    return url;
  }
}

export function siteName(siteUrl: string | null): string | null {
  if (!siteUrl) return null;
  return siteUrl.replace(/^sc-domain:/, "").replace(/^https?:\/\//, "").replace(/\/$/, "");
}

/** Si una variación es buena, mala o neutra (por debajo del umbral no se colorea). */
export type Tone = "good" | "bad" | "neutral";

export function toneOf(value: number | null, threshold: number, higherIsBetter = true): Tone {
  if (value === null || Math.abs(value) < threshold) return "neutral";
  return value > 0 === higherIsBetter ? "good" : "bad";
}
