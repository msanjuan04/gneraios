import { describe, expect, it } from "vitest";
import { type CollectionEntry, sortCollections, summarizeCollections } from "./collections";

const entries: CollectionEntry[] = [
  { kind: "invoice", id: "p1", on: "2025-11-03", amountCents: 72_600 },
  { kind: "receipt", id: "r1", on: "2026-02-10", amountCents: 50_000 },
  { kind: "invoice", id: "p2", on: "2026-02-10", amountCents: 72_600 },
  { kind: "receipt", id: "r2", on: "2026-09-01", amountCents: -5_000 },
];

describe("summarizeCollections", () => {
  it("suma los cobros de facturas y los que no tienen factura, con las devoluciones", () => {
    expect(summarizeCollections(entries, "2026-09-27")).toEqual({
      totalCents: 190_200,
      invoicePaymentsCents: 145_200,
      receiptsCents: 45_000,
      thisYearCents: 117_600,
      count: 4,
      firstOn: "2025-11-03",
      lastOn: "2026-09-01",
    });
  });

  it("sin cobros, todo a cero y sin fechas", () => {
    expect(summarizeCollections([], "2026-09-27")).toEqual({
      totalCents: 0,
      invoicePaymentsCents: 0,
      receiptsCents: 0,
      thisYearCents: 0,
      count: 0,
      firstOn: null,
      lastOn: null,
    });
  });
});

describe("sortCollections", () => {
  it("de lo más reciente a lo más antiguo y estable a igual fecha", () => {
    expect(sortCollections(entries).map((e) => e.id)).toEqual(["r2", "r1", "p2", "p1"]);
  });
});
