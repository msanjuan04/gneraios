import { describe, expect, it } from "vitest";
import { calendarDaysBetween, dateInZone, fromDateTimeLocal, toDateTimeLocal } from "./zoned-time";

const MADRID = "Europe/Madrid";

describe("toDateTimeLocal / dateInZone", () => {
  it("formats the wall clock of the zone, not of the machine", () => {
    expect(toDateTimeLocal(new Date("2026-09-26T12:30:00Z"), MADRID)).toBe("2026-09-26T14:30");
    expect(toDateTimeLocal(new Date("2026-01-10T23:15:00Z"), MADRID)).toBe("2026-01-11T00:15");
    expect(dateInZone(new Date("2026-12-31T23:30:00Z"), MADRID)).toBe("2027-01-01");
  });
});

describe("fromDateTimeLocal", () => {
  it("reads the wall clock in the zone, summer and winter", () => {
    expect(fromDateTimeLocal("2026-09-26T14:30", MADRID)?.toISOString()).toBe("2026-09-26T12:30:00.000Z");
    expect(fromDateTimeLocal("2026-01-11T00:15", MADRID)?.toISOString()).toBe("2026-01-10T23:15:00.000Z");
    expect(fromDateTimeLocal("2026-09-26T14:30:15", MADRID)?.toISOString()).toBe("2026-09-26T12:30:15.000Z");
  });

  it("round-trips with toDateTimeLocal", () => {
    for (const iso of ["2026-03-01T08:00:00Z", "2026-07-15T21:45:00Z", "2026-11-02T00:05:00Z"]) {
      const local = toDateTimeLocal(new Date(iso), MADRID);
      expect(fromDateTimeLocal(local, MADRID)?.toISOString()).toBe(new Date(iso).toISOString());
    }
  });

  it("moves a non-existent hour forward and takes the second of a repeated one", () => {
    // 29/03/2026: de 02:00 se pasa a 03:00. 25/10/2026: 02:00-03:00 se repite.
    expect(fromDateTimeLocal("2026-03-29T02:30", MADRID)?.toISOString()).toBe("2026-03-29T01:30:00.000Z");
    expect(fromDateTimeLocal("2026-10-25T02:30", MADRID)?.toISOString()).toBe("2026-10-25T01:30:00.000Z");
  });

  it("rejects malformed or impossible dates", () => {
    for (const value of ["", "2026-09-26", "2026-09-26 14:30", "2026-02-30T10:00", "2026-09-26T24:00", "26/09/2026T10:00"]) {
      expect(fromDateTimeLocal(value, MADRID), value).toBeNull();
    }
  });
});

describe("calendarDaysBetween", () => {
  it("counts calendar days in the zone", () => {
    const at = (iso: string) => new Date(iso);
    expect(calendarDaysBetween(at("2026-09-26T08:00:00Z"), at("2026-09-26T21:00:00Z"), MADRID)).toBe(0);
    // 23:30 UTC ya es el día siguiente en Madrid.
    expect(calendarDaysBetween(at("2026-09-26T08:00:00Z"), at("2026-09-26T23:30:00Z"), MADRID)).toBe(1);
    expect(calendarDaysBetween(at("2026-09-01T10:00:00Z"), at("2026-09-26T10:00:00Z"), MADRID)).toBe(25);
    expect(calendarDaysBetween(at("2026-03-28T12:00:00Z"), at("2026-03-30T12:00:00Z"), MADRID)).toBe(2);
    expect(calendarDaysBetween(at("2026-09-26T10:00:00Z"), at("2026-09-20T10:00:00Z"), MADRID)).toBe(0);
  });
});
