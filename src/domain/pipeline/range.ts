// Date filter of the funnel. The URL carries civil dates (YYYY-MM-DD, both inclusive) that
// mean days in the org's time zone; the funnel functions compare instants, so a civil range
// becomes [start of `from`, start of the day after `to`) in that zone.

import type { DateRange } from "./funnel";

export type FunnelPreset = "last30" | "last90" | "thisYear" | "all";

/** In the order the filter bar shows them. */
export const FUNNEL_PRESETS: readonly FunnelPreset[] = ["last30", "last90", "thisYear", "all"];

/** Civil dates, both inclusive; null leaves that end open. */
export type CivilRange = { from: string | null; to: string | null };

const CIVIL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;
const EPOCH = "1970-01-01T00:00:00.000Z";

function civilParts(value: string): [number, number, number] | null {
  const match = CIVIL_DATE.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  // Date.UTC maps years 0–99 to 1900–1999, so they are not supported.
  if (year < 1000) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  const real = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return real ? [year, month, day] : null;
}

function requireCivil(value: string): [number, number, number] {
  const parts = civilParts(value);
  if (!parts) throw new Error(`La fecha no es válida (AAAA-MM-DD): «${value}».`);
  return parts;
}

/** True for a real calendar date written as YYYY-MM-DD (year 1000 or later). */
export function isCivilDate(value: unknown): value is string {
  return typeof value === "string" && civilParts(value) !== null;
}

/** The civil date `days` days after (or before, if negative) `date`. */
export function addDays(date: string, days: number): string {
  const [year, month, day] = requireCivil(date);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Time zones
// ---------------------------------------------------------------------------

const zoneFormatters = new Map<string, Intl.DateTimeFormat>();

function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = zoneFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    zoneFormatters.set(timeZone, formatter);
  }
  return formatter;
}

/** The zone's wall-clock time at `ms`, written as if it were UTC (whole seconds). */
function wallClock(ms: number, timeZone: string): number {
  const parts = zoneFormatter(timeZone).formatToParts(new Date(ms));
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
}

/** Offset of the zone at `ms` (wall clock − UTC), in milliseconds. */
function offsetAt(ms: number, timeZone: string): number {
  return wallClock(ms, timeZone) - Math.floor(ms / 1000) * 1000;
}

/**
 * First instant (ISO, UTC) of a civil date in a time zone: "2026-09-26" in Europe/Madrid is
 * "2026-09-25T22:00:00.000Z". When a DST change skips local midnight, the day starts at the
 * change. Throws on an invalid date or time zone.
 */
export function startOfDayInZone(date: string, timeZone: string): string {
  const [year, month, day] = requireCivil(date);
  const midnight = Date.UTC(year, month - 1, day);
  // The offsets in force a day before and a day after cover any DST change around midnight.
  const guesses = [midnight - DAY_MS, midnight, midnight + DAY_MS].map((probe) => midnight - offsetAt(probe, timeZone));
  const exact = guesses.filter((guess) => wallClock(guess, timeZone) === midnight).sort((a, b) => a - b);
  if (exact.length > 0) return new Date(exact[0]).toISOString();

  // Midnight falls in a gap: find the first second whose wall clock is already on `date`.
  let before = Math.min(...guesses);
  let after = Math.max(...guesses);
  if (!(wallClock(before, timeZone) < midnight && wallClock(after, timeZone) >= midnight)) {
    return new Date(midnight - offsetAt(midnight, timeZone)).toISOString();
  }
  while (after - before > 1000) {
    const middle = before + Math.floor((after - before) / 2000) * 1000;
    if (wallClock(middle, timeZone) >= midnight) after = middle;
    else before = middle;
  }
  return new Date(after).toISOString();
}

// ---------------------------------------------------------------------------
// Filter
// ---------------------------------------------------------------------------

/** The civil dates a preset covers on `today` (in the org's zone); `all` has no bounds. */
export function presetRange(preset: FunnelPreset, today: string): CivilRange {
  requireCivil(today);
  switch (preset) {
    case "last30":
      return { from: addDays(today, -29), to: today };
    case "last90":
      return { from: addDays(today, -89), to: today };
    case "thisYear":
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    case "all":
      return { from: null, to: null };
  }
}

/**
 * Reads ?from and ?to (a repeated parameter uses its first value). Anything that is not a real
 * YYYY-MM-DD date is ignored, and a reversed range is put the right way round.
 */
export function parseCivilRange(from: unknown, to: unknown): CivilRange {
  const read = (value: unknown) => {
    const first = Array.isArray(value) ? value[0] : value;
    return isCivilDate(first) ? first : null;
  };
  const start = read(from);
  const end = read(to);
  return start !== null && end !== null && start > end ? { from: end, to: start } : { from: start, to: end };
}

/** The preset that produces exactly this range on `today`, or null for a custom range. */
export function matchPreset(range: CivilRange, today: string): FunnelPreset | null {
  return (
    FUNNEL_PRESETS.find((preset) => {
      const candidate = presetRange(preset, today);
      return candidate.from === range.from && candidate.to === range.to;
    }) ?? null
  );
}

/**
 * The instants a civil range covers in the org's zone. With no bounds it is null (all time); an
 * open start runs from the epoch and an open end to the end of `today`.
 */
export function toDateRange(range: CivilRange, today: string, timeZone: string): DateRange {
  if (range.from === null && range.to === null) return null;
  return {
    from: range.from === null ? EPOCH : startOfDayInZone(range.from, timeZone),
    to: startOfDayInZone(addDays(range.to ?? today, 1), timeZone),
  };
}
