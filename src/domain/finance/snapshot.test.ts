import { describe, expect, it } from "vitest";
import { monthsEndingAt } from "../metrics/months";
import type { BillingCashEvent } from "./billing-cash";
import { buildFinanceSnapshot, type FinanceSnapshotInput } from "./snapshot";

const event = (patch: Partial<BillingCashEvent>): BillingCashEvent => ({
  contractId: "c1",
  kind: "recurring",
  lineId: "l1",
  milestoneId: null,
  itemId: null,
  billableOn: "2026-09-30",
  invoicedOn: "2026-09-30",
  collectedOn: "2026-10-30",
  issuerId: "sl",
  baseCents: 50_000,
  vatCents: 10_500,
  irpfCents: 0,
  totalCents: 60_500,
  ...patch,
});

function input(): FinanceSnapshotInput {
  return {
    today: "2026-09-26",
    months: monthsEndingAt("2026-09-01", 12),
    revenueRows: [
      { month: "2026-06-01", billingType: "monthly", baseCents: 700_000 },
      { month: "2026-07-01", billingType: "monthly", baseCents: 700_000 },
      { month: "2026-08-01", billingType: "monthly", baseCents: 650_000 },
      { month: "2026-09-01", billingType: "monthly", baseCents: 720_000 },
    ],
    expenseRows: [
      { month: "2026-06-01", expenseGroup: "operating", isFixed: true, costCents: 500_000 },
      { month: "2026-07-01", expenseGroup: "operating", isFixed: true, costCents: 500_000 },
      { month: "2026-07-01", expenseGroup: "cost_of_sales", isFixed: false, costCents: 100_000 },
      { month: "2026-08-01", expenseGroup: "operating", isFixed: true, costCents: 500_000 },
    ],
    outputVat: [
      { issuerId: "sl", on: "2026-07-01", cents: 100_000 },
      { issuerId: "sl", on: "2026-08-01", cents: 90_000 },
      { issuerId: "sl", on: "2026-09-01", cents: 95_000 },
      { issuerId: "laia", on: "2026-07-01", cents: 10_000 },
    ],
    inputVat: [
      { issuerId: "sl", on: "2026-07-01", cents: 20_000 },
      { issuerId: "sl", on: "2026-08-01", cents: 15_000 },
      { issuerId: "sl", on: "2026-09-01", cents: 18_000 },
    ],
    withholdings: [
      { issuerId: "sl", on: "2026-07-01", cents: 15_000 },
      { issuerId: "sl", on: "2026-08-01", cents: 15_000 },
      { issuerId: "sl", on: "2026-09-01", cents: 15_000 },
    ],
    accounts: [{ accountId: "a1", issuerId: "sl", isActive: true, balanceOn: "2026-08-31", balanceCents: 2_000_000, name: "Principal" }],
    movements: [
      { accountId: "a1", issuerId: "sl", on: "2026-09-10", cents: 300_000 },
      { accountId: "a1", issuerId: "sl", on: "2026-09-12", cents: -50_000 },
    ],
    subscriptions: [
      {
        id: "adobe",
        issuerId: "sl",
        vendorId: null,
        categoryId: "software",
        memberId: null,
        description: "Adobe",
        baseCents: 6_000,
        vatBps: 2100,
        vatDeductible: true,
        irpfBps: 0,
        interval: "monthly",
        startsOn: "2026-01-01",
        endsOn: null,
        billingDay: 1,
        paymentMethod: "card",
        isActive: true,
        allocation: "company",
        clientId: null,
        rebill: false,
        rebillMarkupBps: 0,
      },
    ],
    generatedStarts: new Map([
      ["adobe", new Set(["2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01", "2026-05-01", "2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01"])],
    ]),
    fixedCategoryIds: new Set(["software"]),
    pendingExpenses: [{ id: "e1", issuerId: "sl", label: "Freelance", payableOn: "2026-10-05", totalCents: 106_000 }],
    receivables: [
      { invoiceId: "i1", issuerId: "sl", number: "GS2026-0010", clientName: "Clínica", dueOn: "2026-10-10", outstandingCents: 121_000 },
      { invoiceId: "i2", issuerId: "sl", number: "GS2026-0005", clientName: "Gimnasio", dueOn: "2026-09-01", outstandingCents: 60_500 },
    ],
    billing: [event({}), event({ billableOn: "2026-10-01", invoicedOn: "2026-10-01", collectedOn: "2026-10-31" })],
    shareholdings: { validFrom: "2026-09-01", rows: [{ memberId: "m1", percentBps: 10_000 }] },
    contractLabels: new Map([["c1", "Clínica"]]),
  };
}

describe("foto financiera", () => {
  it("caja de hoy, burn, costes fijos y runway", () => {
    const snapshot = buildFinanceSnapshot(input());
    expect(snapshot.definitionVersion).toBe(1);
    expect(snapshot.cash).toMatchObject({ recordedCents: 2_000_000, movementsCents: 250_000, estimatedCents: 2_250_000 });
    expect(snapshot.burn).toMatchObject({ months: ["2026-06-01", "2026-07-01", "2026-08-01"], expensesCents: 533_333, fixedCents: 500_000 });
    expect(snapshot.fixedCosts).toEqual({ monthlyCents: 500_000, source: "history" });
    expect(snapshot.runwayMonths).toBe(4.5);
    expect(snapshot.months).toHaveLength(12);
    expect(snapshot.months.at(-1)).toMatchObject({ month: "2026-09-01", revenueCents: 720_000, expensesCents: 0 });
  });

  it("el IVA del trimestre suma lo emitido y lo que falta por facturar del trimestre; cada emisor paga lo suyo", () => {
    const { taxes } = buildFinanceSnapshot(input());
    expect(taxes.isEstimate).toBe(true);
    expect(taxes.quarters.map((q) => [q.key, q.dueOn, q.closed])).toEqual([["2026-Q3", "2026-10-20", false]]);
    const [q3] = taxes.quarters;
    expect(q3!.vat.issuers).toEqual([
      expect.objectContaining({ issuerId: "laia", outputVatCents: 10_000, inputVatCents: 0, payableCents: 10_000 }),
      expect.objectContaining({
        issuerId: "sl",
        outputVatCents: 295_500,
        forecastOutputVatCents: 10_500,
        inputVatCents: 53_000,
        payableCents: 242_500,
      }),
    ]);
    expect(q3!.withholdings.totalCents).toBe(45_000);
  });

  it("la previsión: cobros, gastos, cargos de suscripción e impuestos en su plazo", () => {
    const { forecast } = buildFinanceSnapshot(input());
    expect(forecast).toMatchObject({ from: "2026-09-26", until: "2026-12-25", startCents: 2_250_000 });
    const flows = forecast.flows.map((f) => [f.on, f.kind, f.cents, f.label, f.overdue]);
    expect(flows.slice(0, 6)).toEqual([
      ["2026-09-26", "receivable", 60_500, "GS2026-0005 · Gimnasio", true],
      ["2026-10-01", "subscription", -7_260, "Adobe", false],
      ["2026-10-05", "expense", -106_000, "Freelance", false],
      ["2026-10-10", "receivable", 121_000, "GS2026-0010 · Clínica", false],
      ["2026-10-20", "vat", -10_000, "2026-Q3", false],
      ["2026-10-20", "vat", -242_500, "2026-Q3", false],
    ]);
    expect(flows).toContainEqual(["2026-10-20", "withholding", -45_000, "2026-Q3", false]);
    expect(flows).toContainEqual(["2026-10-30", "billing", 60_500, "Clínica", false]);
    expect(forecast.byKind).toMatchObject({ vat: -252_500, withholding: -45_000, expense: -106_000, receivable: 181_500 });
    // Tres cargos de Adobe (octubre, noviembre y diciembre).
    expect(forecast.byKind.subscription).toBe(-21_780);
    expect(forecast.endCents).toBe(2_250_000 + forecast.inflowsCents - forecast.outflowsCents);
  });
});
