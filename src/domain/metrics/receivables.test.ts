import { describe, expect, it } from "vitest";
import { collectionStats, receivables } from "./receivables";

describe("pendiente de cobro", () => {
  it("suma lo no cobrado de las emitidas y separa lo vencido", () => {
    expect(
      receivables([
        { kind: "ordinary", status: "issued", outstandingCents: 95_400 },
        { kind: "ordinary", status: "overdue", outstandingCents: 45_400 },
        { kind: "ordinary", status: "overdue", outstandingCents: 10_000 },
        { kind: "ordinary", status: "paid", outstandingCents: 0 },
        { kind: "ordinary", status: "voided", outstandingCents: 0 },
        { kind: "ordinary", status: "draft", outstandingCents: 0 },
        // Una rectificativa emitida sale como «emitida» en invoices_overview, pero no se cobra.
        { kind: "rectifying", status: "issued", outstandingCents: 0 },
      ]),
    ).toEqual({ outstandingCents: 150_800, overdueCents: 55_400, openCount: 3, overdueCount: 2 });
  });

  it("sin facturas abiertas todo es 0", () => {
    expect(receivables([])).toEqual({ outstandingCents: 0, overdueCents: 0, openCount: 0, overdueCount: 0 });
  });
});

describe("cobros", () => {
  it("días medios hasta el cobro, puntualidad y retraso medio", () => {
    const stats = collectionStats([
      { issuedOn: "2026-06-02", dueOn: "2026-07-02", paidOn: "2026-06-30" }, // 28 días, en plazo
      { issuedOn: "2026-07-02", dueOn: "2026-08-01", paidOn: "2026-08-06" }, // 35 días, 5 tarde
      { issuedOn: "2026-08-02", dueOn: "2026-09-01", paidOn: "2026-09-10" }, // 39 días, 9 tarde
      { issuedOn: "2026-08-02", dueOn: null, paidOn: "2026-08-12" }, // 10 días, sin vencimiento
    ]);
    expect(stats).toEqual({ paidCount: 4, avgDaysToPay: 28, onTimeShare: 1 / 3, avgDaysLate: 7 });
  });

  it("sin cobros no hay medias", () => {
    expect(collectionStats([])).toEqual({ paidCount: 0, avgDaysToPay: null, onTimeShare: null, avgDaysLate: null });
  });
});
