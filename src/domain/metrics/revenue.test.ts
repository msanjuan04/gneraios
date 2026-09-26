import { describe, expect, it } from "vitest";
import { changeRatio, revenueByMonth, revenueCategory, revenueTotal, type RevenueRow } from "./revenue";

describe("ingresos por mes", () => {
  it("separa recurrente (mensual + anual), uso y one-off, y rellena los meses sin facturas", () => {
    const rows: RevenueRow[] = [
      { month: "2026-08-02", billingType: "monthly", baseCents: 15_000 },
      { month: "2026-08-02", billingType: "yearly", baseCents: 120_000 },
      { month: "2026-08-15", billingType: "usage", baseCents: 37_500 },
      { month: "2026-08-20", billingType: "one_off", baseCents: 180_000 },
      { month: "2026-06-02", billingType: "monthly", baseCents: 9_000 },
    ];
    const [july, august] = revenueByMonth(rows, ["2026-07-01", "2026-08-01"]);
    expect(july).toEqual({ month: "2026-07-01", recurringCents: 0, usageCents: 0, oneOffCents: 0 });
    expect(august).toEqual({ month: "2026-08-01", recurringCents: 135_000, usageCents: 37_500, oneOffCents: 180_000 });
    expect(revenueTotal(august!)).toBe(352_500);
  });

  it("una rectificativa resta en su mes, no en el de la factura original", () => {
    const rows: RevenueRow[] = [
      { month: "2026-01-02", billingType: "usage", baseCents: 37_500 },
      { month: "2026-02-04", billingType: "usage", baseCents: -37_500 },
    ];
    const [jan, feb] = revenueByMonth(rows, ["2026-01-01", "2026-02-01"]);
    expect(jan!.usageCents).toBe(37_500);
    expect(feb!.usageCents).toBe(-37_500);
  });

  it("filas sueltas o agregadas dan lo mismo", () => {
    const lines: RevenueRow[] = [
      { month: "2026-03-02", billingType: "monthly", baseCents: 10_000 },
      { month: "2026-03-09", billingType: "monthly", baseCents: 5_000 },
    ];
    const aggregated: RevenueRow[] = [{ month: "2026-03-01", billingType: "monthly", baseCents: 15_000 }];
    expect(revenueByMonth(lines, ["2026-03-01"])).toEqual(revenueByMonth(aggregated, ["2026-03-01"]));
  });

  it("categorías y variaciones", () => {
    expect(revenueCategory("yearly")).toBe("recurring");
    expect(revenueCategory("one_off")).toBe("oneOff");
    expect(changeRatio(120, 100)).toBeCloseTo(0.2);
    expect(changeRatio(-50, -100)).toBeCloseTo(0.5);
    expect(changeRatio(10, 0)).toBeNull();
  });
});
