import { describe, expect, it } from "vitest";
import { type ForecastContract, forecastBilling } from "./forecast";

const base: ForecastContract = {
  id: "c",
  signedOn: "2026-01-10",
  lines: [],
  milestones: [],
  billedMilestoneIds: new Set(),
  billedStarts: new Map(),
};

describe("previsión de facturación", () => {
  it("prevé las cuotas con el mismo calendario que factura: prorrateos, pausas y bajas", () => {
    const contract: ForecastContract = {
      ...base,
      lines: [
        { id: "m", billingType: "monthly", quantity: "1", unitPriceCents: 50_000, discountBps: 0, startsOn: "2026-10-15", endsOn: "2027-01-31", billingDay: 1, prorateFirst: true, pauses: [{ startsOn: "2026-12-01", endsOn: "2026-12-31" }] },
        { id: "y", billingType: "yearly", quantity: "1", unitPriceCents: 120_000, discountBps: 0, startsOn: "2025-11-20", endsOn: null, billingDay: null, prorateFirst: false, pauses: [] },
        { id: "u", billingType: "usage", quantity: "1", unitPriceCents: 37_500, discountBps: 0, startsOn: null, endsOn: null, billingDay: null, prorateFirst: false, pauses: [] },
      ],
      billedStarts: new Map([["y", new Set(["2025-11-20"])]]),
    };
    const months = forecastBilling([contract], "2026-10-05", 4);
    expect(months).toEqual([
      { month: "2026-10-01", recurringCents: 27_419, oneOffCents: 0 }, // 17/31 de 500 €
      { month: "2026-11-01", recurringCents: 50_000 + 120_000, oneOffCents: 0 }, // cuota + renovación anual
      { month: "2026-12-01", recurringCents: 0, oneOffCents: 0 }, // pausa
      { month: "2027-01-01", recurringCents: 50_000, oneOffCents: 0 }, // último mes antes de la baja
    ]);
  });

  it("los hitos con fecha caen en su mes; lo vencido sin facturar, en el primero; lo facturado, en ninguno", () => {
    const contract: ForecastContract = {
      ...base,
      lines: [{ id: "web", billingType: "one_off", quantity: "1", unitPriceCents: 300_000, discountBps: 0, startsOn: null, endsOn: null, billingDay: null, prorateFirst: false, pauses: [] }],
      milestones: [
        { id: "a", position: 1, percentBps: 4000, plannedOn: "2026-09-01" },
        { id: "b", position: 2, percentBps: 3000, plannedOn: "2026-08-01" },
        { id: "c", position: 3, percentBps: 3000, plannedOn: "2026-12-15" },
      ],
      billedMilestoneIds: new Set(["a"]),
    };
    const months = forecastBilling([contract], "2026-10-01", 3);
    expect(months.map((m) => m.oneOffCents)).toEqual([90_000, 0, 90_000]);
  });

  it("un contrato sin firmar no prevé nada", () => {
    const unsigned: ForecastContract = {
      ...base,
      signedOn: null,
      lines: [{ id: "m", billingType: "monthly", quantity: "1", unitPriceCents: 10_000, discountBps: 0, startsOn: "2026-10-01", endsOn: null, billingDay: 1, prorateFirst: true, pauses: [] }],
    };
    expect(forecastBilling([unsigned], "2026-10-01", 2).every((m) => m.recurringCents === 0)).toBe(true);
  });
});
