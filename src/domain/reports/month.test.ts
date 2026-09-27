import { describe, expect, it } from "vitest";
import {
  defaultReportMonth,
  inMonth,
  isReportableMonth,
  monthDays,
  monthInstants,
  parseReportMonth,
  recentReportMonths,
  reportMonthParam,
} from "./month";

describe("parseReportMonth", () => {
  it.each([
    ["2026-08", "2026-08-01"],
    [" 2026-12 ", "2026-12-01"],
    ["2000-01", "2000-01-01"],
  ])("%s → %s", (value, month) => {
    expect(parseReportMonth(value)).toBe(month);
  });

  it.each([["2026-13"], ["2026-00"], ["2026-8"], ["2026-08-01"], ["agosto"], [""], [202608], [null]])("rechaza %s", (value) => {
    expect(parseReportMonth(value)).toBeNull();
  });

  it("vuelve a la URL", () => {
    expect(reportMonthParam("2026-08-01")).toBe("2026-08");
  });
});

describe("meses que se ofrecen", () => {
  it("los 12 meses cerrados, del pasado hacia atrás", () => {
    const months = recentReportMonths("2026-09-26");
    expect(months).toHaveLength(12);
    expect(months[0]).toBe("2026-08-01");
    expect(months.at(-1)).toBe("2025-09-01");
  });

  it("en enero, el propuesto es diciembre del año anterior", () => {
    expect(defaultReportMonth("2026-01-10")).toBe("2025-12-01");
  });

  it("se puede pedir el mes en curso, no uno futuro", () => {
    expect(isReportableMonth("2026-09-01", "2026-09-26")).toBe(true);
    expect(isReportableMonth("2026-08-01", "2026-09-26")).toBe(true);
    expect(isReportableMonth("2026-10-01", "2026-09-26")).toBe(false);
    expect(isReportableMonth("2026-09-15", "2026-09-26")).toBe(false);
  });
});

describe("límites del mes", () => {
  it("días del mes, con febrero bisiesto", () => {
    expect(monthDays("2028-02-01")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(inMonth("2026-08-31", "2026-08-01")).toBe(true);
    expect(inMonth("2026-09-01", "2026-08-01")).toBe(false);
  });

  it("instantes en la zona de la org (verano)", () => {
    expect(monthInstants("2026-08-01", "Europe/Madrid")).toEqual({
      from: "2026-07-31T22:00:00.000Z",
      to: "2026-08-31T22:00:00.000Z",
    });
  });

  it("instantes con el cambio de hora dentro del mes", () => {
    expect(monthInstants("2026-03-01", "Europe/Madrid")).toEqual({
      from: "2026-02-28T23:00:00.000Z",
      to: "2026-03-31T22:00:00.000Z",
    });
  });
});
