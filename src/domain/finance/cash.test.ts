import { describe, expect, it } from "vitest";
import { estimateCashToday } from "./cash";
import { cashForecast } from "./forecast";

describe("caja de hoy", () => {
  it("último saldo de cada cuenta activa + cobros − pagos posteriores, emisor por emisor", () => {
    const cash = estimateCashToday(
      [
        { accountId: "sl-main", issuerId: "sl", isActive: true, balanceOn: "2026-08-31", balanceCents: 2_000_000 },
        { accountId: "sl-savings", issuerId: "sl", isActive: true, balanceOn: "2026-09-10", balanceCents: 500_000 },
        { accountId: "laia", issuerId: "laia", isActive: true, balanceOn: "2026-09-20", balanceCents: 300_000 },
        { accountId: "old", issuerId: "laia", isActive: false, balanceOn: "2026-09-25", balanceCents: 999_999 },
        { accountId: "new", issuerId: "laia", isActive: true, balanceOn: null, balanceCents: null },
      ],
      [
        { issuerId: "sl", on: "2026-09-05", cents: 400_000 }, // antes del saldo más reciente de la SL: ya está dentro
        { issuerId: "sl", on: "2026-09-15", cents: 121_000 },
        { issuerId: "sl", on: "2026-09-18", cents: -7_260 },
        { issuerId: "laia", on: "2026-09-20", cents: 50_000 }, // el mismo día del saldo: ya está dentro
        { issuerId: "laia", on: "2026-09-22", cents: -10_000 },
        { issuerId: "laia", on: "2026-09-27", cents: 80_000 }, // futuro
        { issuerId: "otro", on: "2026-09-22", cents: 1_000_000 }, // sin cuenta: no se sabe su caja
      ],
      "2026-09-26",
    );
    expect(cash).toEqual({
      recordedCents: 2_800_000,
      oldestOn: "2026-08-31",
      latestOn: "2026-09-20",
      movementsCents: 103_740,
      estimatedCents: 2_903_740,
      issuers: [
        { issuerId: "laia", recordedCents: 300_000, asOf: "2026-09-20", movementsCents: -10_000, estimatedCents: 290_000 },
        { issuerId: "sl", recordedCents: 2_500_000, asOf: "2026-09-10", movementsCents: 113_740, estimatedCents: 2_613_740 },
      ],
      activeAccounts: 4,
      accountsWithoutBalance: 1,
    });
  });

  it("sin cuentas, la caja es 0 y no se sabe de cuándo", () => {
    expect(estimateCashToday([], [{ issuerId: "sl", on: "2026-09-01", cents: 100 }], "2026-09-26")).toMatchObject({
      recordedCents: 0,
      estimatedCents: 0,
      oldestOn: null,
      latestOn: null,
      activeAccounts: 0,
    });
  });
});

describe("previsión de caja", () => {
  it("día a día: lo vencido cae hoy, lo que queda fuera del horizonte no entra, mínimo y primer negativo", () => {
    const forecast = cashForecast({
      today: "2026-09-26",
      days: 10,
      startCents: 100_000,
      flows: [
        { on: "2026-09-01", kind: "receivable", cents: 50_000, label: "vencida", refId: "i1", issuerId: "sl" },
        { on: "2026-09-28", kind: "expense", cents: -180_000, label: "freelance", refId: "e1", issuerId: "sl" },
        { on: "2026-10-01", kind: "subscription", cents: -7_260, label: "Adobe", refId: "s1", issuerId: "sl" },
        { on: "2026-10-03", kind: "billing", cents: 121_000, label: "cuota", refId: "c1", issuerId: "sl" },
        { on: "2026-10-06", kind: "vat", cents: -30_000, label: "2026-Q3", refId: "2026-Q3", issuerId: "sl" },
        { on: "2026-10-07", kind: "billing", cents: 999_999, label: "fuera", refId: "c2", issuerId: "sl" },
        { on: "2026-09-30", kind: "expense", cents: 0, label: "cero", refId: "e2", issuerId: "sl" },
      ],
    });
    expect(forecast).toMatchObject({
      from: "2026-09-26",
      until: "2026-10-06",
      startCents: 100_000,
      endCents: 53_740,
      minCents: -37_260,
      minOn: "2026-10-01",
      negativeOn: "2026-09-28",
      inflowsCents: 171_000,
      outflowsCents: 217_260,
      byKind: { receivable: 50_000, billing: 121_000, expense: -180_000, subscription: -7_260, vat: -30_000, withholding: 0 },
    });
    expect(forecast.points).toHaveLength(11);
    expect(forecast.points[0]).toEqual({ on: "2026-09-26", inflowCents: 50_000, outflowCents: 0, balanceCents: 150_000 });
    expect(forecast.flows.map((f) => [f.on, f.label, f.overdue])).toEqual([
      ["2026-09-26", "vencida", true],
      ["2026-09-28", "freelance", false],
      ["2026-10-01", "Adobe", false],
      ["2026-10-03", "cuota", false],
      ["2026-10-06", "2026-Q3", false],
    ]);
  });
});
