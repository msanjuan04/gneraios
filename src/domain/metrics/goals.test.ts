import { describe, expect, it } from "vitest";
import { monthsLeft, mrrGoalProgress, readGoals, revenueGoalProgress } from "./goals";

describe("objetivos guardados", () => {
  it("lee los dos objetivos y descarta los incompletos", () => {
    expect(
      readGoals({ goals: { mrr_target_cents: 500_000, mrr_target_by: "2026-12-31", revenue_year_target_cents: 5_000_000, revenue_year: 2026 } }),
    ).toEqual({ mrr: { targetCents: 500_000, by: "2026-12-31" }, revenueYear: { targetCents: 5_000_000, year: 2026 } });
    expect(readGoals({ goals: { mrr_target_cents: 500_000 } })).toEqual({ mrr: null, revenueYear: null });
    expect(readGoals({ goals: { mrr_target_cents: -1, mrr_target_by: "2026-12-31" } }).mrr).toBeNull();
    expect(readGoals(null)).toEqual({ mrr: null, revenueYear: null });
  });
});

describe("meses que quedan", () => {
  it("cuenta el mes de la fecha si aún no ha acabado", () => {
    expect(monthsLeft("2026-09-26", "2026-12-31")).toBe(4);
    expect(monthsLeft("2026-09-26", "2026-09-30")).toBe(1);
    expect(monthsLeft("2026-09-26", "2026-10-15")).toBe(1);
    expect(monthsLeft("2026-09-26", "2026-09-01")).toBe(0);
  });
});

describe("objetivo de MRR", () => {
  const spark = [{ cents: 200_000 }, { cents: 230_000 }, { cents: 260_000 }, { cents: 291_000 }];

  it("dice cuánto hace falta al mes y si el ritmo llega", () => {
    const p = mrrGoalProgress({ targetCents: 400_000, by: "2026-12-31" }, 291_000, spark, "2026-09-26");
    expect(p.monthsLeft).toBe(4);
    expect(p.neededPerMonthCents).toBe(27_250);
    expect(p.paceCents).toBe(30_333);
    expect(p.status).toBe("on_track");
    expect(p.progressBps).toBe(7275);
    expect(p.projectedMonth).toBe("2026-12-01");
  });

  it("detecta que vamos por detrás, que ya se ha llegado o que se pasó la fecha", () => {
    expect(mrrGoalProgress({ targetCents: 600_000, by: "2026-12-31" }, 291_000, spark, "2026-09-26").status).toBe("behind");
    const reached = mrrGoalProgress({ targetCents: 250_000, by: "2026-12-31" }, 291_000, spark, "2026-09-26");
    expect(reached.status).toBe("reached");
    expect(reached.neededPerMonthCents).toBeNull();
    expect(mrrGoalProgress({ targetCents: 600_000, by: "2026-06-30" }, 291_000, spark, "2026-09-26").status).toBe("missed");
  });

  it("sin crecimiento no proyecta fecha", () => {
    const flat = mrrGoalProgress({ targetCents: 600_000, by: "2026-12-31" }, 291_000, [{ cents: 291_000 }, { cents: 291_000 }], "2026-09-26");
    expect(flat.paceCents).toBe(0);
    expect(flat.projectedMonth).toBeNull();
  });
});

describe("objetivo de facturación del año", () => {
  const history = [
    { month: "2025-12-01", recurringCents: 100_000, usageCents: 0, oneOffCents: 0 },
    { month: "2026-01-01", recurringCents: 200_000, usageCents: 10_000, oneOffCents: 300_000 },
    { month: "2026-02-01", recurringCents: 200_000, usageCents: 0, oneOffCents: -50_000 },
  ];
  const forecast = [
    { month: "2026-09-01", recurringCents: 100_000, oneOffCents: 0 },
    { month: "2026-12-01", recurringCents: 100_000, oneOffCents: 200_000 },
    { month: "2027-01-01", recurringCents: 100_000, oneOffCents: 0 },
  ];

  it("suma lo facturado del año (con rectificativas) y lo firmado que queda", () => {
    const p = revenueGoalProgress({ targetCents: 1_200_000, year: 2026 }, history, forecast, "2026-09-26");
    expect(p.invoicedCents).toBe(660_000);
    expect(p.signedCents).toBe(400_000);
    expect(p.projectedCents).toBe(1_060_000);
    expect(p.gapCents).toBe(140_000);
    expect(p.status).toBe("behind");
  });

  it("con lo firmado basta: en camino; y cumplido cuando lo facturado llega", () => {
    expect(revenueGoalProgress({ targetCents: 1_000_000, year: 2026 }, history, forecast, "2026-09-26").status).toBe("on_track");
    expect(revenueGoalProgress({ targetCents: 600_000, year: 2026 }, history, forecast, "2026-09-26").status).toBe("reached");
    expect(revenueGoalProgress({ targetCents: 5_000_000, year: 2025 }, history, forecast, "2026-09-26").status).toBe("missed");
  });
});
