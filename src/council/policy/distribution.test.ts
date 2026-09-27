import { describe, expect, it } from "vitest";
import { proposeDistribution, splitByShares } from "./distribution";
import { EXAMPLE_POLICY, financialPolicySchema, resolvePolicy } from "./schema";

const base = {
  profitCents: 1_000_000, // 10.000 € de beneficio
  reservedCents: 500_000, // 5.000 € de IVA e impuestos pendientes
  monthlyFixedCostsCents: 300_000, // 3.000 €/mes de fijos → colchón objetivo de 12.000 €
  shareholdings: [],
  policy: EXAMPLE_POLICY,
};

const sum = (b: Record<string, number>) => Object.values(b).reduce((a, c) => a + c, 0);

describe("proposeDistribution", () => {
  it("con caja de sobra: impuestos → reinversión 30 % → socios 70 %, sin tocar el colchón", () => {
    const d = proposeDistribution({ ...base, cashCents: 4_000_000 });
    expect(d.buckets).toEqual({ taxes: 250_000, cushion: 0, reinvestment: 225_000, partners: 525_000 });
    expect(d.cushionTargetCents).toBe(1_200_000);
    expect(d.cashLimited).toBe(false);
    expect(sum(d.buckets)).toBe(d.availableCents);
  });

  it("si la caja libre no llega, lo que no puede salir se queda como colchón", () => {
    // Caja libre = 20.000 − 5.000 − 2.500 (impuestos del mes) − 12.000 (colchón) = 500 €.
    const d = proposeDistribution({ ...base, cashCents: 2_000_000 });
    expect(d.freeCashCents).toBe(50_000);
    expect(d.buckets).toEqual({ taxes: 250_000, cushion: 700_000, reinvestment: 15_000, partners: 35_000 });
    expect(d.cashLimited).toBe(true);
    expect(sum(d.buckets)).toBe(1_000_000);
  });

  it("con la caja por debajo del colchón no sale nada", () => {
    const d = proposeDistribution({ ...base, cashCents: 1_000_000 });
    expect(d.freeCashCents).toBeLessThan(0);
    expect(d.buckets).toEqual({ taxes: 250_000, cushion: 750_000, reinvestment: 0, partners: 0 });
  });

  it("un mes con pérdidas no reparte nada", () => {
    const d = proposeDistribution({ ...base, profitCents: -150_000, cashCents: 9_000_000 });
    expect(d.loss).toBe(true);
    expect(d.availableCents).toBe(0);
    expect(d.buckets).toEqual({ taxes: 0, cushion: 0, reinvestment: 0, partners: 0 });
  });

  it("cuadra al céntimo con importes que no dividen exacto y reparte entre socios por participación", () => {
    const d = proposeDistribution({
      ...base,
      profitCents: 333_333,
      cashCents: 10_000_000,
      shareholdings: [
        { name: "MS", memberId: "a", shareBps: 3334 },
        { name: "MC", memberId: "b", shareBps: 3333 },
        { name: "HL", memberId: "c", shareBps: 3333 },
      ],
    });
    expect(sum(d.buckets)).toBe(333_333);
    expect(d.buckets.taxes).toBe(83_333); // 25 % de 3.333,33 € = 833,3325 → 833,33 €
    const partnerSum = d.partners.reduce((a, p) => a + p.cents, 0);
    expect(partnerSum).toBe(d.buckets.partners);
    for (const p of d.partners) expect(Math.abs(p.cents - (d.buckets.partners * p.shareBps) / 10_000)).toBeLessThan(1);
  });
});

describe("splitByShares", () => {
  it("sin participaciones no reparte", () => {
    expect(splitByShares(1000, [])).toEqual([]);
    expect(splitByShares(1000, [{ shareBps: 0 }])).toEqual([]);
  });

  it("el mayor resto se lleva el céntimo que sobra", () => {
    expect(splitByShares(100, [{ shareBps: 1 }, { shareBps: 1 }, { shareBps: 1 }]).map((s) => s.cents)).toEqual([34, 33, 33]);
  });
});

describe("política", () => {
  it("los valores de ejemplo son una política válida y se marcan como ejemplo", () => {
    expect(financialPolicySchema.parse(EXAMPLE_POLICY)).toEqual(EXAMPLE_POLICY);
    expect(resolvePolicy(null)).toMatchObject({ version: null, isExample: true, policy: EXAMPLE_POLICY });
  });

  it("el reparto tiene que sumar 100 % y el umbral alto no puede estar por debajo del normal", () => {
    expect(financialPolicySchema.safeParse({ ...EXAMPLE_POLICY, distribution: { reinvestment_bps: 3000, partners_bps: 6000 } }).success).toBe(false);
    expect(financialPolicySchema.safeParse({ ...EXAMPLE_POLICY, high_impact_threshold_cents: 100 }).success).toBe(false);
  });

  it("la versión guardada manda; una guardada rota no se sustituye en silencio por la de ejemplo", () => {
    const record = { version: 3, data: { ...EXAMPLE_POLICY, cushion_months: 6 }, createdAt: "2026-09-26T10:00:00Z", note: null };
    expect(resolvePolicy(record)).toMatchObject({ version: 3, isExample: false, policy: { cushion_months: 6 } });
    expect(() => resolvePolicy({ ...record, data: { cushion_months: "seis" } })).toThrow(/v3/);
  });
});
