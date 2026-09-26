import { describe, expect, it } from "vitest";
import { mrrMovements, orgMrrCents, type MetricsLine, type MrrMovements } from "./movements";

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

/** El puente cuadra al céntimo. */
function expectBridge(m: MrrMovements) {
  expect(m.startCents + m.newCents + m.expansionCents - m.contractionCents - m.churnCents).toBe(m.endCents);
  for (const value of [m.newCents, m.expansionCents, m.contractionCents, m.churnCents]) expect(value).toBeGreaterThanOrEqual(0);
}

describe("MRR de la org", () => {
  it("solo cuentan los contratos firmados en la fecha y no archivados", () => {
    const lines = [
      line({ unitPriceCents: 10_000 }),
      line({ clientId: "b", signedOn: "2026-03-10", startsOn: "2026-03-01", unitPriceCents: 5_000 }),
      line({ clientId: "c", archivedOn: "2026-06-15", unitPriceCents: 2_000 }),
    ];
    expect(orgMrrCents(lines, "2026-03-09")).toBe(12_000);
    expect(orgMrrCents(lines, "2026-03-10")).toBe(17_000);
    expect(orgMrrCents(lines, "2026-06-14")).toBe(17_000);
    expect(orgMrrCents(lines, "2026-06-15")).toBe(15_000);
  });
});

describe("movimientos de MRR", () => {
  it("un cliente nuevo es MRR nuevo; una baja es churn", () => {
    const lines = [line(), line({ clientId: "b", startsOn: "2026-02-10", endsOn: "2026-04-30", unitPriceCents: 30_000 })];
    const feb = mrrMovements(lines, "2026-01-31", "2026-02-28");
    expect(feb).toMatchObject({ startCents: 10_000, newCents: 30_000, churnCents: 0, endCents: 40_000 });
    const may = mrrMovements(lines, "2026-04-30", "2026-05-31");
    expect(may).toMatchObject({ startCents: 40_000, churnCents: 30_000, newCents: 0, endCents: 10_000 });
    expectBridge(feb);
    expectBridge(may);
  });

  it("una versión nueva de la línea (subida de precio) es expansión, no churn + nuevo", () => {
    const v1 = line({ unitPriceCents: 45_000, endsOn: "2025-12-31", startsOn: "2025-04-15", signedOn: "2025-04-10" });
    const v2 = line({ unitPriceCents: 49_000, startsOn: "2026-01-01", signedOn: "2025-04-10" });
    const jan = mrrMovements([v1, v2], "2025-12-31", "2026-01-31");
    expect(jan).toEqual({
      startCents: 45_000,
      newCents: 0,
      expansionCents: 4_000,
      contractionCents: 0,
      churnCents: 0,
      endCents: 49_000,
    });
    // Y una bajada, contracción.
    const down = mrrMovements([v1, { ...v2, unitPriceCents: 40_000 }], "2025-12-31", "2026-01-31");
    expect(down).toMatchObject({ contractionCents: 5_000, churnCents: 0, newCents: 0 });
  });

  it("vender otra línea a un cliente que ya paga es expansión", () => {
    const lines = [line(), line({ startsOn: "2026-03-01", billingType: "yearly", unitPriceCents: 24_000 })];
    expect(mrrMovements(lines, "2026-02-28", "2026-03-31")).toMatchObject({ newCents: 0, expansionCents: 2_000 });
  });

  it("pausar todo lo de un cliente es contracción y volver de la pausa, expansión", () => {
    const paused = line({ unitPriceCents: 60_000, pauses: [{ startsOn: "2026-07-01", endsOn: "2026-08-31" }] });
    const july = mrrMovements([paused], "2026-06-30", "2026-07-31");
    expect(july).toMatchObject({ contractionCents: 60_000, churnCents: 0, endCents: 0 });
    const september = mrrMovements([paused], "2026-08-31", "2026-09-30");
    expect(september).toMatchObject({ expansionCents: 60_000, newCents: 0, startCents: 0, endCents: 60_000 });
    // Pausar una de dos líneas también es contracción.
    const hosting = line({ billingType: "yearly", unitPriceCents: 24_000 });
    expect(mrrMovements([paused, hosting], "2026-06-30", "2026-07-31")).toMatchObject({ contractionCents: 60_000, endCents: 2_000 });
  });

  it("un ex-cliente que vuelve con otro contrato cuenta como nuevo", () => {
    const lines = [line({ endsOn: "2026-02-28" }), line({ startsOn: "2026-06-01", signedOn: "2026-05-20", unitPriceCents: 20_000 })];
    expect(mrrMovements(lines, "2026-05-31", "2026-06-30")).toMatchObject({ newCents: 20_000, expansionCents: 0 });
  });

  it("uso y one-off no mueven el MRR", () => {
    const lines = [line({ billingType: "usage", startsOn: null }), line({ billingType: "one_off", startsOn: null, clientId: "b" })];
    expect(mrrMovements(lines, "2026-01-31", "2026-02-28")).toMatchObject({ startCents: 0, newCents: 0, endCents: 0 });
  });

  it("con anuales que no dividen entre 12 el puente sigue cuadrando al céntimo", () => {
    // 100,00 €/año = 833,33 €/mes... en céntimos: 833,33 y 833,42.
    const lines = [
      line({ billingType: "yearly", unitPriceCents: 10_000 }),
      line({ clientId: "b", billingType: "yearly", unitPriceCents: 10_001, startsOn: "2026-02-01" }),
      line({ clientId: "c", billingType: "yearly", unitPriceCents: 10_001, endsOn: "2026-01-31" }),
    ];
    const feb = mrrMovements(lines, "2026-01-31", "2026-02-28");
    expect(feb.startCents).toBe(orgMrrCents(lines, "2026-01-31"));
    expect(feb.endCents).toBe(orgMrrCents(lines, "2026-02-28"));
    expectBridge(feb);
    expect(Math.abs(feb.newCents - 10_001 / 12)).toBeLessThan(1);
    expect(Math.abs(feb.churnCents - 10_001 / 12)).toBeLessThan(1);
  });
});
