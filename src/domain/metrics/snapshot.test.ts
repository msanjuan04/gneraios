import { describe, expect, it } from "vitest";
import { METRICS_DEFINITION_VERSION } from "./definitions";
import type { MetricsLine } from "./movements";
import { buildMonthSnapshot, countActiveClients, isLateSnapshot } from "./snapshot";

const line = (overrides: Partial<MetricsLine> = {}): MetricsLine => ({
  clientId: "a",
  signedOn: "2026-01-01",
  archivedOn: null,
  billingType: "monthly",
  quantity: "1",
  unitPriceCents: 60_000,
  discountBps: 0,
  startsOn: "2026-01-01",
  endsOn: null,
  pauses: [],
  ...overrides,
});

describe("foto mensual", () => {
  it("reúne todas las cifras del mes en su fecha de corte", () => {
    const snapshot = buildMonthSnapshot({
      month: "2026-08-01",
      asOf: "2026-08-31",
      lines: [
        line(),
        line({ clientId: "b", billingType: "yearly", unitPriceCents: 120_000, startsOn: "2026-08-01", signedOn: "2026-07-20" }),
        line({ clientId: "c", unitPriceCents: 25_000, endsOn: "2026-07-31" }),
      ],
      revenue: [
        { month: "2026-08-01", billingType: "monthly", baseCents: 60_000 },
        { month: "2026-08-01", billingType: "yearly", baseCents: 120_000 },
        { month: "2026-08-01", billingType: "usage", baseCents: 37_500 },
        { month: "2026-07-01", billingType: "one_off", baseCents: 999_999 },
      ],
      clientStatuses: [{ status: "active" }, { status: "active" }, { status: "former" }, { status: "paused" }],
      invoices: [
        { kind: "ordinary", status: "issued", outstandingCents: 72_600 },
        { kind: "ordinary", status: "overdue", outstandingCents: 30_250 },
      ],
      deals: [{ stageKind: "open", estOneOffCents: 400_000, estMrrCents: 50_000, probabilityBps: 5000 }],
      isEstimated: false,
    });
    expect(snapshot).toEqual({
      month: "2026-08-01",
      mrrCents: 70_000,
      arrCents: 840_000,
      newMrrCents: 10_000,
      expansionMrrCents: 0,
      contractionMrrCents: 0,
      churnMrrCents: 25_000,
      activeClients: 2,
      revenueRecurringCents: 180_000,
      revenueUsageCents: 37_500,
      revenueOneOffCents: 0,
      outstandingCents: 102_850,
      overdueCents: 30_250,
      weightedPipelineOneOffCents: 200_000,
      weightedPipelineMrrCents: 25_000,
      definitionVersion: METRICS_DEFINITION_VERSION,
      isEstimated: false,
    });
  });

  it("clientes activos y fotos tardías", () => {
    expect(countActiveClients([{ status: "active" }, { status: "lead" }, { status: "paused" }])).toBe(1);
    // El cierre es el día 1; hasta el 8 es la foto del cierre, después una reconstrucción.
    expect(isLateSnapshot("2026-08-01", "2026-09-01")).toBe(false);
    expect(isLateSnapshot("2026-08-01", "2026-09-08")).toBe(false);
    expect(isLateSnapshot("2026-08-01", "2026-09-09")).toBe(true);
  });
});
