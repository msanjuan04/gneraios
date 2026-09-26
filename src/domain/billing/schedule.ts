// Recurring billing schedule (ARCHITECTURE.md §7.2): which periods of a monthly or yearly
// contract line are due on a given day. Pure and idempotent: the daily cron passes the
// period starts it has already stored (`billable_items.period_start`, including waived items)
// and gets back only what is missing, so a missed day is recovered on the next run.
//
// Rules:
// - Cycles. Monthly cycles start on `billingDay`, or on the last day of shorter months, and
//   return to it in longer months, without drift (31: 31 Jan → 28 Feb (29 in 2028) → 31 Mar →
//   30 Apr). Yearly cycles start on the anniversary of `startsOn` (29 Feb → 28 Feb in common
//   years). A cycle runs from its billing date to the day before the next one.
// - Periods. A period is a cycle intersected with [startsOn, endsOn]. `activeDays` are its days
//   outside every pause, `cycleDays` the length of the cycle; periods without active days are
//   skipped. Billing is in advance: a period is billable on its first day. The period start
//   never moves with pauses, so it is a stable key for the idempotency of the cron.
// - First period of a monthly line that starts off its billing day: with `prorateFirst` it is
//   the rest of the cycle, prorated (from 15 Oct with billing day 1: 17/31). Without it, it
//   runs from `startsOn` to the day before the next billing date and counts as a full cycle of
//   its own. Yearly lines always start on their billing date, so `prorateFirst` has no effect.
// - All dates are inclusive. The caller folds a cancellation into `endsOn`; a line whose
//   `endsOn` is before its `startsOn` never runs.

import {
  addDays,
  compareCivil,
  daysBetween,
  daysInclusive,
  daysInMonth,
  formatCivil,
  maxCivil,
  minCivil,
  parseCivilDate,
  type CivilDate,
} from "../dates/civil-date";
import { assertCents, divRoundHalfAwayFromZero, type Cents } from "../money";

export type RecurringBillingType = "monthly" | "yearly";

export type RecurringLine = {
  billingType: RecurringBillingType;
  /** First day of service. */
  startsOn: CivilDate;
  /** Last day of service (inclusive), or null while open-ended. */
  endsOn: CivilDate | null;
  /** 1–31, monthly only: the day of the month each cycle starts (the last day in shorter months). */
  billingDay: number;
  /** Monthly only: prorate the first cycle when `startsOn` is not a billing date. */
  prorateFirst: boolean;
};

/** Both days inclusive; `endsOn` null = paused until further notice. */
export type Pause = { startsOn: CivilDate; endsOn: CivilDate | null };

export type Period = {
  start: CivilDate;
  /** Inclusive. */
  end: CivilDate;
  cycleStart: CivilDate;
  /** Inclusive. */
  cycleEnd: CivilDate;
  /** Days of [start, end] outside every pause (> 0). */
  activeDays: number;
  /** Days of [cycleStart, cycleEnd]. */
  cycleDays: number;
  /** Billed in advance: the period's first day. */
  billableOn: CivilDate;
};

/** Cycles are numbered consecutively: month index (year × 12 + month − 1) or year. */
type Cadence = {
  /** First day (billing date) of cycle `index`. */
  startOf(index: number): CivilDate;
  /** Index of the cycle that contains `date`. */
  indexOf(date: CivilDate): number;
};

type Schedule = {
  line: RecurringLine;
  cadence: Cadence;
  firstIndex: number;
  /** Sorted, disjoint and not back to back. */
  pauses: Pause[];
};

function monthlyCadence(billingDay: number): Cadence {
  const startOf = (index: number) => {
    const year = Math.floor(index / 12);
    const month = index - year * 12 + 1;
    return formatCivil({ year, month, day: Math.min(billingDay, daysInMonth(year, month)) });
  };
  const indexOf = (date: CivilDate) => {
    const { year, month } = parseCivilDate(date);
    const index = year * 12 + month - 1;
    return compareCivil(date, startOf(index)) < 0 ? index - 1 : index;
  };
  return { startOf, indexOf };
}

function yearlyCadence(anchor: CivilDate): Cadence {
  const { month, day } = parseCivilDate(anchor);
  const startOf = (year: number) => formatCivil({ year, month, day: Math.min(day, daysInMonth(year, month)) });
  const indexOf = (date: CivilDate) => {
    const { year } = parseCivilDate(date);
    return compareCivil(date, startOf(year)) < 0 ? year - 1 : year;
  };
  return { startOf, indexOf };
}

function assertLine(line: RecurringLine): void {
  if (line.billingType !== "monthly" && line.billingType !== "yearly") {
    throw new Error(`La línea no es recurrente (monthly o yearly): ${String(line.billingType)}`);
  }
  parseCivilDate(line.startsOn);
  if (line.endsOn !== null) parseCivilDate(line.endsOn);
  const { billingDay } = line;
  if (line.billingType === "monthly" && !(Number.isInteger(billingDay) && billingDay >= 1 && billingDay <= 31)) {
    throw new Error(`El día de facturación debe ser un entero entre 1 y 31: ${String(billingDay)}`);
  }
}

function assertPause(pause: Pause): Pause {
  parseCivilDate(pause.startsOn);
  if (pause.endsOn !== null && compareCivil(pause.endsOn, pause.startsOn) < 0) {
    throw new Error(`La pausa termina antes de empezar: ${pause.startsOn} → ${pause.endsOn}`);
  }
  return pause;
}

function covers(pause: Pause, date: CivilDate): boolean {
  return compareCivil(pause.startsOn, date) <= 0 && (pause.endsOn === null || compareCivil(date, pause.endsOn) <= 0);
}

/** Overlapping or back-to-back pauses become a single run of paused days. */
function mergePauses(pauses: readonly Pause[]): Pause[] {
  const sorted = pauses.map(assertPause).sort((a, b) => compareCivil(a.startsOn, b.startsOn));
  const merged: Pause[] = [];
  for (const pause of sorted) {
    const last = merged.at(-1);
    if (last !== undefined && (last.endsOn === null || daysBetween(last.endsOn, pause.startsOn) <= 1)) {
      last.endsOn = last.endsOn === null || pause.endsOn === null ? null : maxCivil(last.endsOn, pause.endsOn);
    } else {
      merged.push({ startsOn: pause.startsOn, endsOn: pause.endsOn });
    }
  }
  return merged;
}

function pausedDays(pauses: readonly Pause[], start: CivilDate, end: CivilDate): number {
  let days = 0;
  for (const pause of pauses) {
    days += daysInclusive(maxCivil(start, pause.startsOn), pause.endsOn === null ? end : minCivil(end, pause.endsOn));
  }
  return days;
}

function buildSchedule(line: RecurringLine, pauses: readonly Pause[]): Schedule {
  assertLine(line);
  const cadence = line.billingType === "monthly" ? monthlyCadence(line.billingDay) : yearlyCadence(line.startsOn);
  return { line, cadence, firstIndex: cadence.indexOf(line.startsOn), pauses: mergePauses(pauses) };
}

/** The period of cycle `index` (possibly with 0 active days), or null once past `endsOn`. */
function periodAt({ line, cadence, firstIndex, pauses }: Schedule, index: number): Period | null {
  const billingDate = cadence.startOf(index);
  const cycleEnd = addDays(cadence.startOf(index + 1), -1);
  const isFirst = index === firstIndex;
  const start = isFirst ? line.startsOn : billingDate;
  const cycleStart = isFirst && !line.prorateFirst ? line.startsOn : billingDate;
  const end = line.endsOn === null ? cycleEnd : minCivil(cycleEnd, line.endsOn);
  if (compareCivil(start, end) > 0) return null;
  return {
    start,
    end,
    cycleStart,
    cycleEnd,
    activeDays: daysInclusive(start, end) - pausedDays(pauses, start, end),
    cycleDays: daysInclusive(cycleStart, cycleEnd),
    billableOn: start,
  };
}

/** Periods with active days, in order, from cycle `fromIndex` on. */
function* periodsFrom(schedule: Schedule, fromIndex: number): Generator<Period> {
  let index = Math.max(fromIndex, schedule.firstIndex);
  for (;;) {
    const period = periodAt(schedule, index);
    if (period === null) return;
    if (period.activeDays > 0) {
      yield period;
      index += 1;
      continue;
    }
    // Paused throughout: jump to the cycle in which the pause ends, or stop if it never does.
    const pause = schedule.pauses.find((candidate) => covers(candidate, period.start));
    if (pause !== undefined && pause.endsOn === null) return;
    const resumesOn = pause?.endsOn ? addDays(pause.endsOn, 1) : null;
    index = resumesOn === null ? index + 1 : Math.max(index + 1, schedule.cadence.indexOf(resumesOn));
  }
}

/**
 * Every period billable on or before `today` (billableOn ≤ today) whose start is not in
 * `billedStarts`, in order. Includes the periods of earlier days the cron missed.
 */
export function periodsDue(
  line: RecurringLine,
  pauses: readonly Pause[],
  billedStarts: ReadonlySet<CivilDate>,
  today: CivilDate,
): Period[] {
  const schedule = buildSchedule(line, pauses);
  parseCivilDate(today);
  // A start in another format ("2026-10-01T00:00:00Z") would never match and bill twice.
  for (const start of billedStarts) parseCivilDate(start);

  const due: Period[] = [];
  for (const period of periodsFrom(schedule, schedule.firstIndex)) {
    if (compareCivil(period.billableOn, today) > 0) break;
    if (!billedStarts.has(period.start)) due.push(period);
  }
  return due;
}

/**
 * The start of the first period that begins strictly after `after`, or null if there is none
 * (the line ends or stays paused for good). Renewal alerts (60/30/7 days) count down to it.
 */
export function nextBillingOn(line: RecurringLine, pauses: readonly Pause[], after: CivilDate): CivilDate | null {
  const schedule = buildSchedule(line, pauses);
  // Every period of the cycle containing `after` starts on or before it.
  const fromIndex =
    compareCivil(after, line.startsOn) < 0 ? schedule.firstIndex : schedule.cadence.indexOf(after) + 1;
  const next = periodsFrom(schedule, fromIndex).next();
  return next.done ? null : next.value.start;
}

/**
 * Amount of a period: round(full cycle amount × activeDays / cycleDays), half away from zero,
 * in exact integer arithmetic. 500 € for 17 of 31 days → 274,19 €.
 */
export function periodAmountCents(
  fullPeriodBaseCents: Cents,
  period: Pick<Period, "activeDays" | "cycleDays">,
): Cents {
  const { activeDays, cycleDays } = period;
  const valid =
    Number.isSafeInteger(activeDays) && Number.isSafeInteger(cycleDays) && activeDays >= 0 && activeDays <= cycleDays && cycleDays > 0;
  if (!valid) throw new Error(`Días del periodo no válidos: ${String(activeDays)}/${String(cycleDays)}`);
  const amount = BigInt(assertCents(fullPeriodBaseCents)) * BigInt(activeDays);
  return Number(divRoundHalfAwayFromZero(amount, BigInt(cycleDays)));
}

/**
 * Whether the line is in service on `date`: startsOn ≤ date, date ≤ endsOn (if any) and no
 * pause with startsOn ≤ date ≤ endsOn (if any). The SQL twin used by the list views applies
 * exactly this rule (ARCHITECTURE.md §6.4, parity test). It accepts any line with dates.
 */
export function isLineActiveOn(
  line: Pick<RecurringLine, "startsOn" | "endsOn">,
  pauses: readonly Pause[],
  date: CivilDate,
): boolean {
  parseCivilDate(line.startsOn);
  if (line.endsOn !== null) parseCivilDate(line.endsOn);
  for (const pause of pauses) assertPause(pause);
  if (compareCivil(date, line.startsOn) < 0) return false;
  if (line.endsOn !== null && compareCivil(date, line.endsOn) > 0) return false;
  return !pauses.some((pause) => covers(pause, date));
}
