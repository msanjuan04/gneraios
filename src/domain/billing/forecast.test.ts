import { describe, expect, it } from "vitest";
import { type ForecastContract, forecastBilling, forecastItems } from "./forecast";

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

describe("forecastItems: cada cobro previsto, uno por uno", () => {
  const monthly = (id: string, unitPriceCents: number, over: object = {}) => ({
    id, description: `Línea ${id}`, billingType: "monthly" as const, quantity: "1", unitPriceCents, discountBps: 0,
    startsOn: "2026-10-05", endsOn: null, billingDay: 5, prorateFirst: false, pauses: [], ...over,
  });

  it("una mensualidad con día de cobro 5 sale el 5 de cada mes", () => {
    const contract: ForecastContract = { ...base, id: "udb", clientId: "c1", title: "Mantenimiento", signedOn: "2026-10-01", lines: [monthly("a", 117_500)] };
    const items = forecastItems([contract], "2026-10-03", 3);
    expect(items.map((item) => item.date)).toEqual(["2026-10-05", "2026-11-05", "2026-12-05"]);
    expect(items.every((item) => item.kind === "monthly" && item.cents === 117_500 && item.clientId === "c1")).toBe(true);
    expect(items.some((item) => item.overdue)).toBe(false);
  });

  it("lo que tocaba facturar antes de hoy y no se facturó sale como vencido", () => {
    const contract: ForecastContract = { ...base, signedOn: "2026-10-01", lines: [monthly("a", 50_000, { billingDay: 1, startsOn: "2026-10-01" })] };
    const [first] = forecastItems([contract], "2026-10-03", 2);
    expect(first).toMatchObject({ date: "2026-10-01", overdue: true });
  });

  it("lo ya facturado no vuelve a salir", () => {
    const contract: ForecastContract = {
      ...base, signedOn: "2026-10-01", lines: [monthly("a", 50_000)],
      billedStarts: new Map([["a", new Set(["2026-10-05"])]]),
    };
    expect(forecastItems([contract], "2026-10-03", 2).map((item) => item.date)).toEqual(["2026-11-05"]);
  });

  it("empezar antes de su día de cobro genera un cobro de más: el 1 y el 5 de octubre", () => {
    // Por eso un contrato que cobra el día 5 tiene que empezar el día 5, no el 1.
    const contract: ForecastContract = { ...base, signedOn: "2026-10-01", lines: [monthly("a", 50_000, { startsOn: "2026-10-01" })] };
    expect(forecastItems([contract], "2026-10-03", 1).map((item) => item.date)).toEqual(["2026-10-01", "2026-10-05"]);
  });

  it("una anualidad sale una vez al año, entera", () => {
    const contract: ForecastContract = {
      ...base, signedOn: "2026-03-10",
      lines: [{ id: "y", billingType: "yearly" as const, quantity: "1", unitPriceCents: 120_000, discountBps: 0, startsOn: "2026-03-10", endsOn: null, billingDay: null, prorateFirst: false, pauses: [] }],
      billedStarts: new Map([["y", new Set(["2026-03-10"])]]),
    };
    const items = forecastItems([contract], "2026-10-03", 12);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "yearly", date: "2027-03-10", cents: 120_000 });
  });

  it("un contrato sin firmar no prevé nada", () => {
    expect(forecastItems([{ ...base, signedOn: null, lines: [monthly("a", 1_000)] }], "2026-10-03", 3)).toEqual([]);
  });

  it("la previsión por meses suma lo mismo que la lista", () => {
    const contract: ForecastContract = { ...base, signedOn: "2026-10-01", lines: [monthly("a", 117_500)] };
    const total = forecastBilling([contract], "2026-10-03", 3).reduce((sum, month) => sum + month.recurringCents, 0);
    expect(total).toBe(forecastItems([contract], "2026-10-03", 3).reduce((sum, item) => sum + item.cents, 0));
  });
});
