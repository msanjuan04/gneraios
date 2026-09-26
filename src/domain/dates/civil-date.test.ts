import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonthsClamped,
  compareCivil,
  daysBetween,
  daysInclusive,
  daysInMonth,
  formatCivil,
  isBefore,
  isLeapYear,
  maxCivil,
  minCivil,
  parseCivilDate,
} from "./civil-date";

describe("fechas civiles", () => {
  it("cuenta días sin depender de la zona ni del horario de verano", () => {
    // El 26 de octubre de 2025 hubo cambio de hora en Madrid: sigue siendo 1 día.
    expect(daysBetween("2025-10-25", "2025-10-26")).toBe(1);
    expect(daysBetween("2026-09-26", "2027-01-01")).toBe(97);
    expect(daysBetween("2026-03-01", "2026-02-28")).toBe(-1);
  });

  it("cruza años bisiestos correctamente", () => {
    expect(daysBetween("2028-02-28", "2028-03-01")).toBe(2);
    expect(daysBetween("2027-02-28", "2027-03-01")).toBe(1);
  });

  it("rechaza fechas imposibles", () => {
    expect(() => parseCivilDate("2027-02-29")).toThrow();
    expect(() => parseCivilDate("2026-13-01")).toThrow();
    expect(() => parseCivilDate("26/09/2026")).toThrow();
  });

  it("compara fechas", () => {
    expect(isBefore("2026-09-25", "2026-09-26")).toBe(true);
    expect(isBefore("2026-09-26", "2026-09-26")).toBe(false);
  });
});

describe("isLeapYear", () => {
  it("follows the Gregorian rule", () => {
    for (const year of [2024, 2028, 2000, 2400, 1996]) expect(isLeapYear(year), String(year)).toBe(true);
    for (const year of [2026, 2027, 2100, 1900, 2200, 2029]) expect(isLeapYear(year), String(year)).toBe(false);
  });

  it("rejects non-integer years", () => {
    expect(() => isLeapYear(2028.5)).toThrow(/año/);
    expect(() => isLeapYear(Number.NaN)).toThrow(/año/);
  });
});

describe("daysInMonth", () => {
  it("gives every month of a common year", () => {
    const lengths = Array.from({ length: 12 }, (_, i) => daysInMonth(2026, i + 1));
    expect(lengths).toEqual([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);
  });

  it("gives February 29 days only in leap years", () => {
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(2027, 2)).toBe(28);
    expect(daysInMonth(2100, 2)).toBe(28);
  });

  it("agrees with the calendar for every month of 1999–2101", () => {
    const failures: string[] = [];
    for (let year = 1999; year <= 2101; year++) {
      for (let month = 1; month <= 12; month++) {
        const expected = new Date(Date.UTC(year, month, 0)).getUTCDate();
        if (daysInMonth(year, month) !== expected) failures.push(`${year}-${month}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("rejects invalid months and years", () => {
    for (const month of [0, 13, -1, 1.5, Number.NaN]) {
      expect(() => daysInMonth(2026, month), String(month)).toThrow(/mes/i);
    }
    expect(() => daysInMonth(2026.5, 3)).toThrow(/año/);
  });
});

describe("formatCivil", () => {
  it("pads the parts", () => {
    expect(formatCivil({ year: 2026, month: 3, day: 5 })).toBe("2026-03-05");
    expect(formatCivil({ year: 2028, month: 2, day: 29 })).toBe("2028-02-29");
    expect(formatCivil({ year: 999, month: 12, day: 31 })).toBe("0999-12-31");
  });

  it("round-trips with parseCivilDate", () => {
    for (const value of ["2026-01-01", "2026-12-31", "2028-02-29", "2100-02-28", "9999-12-31", "0100-01-01"]) {
      expect(formatCivil(parseCivilDate(value))).toBe(value);
    }
  });

  it("rejects parts that are not a real date", () => {
    const invalid = [
      { year: 2027, month: 2, day: 29 },
      { year: 2026, month: 4, day: 31 },
      { year: 2026, month: 13, day: 1 },
      { year: 2026, month: 0, day: 1 },
      { year: 2026, month: 1, day: 0 },
      { year: 2026, month: 1.5, day: 1 },
      { year: 2026, month: 1, day: 1.5 },
      { year: 2026.5, month: 1, day: 1 },
      { year: -1, month: 1, day: 1 },
      { year: 50, month: 1, day: 1 }, // Date.UTC maps years 0–99 to 1900–1999
      { year: 10_000, month: 1, day: 1 },
      { year: Number.NaN, month: 1, day: 1 },
    ];
    for (const parts of invalid) expect(() => formatCivil(parts), JSON.stringify(parts)).toThrow(/Fecha no válida/);
  });
});

describe("addDays", () => {
  it("moves across months, years and leap days", () => {
    expect(addDays("2026-09-26", 0)).toBe("2026-09-26");
    expect(addDays("2026-09-26", 5)).toBe("2026-10-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
    expect(addDays("2026-01-10", -29)).toBe("2025-12-12");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2028-02-29", 1)).toBe("2028-03-01");
    expect(addDays("2027-02-28", 1)).toBe("2027-03-01");
    expect(addDays("2027-03-01", 365)).toBe("2028-02-29");
    expect(addDays("2028-01-01", 366)).toBe("2029-01-01");
  });

  it("ignores daylight saving changes", () => {
    expect(addDays("2026-03-28", 1)).toBe("2026-03-29");
    expect(addDays("2026-03-29", 1)).toBe("2026-03-30");
    expect(addDays("2026-10-25", 1)).toBe("2026-10-26");
  });

  it("is the inverse of daysBetween", () => {
    const failures: string[] = [];
    for (let n = -1500; n <= 1500; n += 7) {
      const moved = addDays("2027-06-15", n);
      if (daysBetween("2027-06-15", moved) !== n || addDays(moved, -n) !== "2027-06-15") failures.push(String(n));
    }
    expect(failures).toEqual([]);
  });

  it("walks one day at a time through every date of 2027–2028", () => {
    let date = "2026-12-31";
    const seen: string[] = [];
    for (let i = 0; i < 731; i++) {
      date = addDays(date, 1);
      seen.push(date);
    }
    expect(seen[0]).toBe("2027-01-01");
    expect(seen.at(-1)).toBe("2028-12-31");
    expect(seen).toContain("2028-02-29");
    expect(seen).not.toContain("2027-02-29");
    expect(new Set(seen).size).toBe(731);
  });

  it("rejects invalid dates, non-integer steps and results out of range", () => {
    expect(() => addDays("2026-02-30", 1)).toThrow(/Fecha no válida/);
    expect(() => addDays("2026-09-26", 1.5)).toThrow(/días/);
    expect(() => addDays("2026-09-26", Number.NaN)).toThrow(/días/);
    expect(() => addDays("9999-12-31", 1)).toThrow(/Fecha no válida/);
    expect(() => addDays("0100-01-01", -1)).toThrow(/Fecha no válida/);
  });
});

describe("addMonthsClamped", () => {
  it("clamps to the last day of shorter months", () => {
    expect(addMonthsClamped("2027-01-31", 1)).toBe("2027-02-28");
    expect(addMonthsClamped("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonthsClamped("2027-01-30", 1)).toBe("2027-02-28");
    expect(addMonthsClamped("2027-01-29", 1)).toBe("2027-02-28");
    expect(addMonthsClamped("2028-01-29", 1)).toBe("2028-02-29");
    expect(addMonthsClamped("2027-03-31", 1)).toBe("2027-04-30");
    expect(addMonthsClamped("2027-03-31", -1)).toBe("2027-02-28");
    expect(addMonthsClamped("2028-03-31", -1)).toBe("2028-02-29");
  });

  it("keeps the day when it exists", () => {
    expect(addMonthsClamped("2027-01-31", 2)).toBe("2027-03-31");
    expect(addMonthsClamped("2027-04-30", 1)).toBe("2027-05-30"); // the day of the input, not 31
    expect(addMonthsClamped("2026-10-15", 0)).toBe("2026-10-15");
    expect(addMonthsClamped("2026-10-15", 3)).toBe("2027-01-15");
  });

  it("crosses years in both directions", () => {
    expect(addMonthsClamped("2026-12-31", 2)).toBe("2027-02-28");
    expect(addMonthsClamped("2026-11-30", 14)).toBe("2028-01-30");
    expect(addMonthsClamped("2027-01-15", -1)).toBe("2026-12-15");
    expect(addMonthsClamped("2027-01-15", -13)).toBe("2025-12-15");
    expect(addMonthsClamped("2027-03-31", -25)).toBe("2025-02-28");
  });

  it("handles 29 February across years", () => {
    expect(addMonthsClamped("2028-02-29", 12)).toBe("2029-02-28");
    expect(addMonthsClamped("2028-02-29", 48)).toBe("2032-02-29");
    expect(addMonthsClamped("2028-02-29", -12)).toBe("2027-02-28");
    expect(addMonthsClamped("2028-02-29", 1)).toBe("2028-03-29");
  });

  it("does not remember the original day when chained", () => {
    expect(addMonthsClamped(addMonthsClamped("2027-01-31", 1), 1)).toBe("2027-03-28");
  });

  it("rejects invalid dates, non-integer steps and results out of range", () => {
    expect(() => addMonthsClamped("2027-02-29", 1)).toThrow(/Fecha no válida/);
    expect(() => addMonthsClamped("2027-01-31", 0.5)).toThrow(/meses/);
    expect(() => addMonthsClamped("9999-12-01", 1)).toThrow(/Fecha no válida/);
  });
});

describe("compareCivil / minCivil / maxCivil", () => {
  it("compares dates", () => {
    expect(compareCivil("2026-09-25", "2026-09-26")).toBe(-1);
    expect(compareCivil("2026-09-26", "2026-09-26")).toBe(0);
    expect(compareCivil("2026-09-27", "2026-09-26")).toBe(1);
    expect(compareCivil("2026-12-31", "2027-01-01")).toBe(-1);
    expect(compareCivil("2028-02-29", "2028-03-01")).toBe(-1);
  });

  it("sorts dates chronologically", () => {
    const dates = ["2027-01-01", "2026-12-31", "2028-02-29", "2026-01-15", "2026-01-02"];
    expect([...dates].sort(compareCivil)).toEqual(["2026-01-02", "2026-01-15", "2026-12-31", "2027-01-01", "2028-02-29"]);
  });

  it("picks the earliest and the latest date", () => {
    expect(minCivil("2026-09-26")).toBe("2026-09-26");
    expect(maxCivil("2026-09-26")).toBe("2026-09-26");
    expect(minCivil("2026-09-26", "2026-09-25")).toBe("2026-09-25");
    expect(maxCivil("2026-09-26", "2026-09-25")).toBe("2026-09-26");
    expect(minCivil("2027-01-01", "2026-12-31", "2028-02-29")).toBe("2026-12-31");
    expect(maxCivil("2027-01-01", "2026-12-31", "2028-02-29")).toBe("2028-02-29");
  });

  it("rejects invalid dates", () => {
    expect(() => compareCivil("2026-02-30", "2026-03-01")).toThrow(/Fecha no válida/);
    expect(() => compareCivil("2026-03-01", "2026/03/02")).toThrow(/Fecha no válida/);
    expect(() => minCivil("2026-02-30")).toThrow(/Fecha no válida/);
    expect(() => maxCivil("2026-03-01", "nope")).toThrow(/Fecha no válida/);
  });
});

describe("daysInclusive", () => {
  it("counts both ends", () => {
    expect(daysInclusive("2026-09-26", "2026-09-26")).toBe(1);
    expect(daysInclusive("2026-10-15", "2026-10-31")).toBe(17);
    expect(daysInclusive("2026-01-01", "2026-12-31")).toBe(365);
    expect(daysInclusive("2028-01-01", "2028-12-31")).toBe(366);
    expect(daysInclusive("2028-02-01", "2028-02-29")).toBe(29);
    expect(daysInclusive("2027-02-01", "2027-02-28")).toBe(28);
  });

  it("is 0 when the range is reversed", () => {
    expect(daysInclusive("2026-09-27", "2026-09-26")).toBe(0);
    expect(daysInclusive("2027-01-01", "2026-01-01")).toBe(0);
  });

  it("rejects invalid dates", () => {
    expect(() => daysInclusive("2026-02-30", "2026-03-01")).toThrow(/Fecha no válida/);
  });
});
