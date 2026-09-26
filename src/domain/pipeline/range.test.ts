import { describe, expect, it } from "vitest";
import {
  addDays,
  FUNNEL_PRESETS,
  isCivilDate,
  matchPreset,
  parseCivilRange,
  presetRange,
  startOfDayInZone,
  toDateRange,
} from "./range";

const MADRID = "Europe/Madrid";

describe("isCivilDate", () => {
  it("accepts real calendar dates written as YYYY-MM-DD", () => {
    for (const value of ["2026-09-26", "2028-02-29", "2026-12-31", "1000-01-01", "9999-12-31"]) {
      expect(isCivilDate(value), value).toBe(true);
    }
  });

  it("rejects everything else", () => {
    const invalid = [
      "2026-02-29", "2026-02-30", "2026-13-01", "2026-00-10", "2026-09-00", "2026-9-26", "26-09-2026",
      "2026/09/26", " 2026-09-26", "2026-09-26T00:00:00Z", "0999-12-31", "", null, undefined, 20260926, ["2026-09-26"],
    ];
    for (const value of invalid) expect(isCivilDate(value), JSON.stringify(value)).toBe(false);
  });
});

describe("addDays", () => {
  it("moves across months, years and leap days", () => {
    expect(addDays("2026-09-26", 0)).toBe("2026-09-26");
    expect(addDays("2026-09-26", 5)).toBe("2026-10-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-01-10", -29)).toBe("2025-12-12");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2027-02-28", 1)).toBe("2027-03-01");
    expect(addDays("2026-03-29", 1)).toBe("2026-03-30"); // DST in Madrid does not matter for civil dates
  });

  it("rejects an invalid date", () => {
    expect(() => addDays("2026-02-30", 1)).toThrow(/fecha/);
  });
});

describe("startOfDayInZone", () => {
  it("converts local midnight in Madrid, summer and winter", () => {
    expect(startOfDayInZone("2026-09-26", MADRID)).toBe("2026-09-25T22:00:00.000Z");
    expect(startOfDayInZone("2026-01-15", MADRID)).toBe("2026-01-14T23:00:00.000Z");
  });

  it("gives Madrid's DST days 23 and 25 hours", () => {
    // Clocks go forward at 02:00 on 29 March and back at 03:00 on 25 October 2026.
    expect(startOfDayInZone("2026-03-29", MADRID)).toBe("2026-03-28T23:00:00.000Z");
    expect(startOfDayInZone("2026-03-30", MADRID)).toBe("2026-03-29T22:00:00.000Z");
    expect(startOfDayInZone("2026-10-25", MADRID)).toBe("2026-10-24T22:00:00.000Z");
    expect(startOfDayInZone("2026-10-26", MADRID)).toBe("2026-10-25T23:00:00.000Z");
  });

  it("handles other offsets", () => {
    expect(startOfDayInZone("2026-09-26", "UTC")).toBe("2026-09-26T00:00:00.000Z");
    expect(startOfDayInZone("2026-09-26", "Asia/Kolkata")).toBe("2026-09-25T18:30:00.000Z");
    expect(startOfDayInZone("2026-09-26", "Pacific/Kiritimati")).toBe("2026-09-25T10:00:00.000Z");
    expect(startOfDayInZone("2026-09-26", "Pacific/Pago_Pago")).toBe("2026-09-26T11:00:00.000Z");
    expect(startOfDayInZone("2026-07-01", "America/New_York")).toBe("2026-07-01T04:00:00.000Z");
  });

  it("starts the day at the DST change when that change skips midnight", () => {
    // Chile jumps from 00:00 to 01:00 on 6 September 2026: the day starts at 01:00 (UTC−3).
    expect(startOfDayInZone("2026-09-06", "America/Santiago")).toBe("2026-09-06T04:00:00.000Z");
    // …and on 5 April 2026 goes back from 00:00 to 23:00, so Sunday starts after the repeated hour.
    expect(startOfDayInZone("2026-04-05", "America/Santiago")).toBe("2026-04-05T04:00:00.000Z");
    expect(startOfDayInZone("2026-09-05", "America/Santiago")).toBe("2026-09-05T04:00:00.000Z");
    expect(startOfDayInZone("2026-09-07", "America/Santiago")).toBe("2026-09-07T03:00:00.000Z");
  });

  it("rejects an invalid date or time zone", () => {
    expect(() => startOfDayInZone("2026-02-30", MADRID)).toThrow(/fecha/);
    expect(() => startOfDayInZone("2026-09-26", "Mars/Olympus")).toThrow(RangeError);
  });
});

describe("presetRange", () => {
  it("covers the last 30 and 90 days, including today", () => {
    expect(presetRange("last30", "2026-09-26")).toEqual({ from: "2026-08-28", to: "2026-09-26" });
    expect(presetRange("last90", "2026-09-26")).toEqual({ from: "2026-06-29", to: "2026-09-26" });
    expect(presetRange("last30", "2026-01-10")).toEqual({ from: "2025-12-12", to: "2026-01-10" });
  });

  it("covers this year up to today, or everything", () => {
    expect(presetRange("thisYear", "2026-09-26")).toEqual({ from: "2026-01-01", to: "2026-09-26" });
    expect(presetRange("thisYear", "2026-01-01")).toEqual({ from: "2026-01-01", to: "2026-01-01" });
    expect(presetRange("all", "2026-09-26")).toEqual({ from: null, to: null });
  });

  it("needs a valid today", () => {
    expect(() => presetRange("last30", "hoy")).toThrow(/fecha/);
  });

  it("lists the presets in the order the filter shows them", () => {
    expect(FUNNEL_PRESETS).toEqual(["last30", "last90", "thisYear", "all"]);
  });
});

describe("parseCivilRange", () => {
  it("keeps valid dates and drops the rest", () => {
    expect(parseCivilRange("2026-01-01", "2026-03-31")).toEqual({ from: "2026-01-01", to: "2026-03-31" });
    expect(parseCivilRange("2026-01-01", undefined)).toEqual({ from: "2026-01-01", to: null });
    expect(parseCivilRange(undefined, "2026-03-31")).toEqual({ from: null, to: "2026-03-31" });
    expect(parseCivilRange("2026-02-30", "")).toEqual({ from: null, to: null });
    expect(parseCivilRange(undefined, undefined)).toEqual({ from: null, to: null });
  });

  it("uses the first value of a repeated parameter", () => {
    expect(parseCivilRange(["2026-02-01", "2026-01-01"], ["x", "2026-03-01"])).toEqual({ from: "2026-02-01", to: null });
  });

  it("puts a reversed range the right way round", () => {
    expect(parseCivilRange("2026-03-31", "2026-01-01")).toEqual({ from: "2026-01-01", to: "2026-03-31" });
    expect(parseCivilRange("2026-03-31", "2026-03-31")).toEqual({ from: "2026-03-31", to: "2026-03-31" });
  });
});

describe("matchPreset", () => {
  it("recognises what each preset produces today", () => {
    for (const preset of FUNNEL_PRESETS) {
      expect(matchPreset(presetRange(preset, "2026-09-26"), "2026-09-26")).toBe(preset);
    }
  });

  it("returns null for a custom range, or one that was a preset on another day", () => {
    expect(matchPreset({ from: "2026-02-01", to: "2026-02-28" }, "2026-09-26")).toBeNull();
    expect(matchPreset(presetRange("last30", "2026-09-25"), "2026-09-26")).toBeNull();
    expect(matchPreset({ from: "2026-01-01", to: null }, "2026-09-26")).toBeNull();
  });
});

describe("toDateRange", () => {
  it("is all time without bounds", () => {
    expect(toDateRange({ from: null, to: null }, "2026-09-26", MADRID)).toBeNull();
  });

  it("runs from the start of `from` to the end of `to` in the org's zone", () => {
    expect(toDateRange({ from: "2026-08-28", to: "2026-09-26" }, "2026-09-26", MADRID)).toEqual({
      from: "2026-08-27T22:00:00.000Z",
      to: "2026-09-26T22:00:00.000Z",
    });
    // Across the October DST change: from CEST to CET.
    expect(toDateRange({ from: "2026-10-01", to: "2026-10-31" }, "2026-11-15", MADRID)).toEqual({
      from: "2026-09-30T22:00:00.000Z",
      to: "2026-10-31T23:00:00.000Z",
    });
    // A single day.
    expect(toDateRange({ from: "2026-09-26", to: "2026-09-26" }, "2026-09-26", "UTC")).toEqual({
      from: "2026-09-26T00:00:00.000Z",
      to: "2026-09-27T00:00:00.000Z",
    });
  });

  it("opens an unbounded start at the epoch and an unbounded end at the end of today", () => {
    expect(toDateRange({ from: "2026-01-01", to: null }, "2026-09-26", MADRID)).toEqual({
      from: "2025-12-31T23:00:00.000Z",
      to: "2026-09-26T22:00:00.000Z",
    });
    expect(toDateRange({ from: null, to: "2026-03-31" }, "2026-09-26", MADRID)).toEqual({
      from: "1970-01-01T00:00:00.000Z",
      to: "2026-03-31T22:00:00.000Z",
    });
  });
});
