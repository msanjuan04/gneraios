import { describe, expect, it } from "vitest";
import { concentration } from "./concentration";

describe("concentración de la facturación", () => {
  it("ordena, reparte en puntos básicos y avisa si el mayor supera el umbral", () => {
    const result = concentration(
      [
        { clientId: "hotel", cents: 50_000 },
        { clientId: "clinica", cents: 30_000 },
        { clientId: "hotel", cents: 10_000 },
        { clientId: "celler", cents: 10_000 },
        { clientId: "gym", cents: 0 },
        { clientId: "anulado", cents: -5_000 },
      ],
      { thresholdBps: 5000 },
    );
    expect(result.totalCents).toBe(100_000);
    expect(result.clients.map((c) => [c.clientId, c.shareBps])).toEqual([
      ["hotel", 6000],
      ["clinica", 3000],
      ["celler", 1000],
    ]);
    expect(result.top1ShareBps).toBe(6000);
    expect(result.top3ShareBps).toBe(10_000);
    expect(result.alert).toBe(true);
    expect(concentration([{ clientId: "a", cents: 1 }, { clientId: "b", cents: 1 }], { thresholdBps: 6000 }).alert).toBe(false);
  });

  it("sin facturación no hay reparto ni aviso", () => {
    expect(concentration([], { thresholdBps: 2500 })).toEqual({
      totalCents: 0,
      clients: [],
      top1ShareBps: 0,
      top3ShareBps: 0,
      alert: false,
    });
  });
});
