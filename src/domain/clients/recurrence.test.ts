import { describe, expect, it } from "vitest";
import { cycleCents, isLiveOn, NO_RECURRENCE, type RecurringLine, recurrenceOf } from "./recurrence";

const line = (o: Partial<RecurringLine> = {}): RecurringLine => ({
  billingType: "monthly", quantity: 1, unitPriceCents: 105_000, discountBps: 0, startsOn: "2026-10-01", endsOn: null, cancelledOn: null, ...o,
});

describe("recurrencia de un cliente", () => {
  it("UDB: tres mensualidades suman 1.175 € al mes", () => {
    const total = recurrenceOf([line(), line({ unitPriceCents: 9_500 }), line({ unitPriceCents: 3_000 })], "2026-10-03");
    expect(total).toEqual({ monthlyCents: 117_500, yearlyCents: 0, lines: 3 });
  });

  it("mensual y anual van por separado y no se convierten", () => {
    const total = recurrenceOf([line({ unitPriceCents: 60_000 }), line({ billingType: "yearly", unitPriceCents: 120_000 })], "2026-10-03");
    expect(total).toMatchObject({ monthlyCents: 60_000, yearlyCents: 120_000 });
  });

  it("lo puntual y lo de uso no es recurrencia", () => {
    expect(recurrenceOf([line({ billingType: "one_off" }), line({ billingType: "usage" })], "2026-10-03")).toEqual(NO_RECURRENCE);
  });

  it("lo que aún no ha empezado, ya terminó o se canceló no cuenta", () => {
    const lines = [line({ startsOn: "2026-11-01" }), line({ endsOn: "2026-09-30" }), line({ cancelledOn: "2026-10-01" })];
    expect(recurrenceOf(lines, "2026-10-03")).toEqual(NO_RECURRENCE);
  });

  it("el día que termina todavía cuenta, y el día que se cancela ya no", () => {
    expect(isLiveOn({ startsOn: null, endsOn: "2026-10-03", cancelledOn: null }, "2026-10-03")).toBe(true);
    expect(isLiveOn({ startsOn: null, endsOn: null, cancelledOn: "2026-10-03" }, "2026-10-03")).toBe(false);
  });

  it("aplica cantidad y descuento al ciclo", () => {
    expect(cycleCents({ quantity: 2, unitPriceCents: 10_000, discountBps: 1000 })).toBe(18_000);
  });
});
