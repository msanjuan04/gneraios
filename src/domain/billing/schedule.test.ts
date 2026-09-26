import { describe, expect, it } from "vitest";
import { addDays, daysBetween, daysInMonth, parseCivilDate, type CivilDate } from "../dates/civil-date";
import {
  isLineActiveOn,
  nextBillingOn,
  periodAmountCents,
  periodsDue,
  type Pause,
  type Period,
  type RecurringLine,
} from "./schedule";

const NONE: ReadonlySet<CivilDate> = new Set();

const monthly = (overrides: Partial<RecurringLine> = {}): RecurringLine => ({
  billingType: "monthly",
  startsOn: "2026-01-01",
  endsOn: null,
  billingDay: 1,
  prorateFirst: true,
  ...overrides,
});

const yearly = (overrides: Partial<RecurringLine> = {}): RecurringLine => ({
  billingType: "yearly",
  startsOn: "2026-03-15",
  endsOn: null,
  billingDay: 1,
  prorateFirst: true,
  ...overrides,
});

/** A period billed in advance (billableOn = start). */
function period(start: CivilDate, end: CivilDate, cycle: [CivilDate, CivilDate], activeDays: number, cycleDays: number): Period {
  return { start, end, cycleStart: cycle[0], cycleEnd: cycle[1], activeDays, cycleDays, billableOn: start };
}

/** A full cycle with no pause: start…end is also the cycle. */
const full = (start: CivilDate, end: CivilDate) => {
  const days = daysBetween(start, end) + 1;
  return period(start, end, [start, end], days, days);
};

const starts = (periods: readonly Period[]) => periods.map((p) => p.start);

/** Deterministic PRNG (mulberry32), so the property-style tests are reproducible. */
function prng(seed: number) {
  let state = seed;
  const next = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  const pick = <T>(items: readonly T[]) => items[int(0, items.length - 1)];
  return { int, pick, chance: (p: number) => next() < p };
}

/**
 * Day-by-day model of ARCHITECTURE.md §7.2, written independently of the engine's cycle
 * arithmetic: a day is a billing date if it is the (clamped) billing day or anniversary, and
 * a new period starts on `startsOn` and on every billing date after it.
 */
function oraclePeriods(line: RecurringLine, pauses: readonly Pause[], today: CivilDate): Period[] {
  const { startsOn, endsOn } = line;
  const anchor = parseCivilDate(startsOn);
  const isBillingDate = (date: CivilDate) => {
    const { year, month, day } = parseCivilDate(date);
    return line.billingType === "monthly"
      ? day === Math.min(line.billingDay, daysInMonth(year, month))
      : month === anchor.month && day === Math.min(anchor.day, daysInMonth(year, month));
  };
  const isPaused = (date: CivilDate) =>
    pauses.some((pause) => pause.startsOn <= date && (pause.endsOn === null || date <= pause.endsOn));
  const nextBillingDate = (date: CivilDate) => {
    let day = addDays(date, 1);
    while (!isBillingDate(day)) day = addDays(day, 1);
    return day;
  };
  const billingDateOnOrBefore = (date: CivilDate) => {
    let day = date;
    while (!isBillingDate(day)) day = addDays(day, -1);
    return day;
  };

  const periods: Period[] = [];
  let start = startsOn;
  while (start <= today && (endsOn === null || start <= endsOn)) {
    const cycleEnd = addDays(nextBillingDate(start), -1);
    const cycleStart = start === startsOn && line.prorateFirst ? billingDateOnOrBefore(start) : start;
    const end = endsOn !== null && endsOn < cycleEnd ? endsOn : cycleEnd;
    let activeDays = 0;
    for (let day = start; day <= end; day = addDays(day, 1)) if (!isPaused(day)) activeDays += 1;
    const cycleDays = daysBetween(cycleStart, cycleEnd) + 1;
    if (activeDays > 0) periods.push({ start, end, cycleStart, cycleEnd, activeDays, cycleDays, billableOn: start });
    start = addDays(cycleEnd, 1);
  }
  return periods;
}

/** Random lines and pauses around 2026–2030, including the awkward cases on purpose. */
function randomCase(random: ReturnType<typeof prng>) {
  const startsOn = addDays("2026-01-01", random.int(0, 4 * 365));
  const billingType = random.chance(0.7) ? ("monthly" as const) : ("yearly" as const);
  const line: RecurringLine = {
    billingType,
    startsOn: random.chance(0.1) ? random.pick(["2028-02-29", "2027-01-31", "2028-01-30", "2027-12-31"]) : startsOn,
    endsOn: random.chance(0.5) ? null : addDays(startsOn, random.int(-10, 800)),
    billingDay: random.chance(0.5) ? random.pick([1, 28, 29, 30, 31]) : random.int(1, 31),
    prorateFirst: random.chance(0.5),
  };
  const pauses: Pause[] = Array.from({ length: random.pick([0, 0, 1, 1, 2, 3]) }, () => {
    const pauseStart = addDays(line.startsOn, random.int(-60, 900));
    return { startsOn: pauseStart, endsOn: random.chance(0.2) ? null : addDays(pauseStart, random.int(0, 120)) };
  });
  return { line, pauses };
}

describe("periodsDue · monthly", () => {
  it("prorates the first partial month: 500 € from 15 October with billing day 1 is 17/31", () => {
    const line = monthly({ startsOn: "2026-10-15" });
    const [first] = periodsDue(line, [], NONE, "2026-10-15");
    expect(first).toEqual(period("2026-10-15", "2026-10-31", ["2026-10-01", "2026-10-31"], 17, 31));
    expect(periodAmountCents(50000, first)).toBe(27419); // 274,19 €
    expect(periodsDue(line, [], NONE, "2026-10-14")).toEqual([]);
    expect(periodsDue(line, [], NONE, "2026-12-01")).toEqual([
      first,
      full("2026-11-01", "2026-11-30"),
      full("2026-12-01", "2026-12-31"),
    ]);
  });

  it("without proration, bills the first stub as a full cycle of its own", () => {
    const line = monthly({ startsOn: "2026-10-15", prorateFirst: false });
    const due = periodsDue(line, [], NONE, "2026-11-01");
    expect(due).toEqual([full("2026-10-15", "2026-10-31"), full("2026-11-01", "2026-11-30")]);
    expect(periodAmountCents(50000, due[0])).toBe(50000);
  });

  it("needs no proration when the line starts on its billing day", () => {
    for (const prorateFirst of [true, false]) {
      expect(periodsDue(monthly({ startsOn: "2026-10-01", prorateFirst }), [], NONE, "2026-10-01")).toEqual([
        full("2026-10-01", "2026-10-31"),
      ]);
    }
  });

  it("follows months of 28, 29, 30 and 31 days", () => {
    const due = periodsDue(monthly({ startsOn: "2027-01-01" }), [], NONE, "2028-04-01");
    expect(due).toHaveLength(16);
    const byStart = new Map(due.map((p) => [p.start, p]));
    expect(byStart.get("2027-01-01")).toEqual(full("2027-01-01", "2027-01-31"));
    expect(byStart.get("2027-02-01")).toEqual(full("2027-02-01", "2027-02-28"));
    expect(byStart.get("2027-04-01")).toEqual(full("2027-04-01", "2027-04-30"));
    expect(byStart.get("2028-02-01")).toEqual(full("2028-02-01", "2028-02-29"));
    expect(due.map((p) => p.cycleDays)).toEqual([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31, 31, 29, 31, 30]);
  });

  it("clamps billing day 31 to short months and returns to it without drift", () => {
    expect(periodsDue(monthly({ startsOn: "2027-01-31", billingDay: 31 }), [], NONE, "2027-06-01")).toEqual([
      full("2027-01-31", "2027-02-27"),
      full("2027-02-28", "2027-03-30"),
      full("2027-03-31", "2027-04-29"),
      full("2027-04-30", "2027-05-30"),
      full("2027-05-31", "2027-06-29"),
    ]);
    // 2028 is a leap year: 31 Jan → 29 Feb → 31 Mar.
    expect(periodsDue(monthly({ startsOn: "2028-01-31", billingDay: 31 }), [], NONE, "2028-03-31")).toEqual([
      full("2028-01-31", "2028-02-28"),
      full("2028-02-29", "2028-03-30"),
      full("2028-03-31", "2028-04-29"),
    ]);
  });

  it("clamps billing days 29 and 30 in February, in common and leap years", () => {
    expect(starts(periodsDue(monthly({ startsOn: "2027-01-30", billingDay: 30 }), [], NONE, "2027-04-30"))).toEqual([
      "2027-01-30", "2027-02-28", "2027-03-30", "2027-04-30",
    ]);
    expect(periodsDue(monthly({ startsOn: "2028-01-30", billingDay: 30 }), [], NONE, "2028-02-29")).toEqual([
      full("2028-01-30", "2028-02-28"),
      full("2028-02-29", "2028-03-29"),
    ]);
    expect(periodsDue(monthly({ startsOn: "2027-01-29", billingDay: 29 }), [], NONE, "2027-03-29")).toEqual([
      full("2027-01-29", "2027-02-27"),
      full("2027-02-28", "2027-03-28"),
      full("2027-03-29", "2027-04-28"),
    ]);
    expect(periodsDue(monthly({ startsOn: "2028-01-29", billingDay: 29 }), [], NONE, "2028-02-29")).toEqual([
      full("2028-01-29", "2028-02-28"),
      full("2028-02-29", "2028-03-28"),
    ]);
  });

  it("anchors a mid-month start on the billing day, with and without proration", () => {
    // Billing day 15, start on the 20th: the cycle runs 15 Oct–14 Nov.
    expect(periodsDue(monthly({ startsOn: "2026-10-20", billingDay: 15 }), [], NONE, "2026-11-15")).toEqual([
      period("2026-10-20", "2026-11-14", ["2026-10-15", "2026-11-14"], 26, 31),
      full("2026-11-15", "2026-12-14"),
    ]);
    // Start before the billing day of its month: the cycle began on 15 September.
    expect(periodsDue(monthly({ startsOn: "2026-10-05", billingDay: 15 }), [], NONE, "2026-10-15")).toEqual([
      period("2026-10-05", "2026-10-14", ["2026-09-15", "2026-10-14"], 10, 30),
      full("2026-10-15", "2026-11-14"),
    ]);
    expect(periodsDue(monthly({ startsOn: "2026-10-05", billingDay: 15, prorateFirst: false }), [], NONE, "2026-10-15")).toEqual([
      full("2026-10-05", "2026-10-14"),
      full("2026-10-15", "2026-11-14"),
    ]);
    // Billing day 31, start on 10 February 2027: the cycle is 31 Jan–27 Feb (28 days).
    expect(periodsDue(monthly({ startsOn: "2027-02-10", billingDay: 31 }), [], NONE, "2027-02-28")).toEqual([
      period("2027-02-10", "2027-02-27", ["2027-01-31", "2027-02-27"], 18, 28),
      full("2027-02-28", "2027-03-30"),
    ]);
    expect(periodsDue(monthly({ startsOn: "2027-02-10", billingDay: 31, prorateFirst: false }), [], NONE, "2027-02-10")).toEqual([
      full("2027-02-10", "2027-02-27"),
    ]);
  });
});

describe("periodsDue · yearly", () => {
  it("bills on each anniversary of the start date", () => {
    expect(periodsDue(yearly(), [], NONE, "2028-03-15")).toEqual([
      full("2026-03-15", "2027-03-14"),
      full("2027-03-15", "2028-03-14"), // 366 days: includes 29 February 2028
      full("2028-03-15", "2029-03-14"),
    ]);
    expect(periodsDue(yearly(), [], NONE, "2028-03-14")).toHaveLength(2);
  });

  it("moves a 29 February anniversary to 28 February in common years and back in leap years", () => {
    const due = periodsDue(yearly({ startsOn: "2028-02-29" }), [], NONE, "2032-03-01");
    expect(due).toEqual([
      full("2028-02-29", "2029-02-27"),
      full("2029-02-28", "2030-02-27"),
      full("2030-02-28", "2031-02-27"),
      full("2031-02-28", "2032-02-28"),
      full("2032-02-29", "2033-02-27"),
    ]);
    expect(due.map((p) => p.cycleDays)).toEqual([365, 365, 365, 366, 365]);
  });

  it("ignores billingDay and prorateFirst", () => {
    const expected = periodsDue(yearly(), [], NONE, "2030-01-01");
    for (const billingDay of [0, 1, 31, 99]) {
      for (const prorateFirst of [true, false]) {
        expect(periodsDue(yearly({ billingDay, prorateFirst }), [], NONE, "2030-01-01")).toEqual(expected);
      }
    }
  });

  it("prorates the last year when the line ends mid-cycle", () => {
    const due = periodsDue(yearly({ endsOn: "2027-09-14" }), [], NONE, "2030-01-01");
    expect(due).toEqual([
      full("2026-03-15", "2027-03-14"),
      period("2027-03-15", "2027-09-14", ["2027-03-15", "2028-03-14"], 184, 366),
    ]);
    expect(periodAmountCents(12000, due[1])).toBe(6033); // 60,3279 €
  });

  it("catches up several missed anniversaries", () => {
    expect(starts(periodsDue(yearly({ startsOn: "2024-06-01" }), [], NONE, "2026-09-26"))).toEqual([
      "2024-06-01", "2025-06-01", "2026-06-01",
    ]);
  });
});

describe("periodsDue · pauses", () => {
  const march = (activeDays: number) => period("2026-03-01", "2026-03-31", ["2026-03-01", "2026-03-31"], activeDays, 31);
  const dueInMarch = (pauses: Pause[]) => periodsDue(monthly(), pauses, NONE, "2026-06-01").find((p) => p.start === "2026-03-01");

  it("prorates a pause at the start, in the middle or at the end of a period", () => {
    expect(dueInMarch([{ startsOn: "2026-03-01", endsOn: "2026-03-10" }])).toEqual(march(21));
    expect(dueInMarch([{ startsOn: "2026-03-10", endsOn: "2026-03-19" }])).toEqual(march(21));
    expect(dueInMarch([{ startsOn: "2026-03-22", endsOn: "2026-03-31" }])).toEqual(march(21));
    expect(dueInMarch([{ startsOn: "2026-03-31", endsOn: "2026-03-31" }])).toEqual(march(30));
  });

  it("keeps the period start (the idempotency key) when a pause covers the first days", () => {
    expect(dueInMarch([{ startsOn: "2026-02-20", endsOn: "2026-03-05" }])?.billableOn).toBe("2026-03-01");
  });

  it("skips periods entirely inside a pause that spans several periods", () => {
    const due = periodsDue(monthly(), [{ startsOn: "2026-03-15", endsOn: "2026-05-10" }], NONE, "2026-06-01");
    expect(due).toEqual([
      full("2026-01-01", "2026-01-31"),
      full("2026-02-01", "2026-02-28"),
      march(14),
      period("2026-05-01", "2026-05-31", ["2026-05-01", "2026-05-31"], 21, 31),
      full("2026-06-01", "2026-06-30"),
    ]);
  });

  it("stops billing during an open-ended pause", () => {
    const pauses = [{ startsOn: "2026-03-15", endsOn: null }];
    expect(periodsDue(monthly(), pauses, NONE, "2027-12-01")).toEqual([
      full("2026-01-01", "2026-01-31"),
      full("2026-02-01", "2026-02-28"),
      march(14),
    ]);
    expect(periodsDue(monthly(), [{ startsOn: "2025-12-01", endsOn: null }], NONE, "2027-12-01")).toEqual([]);
  });

  it("counts overlapping and back-to-back pauses once", () => {
    const overlapping = [
      { startsOn: "2026-03-05", endsOn: "2026-03-15" },
      { startsOn: "2026-03-10", endsOn: "2026-03-20" },
      { startsOn: "2026-03-12", endsOn: "2026-03-14" },
    ];
    expect(dueInMarch(overlapping)).toEqual(march(15));
    const backToBack = [
      { startsOn: "2026-03-16", endsOn: "2026-03-31" },
      { startsOn: "2026-03-01", endsOn: "2026-03-15" },
    ];
    expect(dueInMarch(backToBack)).toBeUndefined();
    expect(dueInMarch([{ startsOn: "2026-03-20", endsOn: null }, { startsOn: "2026-03-01", endsOn: "2026-03-25" }])).toBeUndefined();
  });

  it("ignores pauses outside the service dates", () => {
    const line = monthly({ startsOn: "2026-03-01", endsOn: "2026-04-30" });
    const pauses = [
      { startsOn: "2026-01-01", endsOn: "2026-02-28" },
      { startsOn: "2026-05-01", endsOn: null },
    ];
    expect(periodsDue(line, pauses, NONE, "2026-12-01")).toEqual([march(31), full("2026-04-01", "2026-04-30")]);
  });

  it("prorates a pause inside a first stub billed as a full cycle", () => {
    const line = monthly({ startsOn: "2026-10-15", prorateFirst: false });
    const [first] = periodsDue(line, [{ startsOn: "2026-10-20", endsOn: "2026-10-25" }], NONE, "2026-10-31");
    expect(first).toEqual(period("2026-10-15", "2026-10-31", ["2026-10-15", "2026-10-31"], 11, 17));
  });

  it("skips a yearly period paused throughout", () => {
    const pauses = [{ startsOn: "2027-03-01", endsOn: "2028-03-20" }];
    expect(periodsDue(yearly(), pauses, NONE, "2028-12-31")).toEqual([
      period("2026-03-15", "2027-03-14", ["2026-03-15", "2027-03-14"], 351, 365),
      // 2027-03-15 → 2028-03-14 is skipped; the pause still covers 15–20 March 2028.
      period("2028-03-15", "2029-03-14", ["2028-03-15", "2029-03-14"], 359, 365),
    ]);
  });
});

describe("periodsDue · end of service", () => {
  it("prorates the last period when the line ends mid-period", () => {
    const due = periodsDue(monthly({ endsOn: "2026-03-20" }), [], NONE, "2026-12-01");
    expect(due).toEqual([
      full("2026-01-01", "2026-01-31"),
      full("2026-02-01", "2026-02-28"),
      period("2026-03-01", "2026-03-20", ["2026-03-01", "2026-03-31"], 20, 31),
    ]);
    expect(periodAmountCents(50000, due[2])).toBe(32258); // 322,5806 €
  });

  it("bills the last period in full when the line ends on its last day", () => {
    expect(starts(periodsDue(monthly({ endsOn: "2026-03-31" }), [], NONE, "2026-12-01"))).toEqual([
      "2026-01-01", "2026-02-01", "2026-03-01",
    ]);
    expect(periodsDue(monthly({ endsOn: "2026-03-31" }), [], NONE, "2026-12-01")[2]).toEqual(full("2026-03-01", "2026-03-31"));
  });

  it("prorates with any billing day", () => {
    expect(periodsDue(monthly({ startsOn: "2026-01-15", billingDay: 15, endsOn: "2026-03-20" }), [], NONE, "2026-12-01")).toEqual([
      full("2026-01-15", "2026-02-14"),
      full("2026-02-15", "2026-03-14"),
      period("2026-03-15", "2026-03-20", ["2026-03-15", "2026-04-14"], 6, 31),
    ]);
  });

  it("handles a line that starts and ends inside one cycle", () => {
    expect(periodsDue(monthly({ startsOn: "2026-10-15", endsOn: "2026-10-20" }), [], NONE, "2026-12-01")).toEqual([
      period("2026-10-15", "2026-10-20", ["2026-10-01", "2026-10-31"], 6, 31),
    ]);
    expect(periodsDue(monthly({ startsOn: "2026-10-15", endsOn: "2026-10-15" }), [], NONE, "2026-12-01")).toEqual([
      period("2026-10-15", "2026-10-15", ["2026-10-01", "2026-10-31"], 1, 31),
    ]);
  });

  it("never bills a line that ends before it starts (e.g. cancelled before starting)", () => {
    const line = monthly({ startsOn: "2026-10-15", endsOn: "2026-10-01" });
    expect(periodsDue(line, [], NONE, "2027-12-01")).toEqual([]);
    expect(nextBillingOn(line, [], "2026-09-01")).toBeNull();
    expect(isLineActiveOn(line, [], "2026-10-15")).toBe(false);
  });
});

describe("periodsDue · catch-up and idempotency", () => {
  it("returns every missed period, in order", () => {
    const billed = new Set(["2026-01-01", "2026-02-01"]);
    expect(starts(periodsDue(monthly(), [], billed, "2026-05-10"))).toEqual(["2026-03-01", "2026-04-01", "2026-05-01"]);
    const withGaps = new Set(["2026-01-01", "2026-03-01", "2026-05-01"]);
    expect(starts(periodsDue(monthly(), [], withGaps, "2026-05-10"))).toEqual(["2026-02-01", "2026-04-01"]);
  });

  it("never returns a billed period when run again", () => {
    const line = monthly({ startsOn: "2026-10-15", billingDay: 31 });
    const pauses = [{ startsOn: "2027-01-10", endsOn: "2027-02-05" }];
    const first = periodsDue(line, pauses, NONE, "2027-06-30");
    expect(first.length).toBeGreaterThan(0);
    const billed = new Set(starts(first));
    expect(periodsDue(line, pauses, billed, "2027-06-30")).toEqual([]);
    expect(periodsDue(line, pauses, billed, "2027-06-30")).toEqual([]);
    // Without new billed starts the result is the same every time: the function is pure.
    expect(periodsDue(line, pauses, NONE, "2027-06-30")).toEqual(first);
  });

  it("generates each period exactly once, on its billing day, when the cron runs daily", () => {
    const random = prng(7);
    for (let i = 0; i < 12; i++) {
      const { line, pauses } = randomCase(random);
      const billed = new Set<CivilDate>();
      const generated: CivilDate[] = [];
      for (let day = addDays(line.startsOn, -3); day <= addDays(line.startsOn, 800); day = addDays(day, 1)) {
        for (const due of periodsDue(line, pauses, billed, day)) {
          expect(due.billableOn, JSON.stringify({ line, pauses, day })).toBe(day);
          billed.add(due.start);
          generated.push(due.start);
        }
        expect(periodsDue(line, pauses, billed, day)).toEqual([]); // a second run the same day
      }
      expect(generated).toEqual(starts(periodsDue(line, pauses, NONE, addDays(line.startsOn, 800))));
    }
  });

  it("returns nothing for a line that starts in the future", () => {
    const line = monthly({ startsOn: "2026-11-15" });
    expect(periodsDue(line, [], NONE, "2026-09-26")).toEqual([]);
    expect(periodsDue(line, [], NONE, "2026-11-14")).toEqual([]);
    expect(periodsDue(line, [], NONE, "2026-11-15")).toEqual([
      period("2026-11-15", "2026-11-30", ["2026-11-01", "2026-11-30"], 16, 30),
    ]);
    expect(nextBillingOn(line, [], "2026-09-26")).toBe("2026-11-15");
    expect(isLineActiveOn(line, [], "2026-09-26")).toBe(false);
  });
});

describe("periodsDue · validation", () => {
  it("rejects billing days outside 1–31 on monthly lines", () => {
    for (const billingDay of [0, 32, -1, 1.5, Number.NaN]) {
      expect(() => periodsDue(monthly({ billingDay }), [], NONE, "2026-09-26"), String(billingDay)).toThrow(/día de facturación/);
    }
  });

  it("rejects lines that are not recurring", () => {
    const usage = { ...monthly(), billingType: "usage" } as unknown as RecurringLine;
    expect(() => periodsDue(usage, [], NONE, "2026-09-26")).toThrow(/recurrente/);
    expect(() => nextBillingOn(usage, [], "2026-09-26")).toThrow(/recurrente/);
  });

  it("rejects invalid dates", () => {
    expect(() => periodsDue(monthly({ startsOn: "2026-02-30" }), [], NONE, "2026-09-26")).toThrow(/Fecha no válida/);
    expect(() => periodsDue(monthly({ endsOn: "2026/12/31" }), [], NONE, "2026-09-26")).toThrow(/Fecha no válida/);
    expect(() => periodsDue(monthly(), [], NONE, "26-09-2026")).toThrow(/Fecha no válida/);
    expect(() => periodsDue(monthly(), [{ startsOn: "2026-13-01", endsOn: null }], NONE, "2026-09-26")).toThrow(/Fecha no válida/);
    // A billed start in another format would never match and bill the period twice.
    expect(() => periodsDue(monthly(), [], new Set(["2026-01-01T00:00:00.000Z"]), "2026-09-26")).toThrow(/Fecha no válida/);
  });

  it("rejects a pause that ends before it starts", () => {
    const pauses = [{ startsOn: "2026-03-10", endsOn: "2026-03-09" }];
    expect(() => periodsDue(monthly(), pauses, NONE, "2026-09-26")).toThrow(/pausa/);
    expect(() => nextBillingOn(monthly(), pauses, "2026-09-26")).toThrow(/pausa/);
    expect(() => isLineActiveOn(monthly(), pauses, "2026-09-26")).toThrow(/pausa/);
  });
});

describe("periodsDue · against a day-by-day model", () => {
  it("matches the model on random lines, pauses and dates", () => {
    const random = prng(2028);
    for (let i = 0; i < 400; i++) {
      const { line, pauses } = randomCase(random);
      const today = addDays(line.startsOn, random.int(-30, 1200));
      expect(periodsDue(line, pauses, NONE, today), JSON.stringify({ line, pauses, today })).toEqual(
        oraclePeriods(line, pauses, today),
      );
    }
  });
});

describe("nextBillingOn", () => {
  it("returns the next period start strictly after the date", () => {
    const line = monthly({ startsOn: "2026-10-15" });
    expect(nextBillingOn(line, [], "2026-10-01")).toBe("2026-10-15");
    expect(nextBillingOn(line, [], "2026-10-14")).toBe("2026-10-15");
    expect(nextBillingOn(line, [], "2026-10-15")).toBe("2026-11-01");
    expect(nextBillingOn(line, [], "2026-10-31")).toBe("2026-11-01");
    expect(nextBillingOn(line, [], "2026-11-01")).toBe("2026-12-01");
    expect(nextBillingOn(monthly({ startsOn: "2027-01-31", billingDay: 31 }), [], "2027-02-01")).toBe("2027-02-28");
    expect(nextBillingOn(monthly({ startsOn: "2027-02-10", billingDay: 31, prorateFirst: false }), [], "2027-02-10")).toBe("2027-02-28");
  });

  it("counts down to yearly renewals (60/30/7 days)", () => {
    expect(nextBillingOn(yearly(), [], "2027-01-14")).toBe("2027-03-15");
    expect(daysBetween("2027-01-14", "2027-03-15")).toBe(60);
    expect(nextBillingOn(yearly(), [], "2027-03-15")).toBe("2028-03-15");
    expect(nextBillingOn(yearly(), [], "2025-01-01")).toBe("2026-03-15");
    const leap = yearly({ startsOn: "2028-02-29" });
    expect(nextBillingOn(leap, [], "2028-02-29")).toBe("2029-02-28");
    expect(nextBillingOn(leap, [], "2031-03-01")).toBe("2032-02-29");
  });

  it("skips paused periods", () => {
    expect(nextBillingOn(monthly(), [{ startsOn: "2026-03-15", endsOn: "2026-05-10" }], "2026-03-01")).toBe("2026-05-01");
    expect(nextBillingOn(monthly(), [{ startsOn: "2026-03-01", endsOn: "2026-04-15" }], "2026-02-01")).toBe("2026-04-01");
    expect(nextBillingOn(yearly(), [{ startsOn: "2027-03-01", endsOn: "2028-03-20" }], "2026-12-01")).toBe("2028-03-15");
    // A pause that covers the start date but not the whole first period.
    expect(nextBillingOn(monthly({ startsOn: "2026-10-15" }), [{ startsOn: "2026-10-10", endsOn: "2026-10-20" }], "2026-10-01")).toBe(
      "2026-10-15",
    );
  });

  it("returns null when the line ends or stays paused for good", () => {
    expect(nextBillingOn(monthly({ endsOn: "2026-03-20" }), [], "2026-03-01")).toBeNull();
    expect(nextBillingOn(monthly({ endsOn: "2026-03-20" }), [], "2026-02-15")).toBe("2026-03-01");
    expect(nextBillingOn(monthly(), [{ startsOn: "2026-03-15", endsOn: null }], "2026-03-01")).toBeNull();
    expect(nextBillingOn(monthly(), [{ startsOn: "2026-03-15", endsOn: null }], "2026-02-15")).toBe("2026-03-01");
    expect(nextBillingOn(yearly(), [{ startsOn: "2026-03-15", endsOn: null }], "2020-01-01")).toBeNull();
  });

  it("jumps over long pauses without walking every cycle", () => {
    expect(nextBillingOn(monthly(), [{ startsOn: "2026-02-01", endsOn: "9998-06-30" }], "2026-01-15")).toBe("9998-07-01");
  });

  it("matches the day-by-day model", () => {
    const random = prng(60_30_7);
    for (let i = 0; i < 300; i++) {
      const { line, pauses } = randomCase(random);
      const after = addDays(line.startsOn, random.int(-30, 1200));
      const expected = oraclePeriods(line, pauses, addDays(after, 1600)).find((p) => p.start > after)?.start ?? null;
      expect(nextBillingOn(line, pauses, after), JSON.stringify({ line, pauses, after })).toBe(expected);
    }
  });
});

describe("periodAmountCents", () => {
  it("prorates by active days over cycle days", () => {
    expect(periodAmountCents(50000, { activeDays: 17, cycleDays: 31 })).toBe(27419); // 274,1935…
    expect(periodAmountCents(50000, { activeDays: 31, cycleDays: 31 })).toBe(50000);
    expect(periodAmountCents(50000, { activeDays: 0, cycleDays: 31 })).toBe(0);
    expect(periodAmountCents(50000, { activeDays: 14, cycleDays: 28 })).toBe(25000);
    expect(periodAmountCents(35000, { activeDays: 1, cycleDays: 29 })).toBe(1207); // 12,0689…
  });

  it("rounds half a cent away from zero, symmetrically", () => {
    expect(periodAmountCents(1, { activeDays: 1, cycleDays: 2 })).toBe(1);
    expect(periodAmountCents(-1, { activeDays: 1, cycleDays: 2 })).toBe(-1);
    expect(periodAmountCents(45, { activeDays: 1, cycleDays: 30 })).toBe(2); // 1,5
    expect(periodAmountCents(-45, { activeDays: 1, cycleDays: 30 })).toBe(-2);
    const random = prng(31);
    for (let i = 0; i < 2000; i++) {
      const cycleDays = random.int(1, 366);
      const days = { activeDays: random.int(0, cycleDays), cycleDays };
      const amount = random.int(0, 1e9);
      expect(periodAmountCents(-amount, days)).toBe(-periodAmountCents(amount, days) || 0);
    }
  });

  it("stays exact beyond 2^53", () => {
    // 9 007 199 254 740 991 × 30 / 31 = 8 716 644 440 071 926 + 24/31
    expect(periodAmountCents(Number.MAX_SAFE_INTEGER, { activeDays: 30, cycleDays: 31 })).toBe(8_716_644_440_071_927);
  });

  it("works with the periods the engine returns", () => {
    const [first] = periodsDue(monthly({ startsOn: "2027-02-10", billingDay: 31 }), [], NONE, "2027-02-10");
    expect(periodAmountCents(50000, first)).toBe(32143); // 18/28 → 321,4285…
  });

  it("rejects impossible day counts and non-integer amounts", () => {
    for (const days of [
      { activeDays: 32, cycleDays: 31 },
      { activeDays: -1, cycleDays: 31 },
      { activeDays: 0, cycleDays: 0 },
      { activeDays: 1.5, cycleDays: 31 },
      { activeDays: 1, cycleDays: Number.NaN },
    ]) {
      expect(() => periodAmountCents(50000, days), JSON.stringify(days)).toThrow(/Días del periodo/);
    }
    expect(() => periodAmountCents(500.5, { activeDays: 1, cycleDays: 31 })).toThrow(/céntimos/);
  });
});

describe("isLineActiveOn", () => {
  const line = monthly({ startsOn: "2026-03-01", endsOn: "2026-12-31" });
  const pauses = [{ startsOn: "2026-06-10", endsOn: "2026-06-20" }];

  it("is active from startsOn to endsOn, both inclusive", () => {
    expect(isLineActiveOn(line, [], "2026-02-28")).toBe(false);
    expect(isLineActiveOn(line, [], "2026-03-01")).toBe(true);
    expect(isLineActiveOn(line, [], "2026-12-31")).toBe(true);
    expect(isLineActiveOn(line, [], "2027-01-01")).toBe(false);
    expect(isLineActiveOn(monthly({ startsOn: "2026-03-01" }), [], "2099-12-31")).toBe(true);
  });

  it("is inactive on every day of a pause, both ends inclusive", () => {
    expect(isLineActiveOn(line, pauses, "2026-06-09")).toBe(true);
    expect(isLineActiveOn(line, pauses, "2026-06-10")).toBe(false);
    expect(isLineActiveOn(line, pauses, "2026-06-15")).toBe(false);
    expect(isLineActiveOn(line, pauses, "2026-06-20")).toBe(false);
    expect(isLineActiveOn(line, pauses, "2026-06-21")).toBe(true);
    const open = [{ startsOn: "2026-09-01", endsOn: null }];
    expect(isLineActiveOn(line, open, "2026-08-31")).toBe(true);
    expect(isLineActiveOn(line, open, "2026-09-01")).toBe(false);
    expect(isLineActiveOn(line, open, "2026-12-31")).toBe(false);
  });

  it("accepts any line with dates, not only recurring ones", () => {
    expect(isLineActiveOn({ startsOn: "2026-03-01", endsOn: null }, [], "2026-09-26")).toBe(true);
  });

  it("agrees with the billing engine: a period has active days exactly when the line is active on one of them", () => {
    const random = prng(64);
    for (let i = 0; i < 100; i++) {
      const { line: randomLine, pauses: randomPauses } = randomCase(random);
      const today = addDays(randomLine.startsOn, 900);
      for (const due of periodsDue(randomLine, randomPauses, NONE, today)) {
        let active = 0;
        for (let day = due.start; day <= due.end; day = addDays(day, 1)) {
          if (isLineActiveOn(randomLine, randomPauses, day)) active += 1;
        }
        expect(active).toBe(due.activeDays);
      }
    }
  });
});
