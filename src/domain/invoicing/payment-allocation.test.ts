import { describe, expect, it } from "vitest";
import { allocateReceived, allocationTotal, paidBeforeIssue } from "./payment-allocation";

const invoices = [
  { id: "a", outstandingCents: 48_400 },
  { id: "b", outstandingCents: 48_400 },
  { id: "c", outstandingCents: 12_100 },
];

describe("allocateReceived", () => {
  it("cubre las facturas de la más antigua a la más nueva", () => {
    expect(allocateReceived(96_800, invoices)).toEqual({
      allocations: [
        { invoiceId: "a", amountCents: 48_400 },
        { invoiceId: "b", amountCents: 48_400 },
      ],
      unallocatedCents: 0,
    });
  });

  it("deja la última a medias si no llega", () => {
    expect(allocateReceived(60_000, invoices)).toEqual({
      allocations: [
        { invoiceId: "a", amountCents: 48_400 },
        { invoiceId: "b", amountCents: 11_600 },
      ],
      unallocatedCents: 0,
    });
  });

  it("devuelve lo que sobra sin inventar cobros", () => {
    const result = allocateReceived(120_000, invoices);
    expect(allocationTotal(result.allocations)).toBe(108_900);
    expect(result.unallocatedCents).toBe(11_100);
  });

  it("se salta las que no tienen nada pendiente", () => {
    expect(
      allocateReceived(10_000, [
        { id: "paid", outstandingCents: 0 },
        { id: "credit", outstandingCents: -5_000 },
        { id: "open", outstandingCents: 20_000 },
      ]),
    ).toEqual({ allocations: [{ invoiceId: "open", amountCents: 10_000 }], unallocatedCents: 0 });
  });

  it("no reparte importes que no son enteros positivos", () => {
    for (const received of [0, -100, 1.5, Number.NaN]) {
      expect(allocateReceived(received, invoices)).toEqual({ allocations: [], unallocatedCents: 0 });
    }
  });

  it("sin facturas pendientes, todo sobra", () => {
    expect(allocateReceived(5_000, [])).toEqual({ allocations: [], unallocatedCents: 5_000 });
  });
});

describe("paidBeforeIssue", () => {
  it("avisa solo si el cobro es anterior a la factura", () => {
    expect(paidBeforeIssue("2026-09-01", "2026-09-15")).toBe(true);
    expect(paidBeforeIssue("2026-09-15", "2026-09-15")).toBe(false);
    expect(paidBeforeIssue("2026-10-02", "2026-09-15")).toBe(false);
    expect(paidBeforeIssue("2026-09-01", null)).toBe(false);
  });
});
