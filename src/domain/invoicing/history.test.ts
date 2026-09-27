import { describe, expect, it } from "vitest";
import { buildHistory, type HistoryInvoice, nextPeriodKey, paymentBase, periodKey, periodStart, revenueOf } from "./history";

const invoice = (issuedOn: string, baseCents: number, extra: Partial<HistoryInvoice> = {}): HistoryInvoice => ({
  issuedOn,
  kind: "ordinary",
  baseCents,
  vatCents: Math.round(baseCents * 0.21),
  irpfCents: 0,
  totalCents: baseCents + Math.round(baseCents * 0.21),
  outstandingCents: 0,
  ...extra,
});

describe("periodos", () => {
  it("claves por año, trimestre y mes", () => {
    expect(periodKey("2026-09-27", "year")).toBe("2026");
    expect(periodKey("2026-09-27", "quarter")).toBe("2026-Q3");
    expect(periodKey("2026-10-01", "quarter")).toBe("2026-Q4");
    expect(periodKey("2026-09-27", "month")).toBe("2026-09");
  });

  it("primer día y periodo siguiente, también al cambiar de año", () => {
    expect(periodStart("2026", "year")).toBe("2026-01-01");
    expect(periodStart("2026-Q3", "quarter")).toBe("2026-07-01");
    expect(periodStart("2026-09", "month")).toBe("2026-09-01");
    expect(nextPeriodKey("2026", "year")).toBe("2027");
    expect(nextPeriodKey("2026-Q4", "quarter")).toBe("2027-Q1");
    expect(nextPeriodKey("2026-Q2", "quarter")).toBe("2026-Q3");
    expect(nextPeriodKey("2026-12", "month")).toBe("2027-01");
    expect(nextPeriodKey("2026-09", "month")).toBe("2026-10");
  });
});

describe("buildHistory", () => {
  it("sin actividad no hay filas", () => {
    expect(buildHistory({ invoices: [], payments: [], granularity: "year", until: "2026-09-27" })).toEqual({
      rows: [],
      totals: {
        invoices: 0,
        baseCents: 0,
        vatCents: 0,
        irpfCents: 0,
        totalCents: 0,
        collectedCents: 0,
        collectedBaseCents: 0,
        receiptsCents: 0,
        outstandingCents: 0,
        expensesCents: 0,
      },
    });
  });

  it("rellena los huecos hasta hoy y suma el total de todo el histórico", () => {
    const { rows, totals } = buildHistory({
      invoices: [invoice("2024-03-10", 100_000), invoice("2026-02-01", 50_000, { outstandingCents: 60_500 })],
      payments: [{ paidOn: "2024-04-02", amountCents: 121_000, baseCents: 100_000 }],
      granularity: "year",
      until: "2026-09-27",
    });
    expect(rows.map((r) => r.key)).toEqual(["2024", "2025", "2026"]);
    expect(rows[1]).toMatchObject({ invoices: 0, baseCents: 0, collectedCents: 0 });
    expect(rows[2]).toMatchObject({ invoices: 1, baseCents: 50_000, outstandingCents: 60_500 });
    expect(totals).toMatchObject({
      invoices: 2,
      baseCents: 150_000,
      totalCents: 181_500,
      collectedCents: 121_000,
      collectedBaseCents: 100_000,
      outstandingCents: 60_500,
    });
  });

  it("cuenta lo cobrado por la fecha de cobro, no por la de la factura", () => {
    const { rows } = buildHistory({
      invoices: [invoice("2026-06-30", 100_000)],
      payments: [{ paidOn: "2026-07-15", amountCents: 121_000, baseCents: 100_000 }],
      granularity: "quarter",
      until: "2026-09-27",
    });
    expect(rows.map((r) => [r.key, r.baseCents, r.collectedCents])).toEqual([
      ["2026-Q2", 100_000, 0],
      ["2026-Q3", 0, 121_000],
    ]);
  });

  it("las rectificativas restan en su periodo y no cuentan como factura", () => {
    const { rows } = buildHistory({
      invoices: [
        invoice("2026-08-05", 100_000, { outstandingCents: 121_000 }),
        invoice("2026-09-02", -100_000, { kind: "rectifying", outstandingCents: 0 }),
      ],
      payments: [],
      granularity: "month",
      until: "2026-09-27",
    });
    expect(rows.map((r) => [r.key, r.invoices, r.baseCents])).toEqual([
      ["2026-08", 1, 100_000],
      ["2026-09", 0, -100_000],
    ]);
  });

  it("los gastos del cliente van por la fecha de su factura", () => {
    const { rows, totals } = buildHistory({
      invoices: [invoice("2026-01-10", 100_000)],
      payments: [],
      expenses: [
        { issuedOn: "2026-01-20", baseCents: 20_000 },
        { issuedOn: "2026-03-01", baseCents: 5_000 },
      ],
      granularity: "month",
      until: "2026-03-15",
    });
    expect(rows.map((r) => [r.key, r.expensesCents])).toEqual([
      ["2026-01", 20_000],
      ["2026-02", 0],
      ["2026-03", 5_000],
    ]);
    expect(totals.expensesCents).toBe(25_000);
  });

  it("no cuenta en negativo lo pendiente de una factura cobrada de más", () => {
    const { totals } = buildHistory({
      invoices: [invoice("2026-09-01", 10_000, { outstandingCents: -500 })],
      payments: [],
      granularity: "year",
      until: "2026-09-27",
    });
    expect(totals.outstandingCents).toBe(0);
  });
});

describe("paymentBase", () => {
  it("reparte el cobro en la misma proporción que la factura", () => {
    // Base 1.000 €, IVA 21 %, IRPF 15 %: total 1.060 €.
    expect(paymentBase(106_000, 100_000, 106_000)).toBe(100_000);
    expect(paymentBase(53_000, 100_000, 106_000)).toBe(50_000);
    expect(paymentBase(121_00, 100_00, 121_00)).toBe(100_00);
  });

  it("una factura a 0 no aporta base", () => {
    expect(paymentBase(1_000, 0, 0)).toBe(0);
  });
});

describe("cobros sin factura", () => {
  it("cuentan enteros como cobrado e ingreso, y abren el histórico aunque no haya facturas", () => {
    const { rows, totals } = buildHistory({
      invoices: [],
      payments: [],
      receipts: [
        { receivedOn: "2026-07-03", amountCents: 80_000 },
        { receivedOn: "2026-09-10", amountCents: 80_000 },
        { receivedOn: "2026-09-20", amountCents: -10_000 },
      ],
      expenses: [{ issuedOn: "2026-09-01", baseCents: 30_000 }],
      granularity: "month",
      until: "2026-09-27",
    });
    expect(rows.map((r) => [r.key, r.receiptsCents, r.collectedCents, r.collectedBaseCents])).toEqual([
      ["2026-07", 80_000, 80_000, 80_000],
      ["2026-08", 0, 0, 0],
      ["2026-09", 70_000, 70_000, 70_000],
    ]);
    expect(totals).toMatchObject({ invoices: 0, baseCents: 0, receiptsCents: 150_000, expensesCents: 30_000 });
    expect(revenueOf(totals) - totals.expensesCents).toBe(120_000);
  });
});
