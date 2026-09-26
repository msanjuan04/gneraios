import { describe, expect, it } from "vitest";
import { movementsHistory, mrrBridge, mrrHistory, type SnapshotLike } from "./history";
import type { MetricsLine } from "./movements";

const line = (overrides: Partial<MetricsLine> = {}): MetricsLine => ({
  clientId: "a",
  signedOn: "2026-01-01",
  archivedOn: null,
  billingType: "monthly",
  quantity: "1",
  unitPriceCents: 10_000,
  discountBps: 0,
  startsOn: "2026-01-01",
  endsOn: null,
  pauses: [],
  ...overrides,
});

const LINES = [
  line(),
  line({ clientId: "b", startsOn: "2026-07-01", signedOn: "2026-06-20", unitPriceCents: 40_000 }),
  line({ clientId: "c", endsOn: "2026-08-31", unitPriceCents: 5_000 }),
];
const TODAY = "2026-09-26";
const MONTHS = ["2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01"];

const snap = (month: string, overrides: Partial<SnapshotLike> = {}): SnapshotLike => ({
  month,
  mrrCents: 0,
  newMrrCents: 0,
  expansionMrrCents: 0,
  contractionMrrCents: 0,
  churnMrrCents: 0,
  isEstimated: false,
  ...overrides,
});

describe("histórico de MRR", () => {
  it("usa la foto de los meses cerrados, reconstruye los que no la tienen y el mes en curso es el de hoy", () => {
    const snapshots = new Map([["2026-07-01", snap("2026-07-01", { mrrCents: 55_000, newMrrCents: 40_000 })]]);
    const points = mrrHistory(MONTHS, snapshots, LINES, TODAY);
    expect(points.map((p) => [p.month, p.mrrCents, p.source, p.estimated])).toEqual([
      ["2026-06-01", 15_000, "rebuilt", true],
      ["2026-07-01", 55_000, "snapshot", false],
      ["2026-08-01", 55_000, "rebuilt", true],
      ["2026-09-01", 50_000, "current", false],
    ]);
  });

  it("los movimientos encadenan mes a mes y el puente cuadra con el MRR de hoy", () => {
    const history = movementsHistory(MONTHS, new Map(), LINES, TODAY);
    expect(history.map((m) => [m.month, m.startCents, m.newCents, m.churnCents, m.endCents, m.adjustmentCents])).toEqual([
      ["2026-06-01", 15_000, 0, 0, 15_000, 0],
      ["2026-07-01", 15_000, 40_000, 0, 55_000, 0],
      ["2026-08-01", 55_000, 0, 0, 55_000, 0],
      ["2026-09-01", 55_000, 0, 5_000, 50_000, 0],
    ]);
    const bridge = mrrBridge(history, 3);
    expect(bridge).toEqual({
      months: 3,
      startCents: 15_000,
      newCents: 40_000,
      expansionCents: 0,
      contractionCents: 0,
      churnCents: 5_000,
      adjustmentCents: 0,
      endCents: 50_000,
      estimated: true,
    });
  });

  it("una foto tomada con otros datos no descuadra el puente: la diferencia va a ajustes", () => {
    // La foto de julio se tomó antes de registrar una baja con efecto atrasado del cliente c.
    const snapshots = new Map([["2026-07-01", snap("2026-07-01", { mrrCents: 60_000, newMrrCents: 40_000, expansionMrrCents: 5_000 })]]);
    const history = movementsHistory(MONTHS, snapshots, LINES, TODAY);
    const august = history[2]!;
    expect(august).toMatchObject({ startCents: 60_000, endCents: 55_000, adjustmentCents: -5_000 });
    const bridge = mrrBridge(history, 4);
    expect(
      bridge.startCents + bridge.newCents + bridge.expansionCents - bridge.contractionCents - bridge.churnCents + bridge.adjustmentCents,
    ).toBe(bridge.endCents);
  });
});
