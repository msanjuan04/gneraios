import { describe, expect, it } from "vitest";
import { mrrCents, type MrrLine } from "./mrr";

const base: MrrLine = {
  billingType: "monthly",
  quantity: "1",
  unitPriceCents: 15_000,
  discountBps: 0,
  startsOn: "2026-01-01",
  endsOn: null,
  pauses: [],
};

describe("MRR", () => {
  it("suma mensuales y anuales / 12, netas de descuento; excluye uso y one-off", () => {
    const lines: MrrLine[] = [
      base,
      { ...base, unitPriceCents: 60_000, discountBps: 1000 }, // 540 €
      { ...base, billingType: "yearly", unitPriceCents: 120_000 }, // 100 €/mes
      { ...base, billingType: "usage", unitPriceCents: 37_500 },
      { ...base, billingType: "one_off", unitPriceCents: 300_000 },
    ];
    expect(mrrCents(lines, "2026-09-26")).toBe(15_000 + 54_000 + 10_000);
  });

  it("redondea una sola vez: tres anuales de 100 € no suman 3 × 8,33 €", () => {
    const yearly = { ...base, billingType: "yearly" as const, unitPriceCents: 10_000 };
    // 3 × 10.000 / 12 = 2.500 exactos; redondear cada una daría 3 × 833 = 2.499.
    expect(mrrCents([yearly, yearly, yearly], "2026-09-26")).toBe(2500);
  });

  it("no cuenta líneas en pausa, terminadas o que aún no han empezado", () => {
    const lines: MrrLine[] = [
      { ...base, pauses: [{ startsOn: "2026-09-01", endsOn: null }] },
      { ...base, endsOn: "2026-08-31" },
      { ...base, startsOn: "2026-10-01" },
    ];
    expect(mrrCents(lines, "2026-09-26")).toBe(0);
    expect(mrrCents(lines, "2026-10-01")).toBe(15_000);
  });
});
