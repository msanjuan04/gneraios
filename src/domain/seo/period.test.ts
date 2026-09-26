import { describe, expect, it } from "vitest";
import {
  comparisonRange,
  covers,
  eachDay,
  parseSeoComparison,
  parseSeoPeriod,
  periodEnd,
  periodRange,
  rangeDays,
  selectPeriod,
} from "./period";

describe("periodos", () => {
  it("28 días, 3 meses y 12 meses terminan en el último día con datos (incluido)", () => {
    expect(periodRange("28d", "2026-09-24")).toEqual({ from: "2026-08-28", to: "2026-09-24" });
    expect(periodRange("3m", "2026-09-24")).toEqual({ from: "2026-06-25", to: "2026-09-24" });
    expect(periodRange("12m", "2026-09-24")).toEqual({ from: "2025-09-25", to: "2026-09-24" });
    expect(rangeDays(periodRange("28d", "2026-03-01"))).toBe(28);
    // 3 meses desde un 31 de mayo: el 28 de febrero no existe el 31.
    expect(periodRange("3m", "2026-05-31")).toEqual({ from: "2026-03-01", to: "2026-05-31" });
  });

  it("compara con los mismos días justo antes o con las mismas semanas del año pasado", () => {
    const range = periodRange("28d", "2026-09-24");
    expect(comparisonRange(range, "previous", "28d")).toEqual({ from: "2026-07-31", to: "2026-08-27" });
    // 364 días: el mismo día de la semana.
    const year = comparisonRange(range, "year", "28d");
    expect(year).toEqual({ from: "2025-08-29", to: "2025-09-25" });
    expect(new Date(`${year.from}T12:00:00Z`).getUTCDay()).toBe(new Date(`${range.from}T12:00:00Z`).getUTCDay());
    // Con 12 meses, el periodo anterior ya es el año pasado.
    const twelve = periodRange("12m", "2026-09-24");
    expect(comparisonRange(twelve, "year", "12m")).toEqual(comparisonRange(twelve, "previous", "12m"));
    expect(comparisonRange(twelve, "previous", "12m")).toEqual({ from: "2024-09-25", to: "2025-09-24" });
  });

  it("el final es el último día con datos, nunca hoy", () => {
    expect(periodEnd("2026-09-26", "2026-09-23")).toBe("2026-09-23");
    expect(periodEnd("2026-09-26", "2026-09-26")).toBe("2026-09-25");
    expect(periodEnd("2026-09-26", null)).toBe("2026-09-25");
  });

  it("solo se compara si hay datos para todo el periodo de comparación", () => {
    const span = { first: "2025-05-27", last: "2026-09-24" };
    expect(covers(span, { from: "2025-05-27", to: "2025-06-30" })).toBe(true);
    expect(covers(span, { from: "2025-05-26", to: "2025-06-30" })).toBe(false);
    expect(covers(null, { from: "2026-01-01", to: "2026-01-02" })).toBe(false);

    const threeMonths = selectPeriod({ period: "3m", comparison: "year", today: "2026-09-26", span });
    expect(threeMonths).toMatchObject({ range: { from: "2026-06-25", to: "2026-09-24" }, comparable: true, days: 92 });
    const year = selectPeriod({ period: "12m", comparison: "previous", today: "2026-09-26", span });
    expect(year.comparable).toBe(false);
  });

  it("lee el periodo de la URL con valores por defecto", () => {
    expect(parseSeoPeriod("3m")).toBe("3m");
    expect(parseSeoPeriod(["12m", "3m"])).toBe("12m");
    expect(parseSeoPeriod("7d")).toBe("28d");
    expect(parseSeoPeriod(undefined)).toBe("28d");
    expect(parseSeoComparison("year")).toBe("year");
    expect(parseSeoComparison("otro")).toBe("previous");
  });

  it("recorre los días de un rango, cambios de mes y bisiestos incluidos", () => {
    expect(eachDay({ from: "2028-02-27", to: "2028-03-01" })).toEqual(["2028-02-27", "2028-02-28", "2028-02-29", "2028-03-01"]);
    expect(eachDay({ from: "2026-01-02", to: "2026-01-01" })).toEqual([]);
  });
});
