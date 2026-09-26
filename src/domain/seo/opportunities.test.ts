import { describe, expect, it } from "vitest";
import { CTR_CURVE, expectedCtr, findOpportunities, minOpportunityImpressions, movers, type QueryStat } from "./opportunities";

const stat = (key: string, fields: Partial<QueryStat>): QueryStat => ({
  key,
  clicks: 0,
  impressions: 0,
  position: 5,
  compareClicks: 0,
  compareImpressions: 0,
  comparePosition: null,
  ...fields,
});

describe("curva de CTR", () => {
  it("baja con la posición y se interpola entre posiciones enteras", () => {
    expect(expectedCtr(1)).toBe(CTR_CURVE[0]);
    expect(expectedCtr(0.4)).toBe(CTR_CURVE[0]);
    expect(expectedCtr(3)).toBe(0.1);
    expect(expectedCtr(3.5)).toBeCloseTo(0.085);
    expect(expectedCtr(10)).toBeCloseTo(0.018);
    expect(expectedCtr(10.5)).toBeCloseTo(0.013);
    expect(expectedCtr(40)).toBeCloseTo(0.008);
    for (let p = 1; p < 12; p += 0.5) expect(expectedCtr(p + 0.5)).toBeLessThanOrEqual(expectedCtr(p));
  });
});

describe("oportunidades", () => {
  it("consultas en posición 4-15 con impresiones suficientes, por clics que faltan para el top 3", () => {
    const stats = [
      stat("diseño web mataró", { impressions: 1200, clicks: 12, position: 6.2 }), // CTR 1 % → faltan 9 % de 1.200
      stat("agencia seo maresme", { impressions: 400, clicks: 4, position: 11 }),
      stat("gnerai", { impressions: 900, clicks: 400, position: 1.1 }), // ya está arriba
      stat("página tres", { impressions: 2000, clicks: 1, position: 22 }), // demasiado lejos
      stat("pocas impresiones", { impressions: 20, clicks: 0, position: 5 }),
      stat("ya rinde", { impressions: 500, clicks: 80, position: 4.5 }), // CTR 16 % > 10 %
    ];
    const found = findOpportunities(stats, 28);
    expect(found.map((o) => o.key)).toEqual(["diseño web mataró", "agencia seo maresme"]);
    // (0,10 − 0,01) × 1.200 = 108 clics en 28 días → 116 al mes.
    expect(found[0]!.potentialPerMonth).toBe(Math.round(108 * (30 / 28)));
    expect(found[0]!.ctr).toBeCloseTo(0.01);
    expect(findOpportunities(stats, 28, 1)).toHaveLength(1);
  });

  it("el umbral de impresiones crece con el periodo", () => {
    expect(minOpportunityImpressions(7)).toBe(30);
    expect(minOpportunityImpressions(28)).toBe(42);
    expect(minOpportunityImpressions(365)).toBe(548);
  });
});

describe("las que suben y las que bajan", () => {
  it("calcula los clics y las posiciones ganadas y descarta el ruido", () => {
    const stats = [
      stat("sube mucho", { clicks: 40, compareClicks: 10, position: 3, comparePosition: 7.5 }),
      stat("sube poco", { clicks: 11, compareClicks: 10 }),
      stat("baja", { clicks: 2, compareClicks: 30, position: 12, comparePosition: 4 }),
      stat("nueva", { clicks: 9, compareClicks: 0, position: 8, comparePosition: null }),
    ];
    expect(movers(stats, "up").map((m) => [m.key, m.clicksDelta, m.positionDelta])).toEqual([
      ["sube mucho", 30, 4.5],
      ["nueva", 9, null],
    ]);
    expect(movers(stats, "down").map((m) => [m.key, m.clicksDelta, m.positionDelta])).toEqual([["baja", -28, -8]]);
    expect(movers(stats, "up", 1)).toHaveLength(1);
  });
});
