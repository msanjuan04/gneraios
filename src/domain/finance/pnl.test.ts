import { describe, expect, it } from "vitest";
import { burn, fixedCosts, runwayMonths } from "./runway";
import { marginBps, monthlyPnl, type ExpenseMonthRow } from "./pnl";

const months = ["2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01"];

const revenue = [
  { month: "2026-06-01", billingType: "monthly" as const, baseCents: 500_000 },
  { month: "2026-06-01", billingType: "one_off" as const, baseCents: 300_000 },
  { month: "2026-07-01", billingType: "monthly" as const, baseCents: 520_000 },
  { month: "2026-08-01", billingType: "monthly" as const, baseCents: 480_000 },
  { month: "2026-08-01", billingType: "usage" as const, baseCents: 37_500 },
  { month: "2026-09-01", billingType: "monthly" as const, baseCents: 530_000 },
];

const expenses: ExpenseMonthRow[] = [
  { month: "2026-06-01", expenseGroup: "operating", isFixed: true, costCents: 150_000 },
  { month: "2026-06-01", expenseGroup: "cost_of_sales", isFixed: false, costCents: 200_000 },
  { month: "2026-06-01", expenseGroup: "partner_compensation", isFixed: true, costCents: 400_000 },
  { month: "2026-07-01", expenseGroup: "operating", isFixed: true, costCents: 160_000 },
  { month: "2026-07-01", expenseGroup: "partner_compensation", isFixed: true, costCents: 400_000 },
  // Agosto sin gastos registrados: es un mes sin datos, no un mes sin costes.
  { month: "2026-09-15", expenseGroup: "operating", isFixed: true, costCents: 90_000 },
];

describe("margen por mes", () => {
  it("ingresos por tipo, costes por grupo y fijos, margen y su porcentaje", () => {
    const pnl = monthlyPnl(revenue, expenses, months);
    expect(pnl[0]).toMatchObject({
      month: "2026-06-01",
      revenue: { recurringCents: 500_000, usageCents: 0, oneOffCents: 300_000 },
      revenueCents: 800_000,
      expensesCents: 750_000,
      fixedCents: 550_000,
      marginCents: 50_000,
      marginBps: 625,
      hasExpenses: true,
    });
    expect(pnl[0]!.byGroup).toMatchObject({ operating: 150_000, cost_of_sales: 200_000, partner_compensation: 400_000, payroll: 0 });
    expect(pnl[1]).toMatchObject({ revenueCents: 520_000, expensesCents: 560_000, marginCents: -40_000, marginBps: -769 });
    expect(pnl[2]).toMatchObject({ revenueCents: 517_500, expensesCents: 0, hasExpenses: false });
    // Un gasto con cualquier fecha del mes cuenta en su mes.
    expect(pnl[3]).toMatchObject({ expensesCents: 90_000, hasExpenses: true });
  });

  it("sin ingresos el porcentaje no existe", () => {
    expect(marginBps(-1000, 0)).toBeNull();
    expect(marginBps(1, 3)).toBe(3333);
  });
});

describe("burn, costes fijos y runway", () => {
  it("medias de los meses cerrados con gastos (el mes en curso no cuenta)", () => {
    const pnl = monthlyPnl(revenue, expenses, months);
    const result = burn(pnl, "2026-09-26");
    // Junio y julio (agosto no tiene gastos; septiembre está en curso).
    expect(result).toEqual({
      months: ["2026-06-01", "2026-07-01"],
      expensesCents: 655_000,
      fixedCents: 555_000,
      revenueCents: 660_000,
      marginCents: 5_000,
      netBurnCents: 0,
    });
    expect(burn(pnl, "2026-06-15")).toBeNull();
  });

  it("los costes fijos salen de la historia y, sin ella, de las suscripciones fijas", () => {
    const pnl = monthlyPnl(revenue, expenses, months);
    expect(fixedCosts(burn(pnl, "2026-09-26"), 99_999)).toEqual({ monthlyCents: 555_000, source: "history" });
    expect(fixedCosts(null, 120_000)).toEqual({ monthlyCents: 120_000, source: "subscriptions" });
    expect(fixedCosts(null, 0)).toEqual({ monthlyCents: 0, source: "none" });
  });

  it("el runway son meses de costes fijos cubiertos por la caja, con un decimal", () => {
    expect(runwayMonths(2_000_000, 555_000)).toBe(3.6);
    expect(runwayMonths(-10, 555_000)).toBe(0);
    expect(runwayMonths(2_000_000, 0)).toBeNull();
  });
});
