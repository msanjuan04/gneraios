import { describe, expect, it } from "vitest";
import { addMonths, isMonth, monthCutoff, monthEnd, monthOf, monthRange, monthsEndingAt, previousMonth } from "./months";

describe("meses", () => {
  it("un mes es su primer día; el último día respeta los bisiestos", () => {
    expect(monthOf("2026-09-26")).toBe("2026-09-01");
    expect(monthEnd("2026-02-01")).toBe("2026-02-28");
    expect(monthEnd("2028-02-01")).toBe("2028-02-29");
    expect(monthEnd("2026-12-01")).toBe("2026-12-31");
    expect(isMonth("2026-09-01")).toBe(true);
    expect(isMonth("2026-09-02")).toBe(false);
    expect(isMonth("2026-13-01")).toBe(false);
    expect(() => monthEnd("2026-09-15")).toThrow();
  });

  it("suma meses cruzando años y lista rangos en orden", () => {
    expect(addMonths("2026-01-01", -1)).toBe("2025-12-01");
    expect(addMonths("2025-11-01", 14)).toBe("2027-01-01");
    expect(previousMonth("2026-01-01")).toBe("2025-12-01");
    expect(monthRange("2025-11-01", "2026-02-01")).toEqual(["2025-11-01", "2025-12-01", "2026-01-01", "2026-02-01"]);
    expect(monthRange("2026-02-01", "2026-01-01")).toEqual([]);
    const last24 = monthsEndingAt("2026-09-01", 24);
    expect(last24).toHaveLength(24);
    expect(last24[0]).toBe("2024-10-01");
    expect(last24.at(-1)).toBe("2026-09-01");
  });

  it("la fecha de corte es el último día de un mes cerrado u hoy en el mes en curso", () => {
    expect(monthCutoff("2026-08-01", "2026-09-26")).toEqual({ asOf: "2026-08-31", closed: true });
    expect(monthCutoff("2026-09-01", "2026-09-26")).toEqual({ asOf: "2026-09-26", closed: false });
    // El último día del mes todavía está en curso.
    expect(monthCutoff("2026-09-01", "2026-09-30")).toEqual({ asOf: "2026-09-30", closed: false });
    expect(monthCutoff("2026-09-01", "2026-10-01")).toEqual({ asOf: "2026-09-30", closed: true });
    expect(() => monthCutoff("2026-10-01", "2026-09-26")).toThrow();
  });
});
