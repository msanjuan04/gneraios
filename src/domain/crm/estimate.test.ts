import { describe, expect, it } from "vitest";
import { estimateFromHistory, leadValue } from "./estimate";

describe("estimar desde el histórico", () => {
  it("usa la mediana, no la media: un presupuesto enorme no la dispara", () => {
    const estimate = estimateFromHistory([
      { oneOffCents: 100_000, monthlyCents: 0 },
      { oneOffCents: 120_000, monthlyCents: 0 },
      { oneOffCents: 5_000_000, monthlyCents: 0 },
    ]);
    expect(estimate.oneOffCents).toBe(120_000);
  });

  it("el recurrente solo cuenta los presupuestos que lo tienen", () => {
    const estimate = estimateFromHistory([
      { oneOffCents: 100_000, monthlyCents: 0 },
      { oneOffCents: 100_000, monthlyCents: 30_000 },
      { oneOffCents: 100_000, monthlyCents: 50_000 },
    ]);
    expect(estimate.monthlyCents).toBe(40_000);
  });

  it("sin histórico no inventa nada", () => {
    expect(estimateFromHistory([])).toEqual({ oneOffCents: 0, monthlyCents: 0, basedOn: 0 });
  });
});

describe("el importe que cuenta un lead", () => {
  const estimate = { oneOffCents: 150_000, monthlyCents: 20_000, basedOn: 4 };

  it("lo real manda sobre la estimación", () => {
    expect(leadValue({ estOneOffCents: 80_000, estMrrCents: 0, quotes: 0 }, estimate)).toEqual({ oneOffCents: 80_000, mrrCents: 0, estimated: false });
  });

  it("un lead con presupuesto no se estima aunque su importe sea 0", () => {
    expect(leadValue({ estOneOffCents: 0, estMrrCents: 0, quotes: 1 }, estimate).estimated).toBe(false);
  });

  it("sin importe ni presupuesto se estima, y se dice", () => {
    expect(leadValue({ estOneOffCents: 0, estMrrCents: 0, quotes: 0 }, estimate)).toEqual({ oneOffCents: 150_000, mrrCents: 20_000, estimated: true });
  });

  it("sin histórico no hay estimación que enseñar", () => {
    expect(leadValue({ estOneOffCents: 0, estMrrCents: 0, quotes: 0 }, { oneOffCents: 0, monthlyCents: 0, basedOn: 0 }).estimated).toBe(false);
  });
});
