import { describe, expect, it } from "vitest";
import { allocateCents } from "./allocate";

// PRNG determinista (mulberry32) para las comprobaciones con muchos casos.
function prng(seed: number) {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("allocateCents", () => {
  it("reparte en proporción a los pesos y los céntimos que sobran van a los mayores restos", () => {
    expect(allocateCents(100, [1, 2])).toEqual([33, 67]);
    expect(allocateCents(100_000, [3, 1])).toEqual([75_000, 25_000]);
    expect(allocateCents(10, [1, 1, 1])).toEqual([4, 3, 3]);
  });

  it("a igualdad de resto, el céntimo va al primero", () => {
    expect(allocateCents(1, [1, 1])).toEqual([1, 0]);
    expect(allocateCents(2, [1, 1, 1])).toEqual([1, 1, 0]);
  });

  it("con todos los pesos a 0, a partes iguales", () => {
    expect(allocateCents(10, [0, 0, 0])).toEqual([4, 3, 3]);
    expect(allocateCents(9, [0])).toEqual([9]);
  });

  it("un peso 0 entre otros no recibe nada", () => {
    expect(allocateCents(100, [0, 3, 1])).toEqual([0, 75, 25]);
  });

  it("un total negativo (una rectificativa) es el reparto del positivo con el signo cambiado", () => {
    expect(allocateCents(-100, [1, 2])).toEqual([-33, -67]);
    expect(allocateCents(-1, [1, 1])).toEqual([-1, 0]);
    // Nunca −0.
    expect(Object.is(allocateCents(-1, [1, 1])[1], 0)).toBe(true);
    expect(allocateCents(0, [5, 7]).every((part) => Object.is(part, 0))).toBe(true);
  });

  it("es exacto con importes y pesos grandes (BigInt por dentro)", () => {
    const total = Number.MAX_SAFE_INTEGER;
    const weights = [9_999_999, 1, 3];
    const parts = allocateCents(total, weights);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
    // Cada parte es el suelo de su cuota exacta o uno más.
    const sum = BigInt(10_000_003);
    parts.forEach((part, i) => {
      const floor = (BigInt(total) * BigInt(weights[i]!)) / sum;
      expect([floor, floor + BigInt(1)]).toContain(BigInt(part));
    });
  });

  it("la suma de las partes es siempre el total y ninguna se aleja más de un céntimo de su cuota", () => {
    const random = prng(20260926);
    for (let run = 0; run < 500; run++) {
      const count = 1 + Math.floor(random() * 6);
      const weights = Array.from({ length: count }, () => (random() < 0.2 ? 0 : Math.floor(random() * 5000)));
      const total = Math.floor((random() - 0.3) * 2_000_000);
      const parts = allocateCents(total, weights);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
      const sum = weights.reduce((a, b) => a + b, 0);
      parts.forEach((part, i) => {
        const exact = sum === 0 ? total / count : (total * weights[i]!) / sum;
        expect(Math.abs(part - exact)).toBeLessThan(1);
      });
    }
  });

  it("rechaza pesos negativos o con decimales, un total que no es entero y una lista vacía", () => {
    expect(() => allocateCents(100, [])).toThrow();
    expect(() => allocateCents(100, [1, -1])).toThrow();
    expect(() => allocateCents(100, [0.5, 1])).toThrow();
    expect(() => allocateCents(10.5, [1])).toThrow();
  });
});
