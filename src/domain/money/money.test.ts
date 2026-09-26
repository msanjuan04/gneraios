import { describe, expect, it } from "vitest";
import { applyBps, assertBps, assertCents, divRoundHalfAwayFromZero, multiplyQuantity } from "./money";

/** Deterministic PRNG (mulberry32), so the property-style tests are reproducible. */
function prng(seed: number) {
  let state = seed;
  const next = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  const pick = <T>(items: readonly T[]) => items[int(0, items.length - 1)];
  return { int, pick };
}

const div = (numerator: number | string, denominator: number) =>
  divRoundHalfAwayFromZero(BigInt(numerator), BigInt(denominator));

/** Line totals following ARCHITECTURE.md §7.1. */
function lineTotals(unitPrice: number, quantity: string, discountBps: number, vatBps: number, irpfBps: number) {
  const gross = multiplyQuantity(unitPrice, quantity);
  const discount = applyBps(gross, discountBps);
  const base = gross - discount;
  const vat = applyBps(base, vatBps);
  const irpf = applyBps(base, irpfBps);
  return { gross, discount, base, vat, irpf, total: base + vat - irpf };
}

/** Negation without producing -0, which `toBe` / `toEqual` distinguish from 0. */
const neg = (value: number) => (value === 0 ? 0 : -value);

const negate = <T extends Record<string, number>>(values: T): T =>
  Object.fromEntries(Object.entries(values).map(([key, value]) => [key, neg(value)])) as T;

describe("divRoundHalfAwayFromZero", () => {
  it("rounds exact halves away from zero in both directions", () => {
    const cases: [number, number, number][] = [
      [5, 2, 3], [-5, 2, -3], [7, 2, 4], [-7, 2, -4], [1, 2, 1], [-1, 2, -1],
      [15, 10, 2], [-15, 10, -2], [25, 10, 3], [-25, 10, -3], [5000, 10_000, 1], [-5000, 10_000, -1],
    ];
    for (const [numerator, denominator, expected] of cases) {
      expect(div(numerator, denominator), `${numerator}/${denominator}`).toBe(BigInt(expected));
    }
  });

  it("rounds everything else to the nearest integer", () => {
    const cases: [number, number, number][] = [
      [14, 10, 1], [-14, 10, -1], [16, 10, 2], [-16, 10, -2], [1, 3, 0], [2, 3, 1], [-2, 3, -1],
      [0, 7, 0], [21, 7, 3], [-21, 7, -3], [4999, 10_000, 0], [-4999, 10_000, 0], [5001, 10_000, 1],
    ];
    for (const [numerator, denominator, expected] of cases) {
      expect(div(numerator, denominator), `${numerator}/${denominator}`).toBe(BigInt(expected));
    }
  });

  it("matches sign(n) · round(|n| / d) on small integers", () => {
    const failures: string[] = [];
    for (let denominator = 1; denominator <= 16; denominator++) {
      for (let numerator = -2000; numerator <= 2000; numerator++) {
        const expected = Math.sign(numerator) * Math.round(Math.abs(numerator) / denominator);
        if (div(numerator, denominator) !== BigInt(expected)) failures.push(`${numerator}/${denominator}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("is symmetric: f(−n, d) = −f(n, d), also beyond 2^53", () => {
    const random = prng(42);
    const failures: string[] = [];
    for (let i = 0; i < 5000; i++) {
      const numerator = BigInt(random.int(0, 1e12)) * BigInt(random.int(1, 1e9));
      const denominator = BigInt(random.pick([2, 3, 7, 100, 1000, 10_000, 97]));
      if (divRoundHalfAwayFromZero(-numerator, denominator) !== -divRoundHalfAwayFromZero(numerator, denominator)) {
        failures.push(`${numerator}/${denominator}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("is exact on huge values", () => {
    const pow80 = BigInt(2) ** BigInt(80);
    const pow79 = BigInt(2) ** BigInt(79);
    const one = BigInt(1);
    const two = BigInt(2);
    expect(divRoundHalfAwayFromZero(pow80 + one, two)).toBe(pow79 + one);
    expect(divRoundHalfAwayFromZero(-(pow80 + one), two)).toBe(-(pow79 + one));
    expect(divRoundHalfAwayFromZero(pow80 - one, two)).toBe(pow79);
    expect(divRoundHalfAwayFromZero(-(pow80 - one), two)).toBe(-pow79);
  });

  it("rejects a zero or negative denominator", () => {
    expect(() => div(1, 0)).toThrow(/divisor/);
    expect(() => div(1, -2)).toThrow(/divisor/);
  });
});

describe("assertCents / assertBps", () => {
  it("returns safe integers unchanged", () => {
    for (const value of [0, 1, -5, 473000, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER]) {
      expect(assertCents(value)).toBe(value);
      expect(assertBps(value)).toBe(value);
    }
  });

  it("throws on anything that is not a safe integer", () => {
    for (const value of [1.5, -0.01, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
      expect(() => assertCents(value)).toThrow(/céntimos/);
      expect(() => assertBps(value)).toThrow(/puntos básicos/);
    }
  });
});

describe("applyBps", () => {
  it("computes 21 % VAT on typical amounts", () => {
    const cases: [number, number][] = [
      [15000, 3150], [75000, 15750], [90000, 18900], [473000, 99330], [9999, 2100], [1, 0], [3, 1], [0, 0],
    ];
    for (const [amount, vat] of cases) expect(applyBps(amount, 2100), String(amount)).toBe(vat);
  });

  it("computes 15 % and 7 % IRPF on typical amounts", () => {
    expect(applyBps(15000, 1500)).toBe(2250);
    expect(applyBps(75000, 1500)).toBe(11250);
    expect(applyBps(90000, 1500)).toBe(13500);
    expect(applyBps(33333, 1500)).toBe(5000); // 4999.95
    expect(applyBps(15000, 700)).toBe(1050);
    expect(applyBps(33333, 700)).toBe(2333); // 2333.31
  });

  it("rounds half-cent results away from zero", () => {
    const cases: [number, number, number][] = [
      [50, 2100, 11], [150, 2100, 32], [250, 2100, 53], // 10.5, 31.5, 52.5
      [10, 1500, 2], [30, 1500, 5], [50, 1500, 8], // 1.5, 4.5, 7.5
      [50, 700, 4], [150, 700, 11], // 3.5, 10.5
      [1, 5000, 1], [50, 100, 1], // 0.5
      [69, 2100, 14], [31, 2100, 7], // 14.49, 6.51
    ];
    for (const [amount, bps, expected] of cases) {
      expect(applyBps(amount, bps), `${amount} × ${bps}`).toBe(expected);
      expect(applyBps(-amount, bps), `${-amount} × ${bps}`).toBe(neg(expected));
    }
  });

  it("reproduces the example invoice of ARCHITECTURE.md §7.1", () => {
    const maintenance = lineTotals(15000, "1", 0, 2100, 1500);
    const metaAds = lineTotals(37500, "2", 0, 2100, 1500);
    expect(maintenance).toMatchObject({ base: 15000, vat: 3150, irpf: 2250 });
    expect(metaAds).toMatchObject({ base: 75000, vat: 15750, irpf: 11250 });
    expect(maintenance.base + metaAds.base).toBe(90000);
    expect(maintenance.vat + metaAds.vat).toBe(18900);
    expect(maintenance.irpf + metaAds.irpf).toBe(13500);
    expect(maintenance.total + metaAds.total).toBe(95400);
  });

  it("makes a full credit note the exact negation of the original", () => {
    const random = prng(2100);
    for (let i = 0; i < 2000; i++) {
      const unitPrice = random.int(0, 1e9);
      const quantity = `${random.int(0, 9999)}.${String(random.int(0, 999)).padStart(3, "0")}`;
      const rates = [random.pick([0, 500, 1000, 1250, 3333]), random.pick([2100, 1000, 400, 0]), random.pick([0, 1500, 700])] as const;
      const original = lineTotals(unitPrice, quantity, ...rates);
      const expected = negate(original);
      expect(lineTotals(unitPrice, `-${quantity}`, ...rates)).toEqual(expected);
      expect(lineTotals(-unitPrice, quantity, ...rates)).toEqual(expected);
    }
  });

  it("keeps full precision when the intermediate product exceeds 2^53", () => {
    const amount = 9_007_199_254_740_950; // × 0.21 = 1 891 511 843 495 599.5 exactly
    expect(Math.round((amount * 2100) / 10_000)).toBe(1_891_511_843_495_599); // float math is off by one
    expect(applyBps(amount, 2100)).toBe(1_891_511_843_495_600);
    expect(applyBps(-amount, 2100)).toBe(-1_891_511_843_495_600);
    expect(applyBps(Number.MAX_SAFE_INTEGER, 2100)).toBe(1_891_511_843_495_608);
    expect(applyBps(Number.MAX_SAFE_INTEGER, 10_000)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("throws when the result does not fit in a safe integer", () => {
    expect(() => applyBps(Number.MAX_SAFE_INTEGER, 10_001)).toThrow(/rango/);
    expect(() => applyBps(Number.MIN_SAFE_INTEGER, 20_000)).toThrow(/rango/);
  });

  it("rejects non-integer amounts and rates", () => {
    expect(() => applyBps(10.5, 2100)).toThrow(/céntimos/);
    expect(() => applyBps(Number.NaN, 2100)).toThrow(/céntimos/);
    expect(() => applyBps(2 ** 53, 2100)).toThrow(/céntimos/);
    expect(() => applyBps(100, 21.5)).toThrow(/puntos básicos/);
  });
});

describe("multiplyQuantity", () => {
  it("multiplies by integer and decimal quantities", () => {
    expect(multiplyQuantity(37500, 2)).toBe(75000);
    expect(multiplyQuantity(37500, "2")).toBe(75000);
    expect(multiplyQuantity(1000, "1.5")).toBe(1500);
    expect(multiplyQuantity(1000, 1.5)).toBe(1500);
    expect(multiplyQuantity(100, "0.333")).toBe(33); // 33.3
    expect(multiplyQuantity(300, 0.333)).toBe(100); // 99.9
    expect(multiplyQuantity(150, "0.333")).toBe(50); // 49.95
    expect(multiplyQuantity(12345, "0")).toBe(0);
    expect(multiplyQuantity(0, "12.5")).toBe(0);
  });

  it("rounds half a cent away from zero", () => {
    const cases: [number, string, number][] = [
      [1, "0.5", 1], [3, "0.5", 2], [15, "0.1", 2], [500, "0.001", 1], [499, "0.001", 0], [999, "0.001", 1],
    ];
    for (const [unitPrice, quantity, expected] of cases) {
      expect(multiplyQuantity(unitPrice, quantity), `${unitPrice} × ${quantity}`).toBe(expected);
      expect(multiplyQuantity(-unitPrice, quantity), `${-unitPrice} × ${quantity}`).toBe(neg(expected));
      expect(multiplyQuantity(unitPrice, `-${quantity}`), `${unitPrice} × -${quantity}`).toBe(neg(expected));
    }
  });

  it("reads the decimal representation instead of multiplying floats", () => {
    expect(Math.round(100 * 1.005)).toBe(100); // 100.49999999999999 in float math
    expect(multiplyQuantity(100, 1.005)).toBe(101);
    expect(multiplyQuantity(100, "1.005")).toBe(101);
  });

  it("accepts numeric(12,3) strings, signs and surrounding whitespace", () => {
    expect(multiplyQuantity(1000, "1.500")).toBe(1500);
    expect(multiplyQuantity(1000, "0001.250")).toBe(1250);
    expect(multiplyQuantity(1000, "1.5000")).toBe(1500); // trailing zeros are still exact
    expect(multiplyQuantity(1000, " 2 ")).toBe(2000);
    expect(multiplyQuantity(1000, "+2")).toBe(2000);
    expect(multiplyQuantity(1000, "-2")).toBe(-2000);
    expect(multiplyQuantity(1000, "-0")).toBe(0); // never -0
    expect(multiplyQuantity(-1000, 0)).toBe(0);
  });

  it("rejects quantities with more than 3 decimals", () => {
    for (const quantity of ["0.0001", "1.2345", "-0.3331", 0.0001, 1e-7, 0.1 + 0.2]) {
      expect(() => multiplyQuantity(100, quantity), String(quantity)).toThrow(/3 decimales/);
    }
  });

  it("rejects non-finite and malformed quantities", () => {
    for (const quantity of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => multiplyQuantity(100, quantity)).toThrow(/finito/);
    }
    for (const quantity of ["", "  ", "abc", "1,5", "1e3", ".5", "5.", "1.2.3", "--1", "0x10", "1 000"]) {
      expect(() => multiplyQuantity(100, quantity), quantity).toThrow(/no es un número válido/);
    }
  });

  it("keeps full precision when the intermediate product exceeds 2^53", () => {
    const unitPrice = 4_503_599_627_370_497; // 2^52 + 1; × 1.5 = …745.5 exactly
    expect(Math.round((unitPrice * 1500) / 1000)).toBe(6_755_399_441_055_745); // float math is off by one
    expect(multiplyQuantity(unitPrice, "1.5")).toBe(6_755_399_441_055_746);
    expect(multiplyQuantity(-unitPrice, "1.5")).toBe(-6_755_399_441_055_746);
    expect(multiplyQuantity(123_456_789_012_345, "12.345")).toBe(1_524_074_060_357_399);
  });

  it("supports integers in exponent notation and guards the result range", () => {
    expect(multiplyQuantity(0, 1e21)).toBe(0);
    expect(() => multiplyQuantity(1, 1e21)).toThrow(/rango/);
    expect(() => multiplyQuantity(Number.MAX_SAFE_INTEGER, 2)).toThrow(/rango/);
    expect(() => multiplyQuantity(1.5, 2)).toThrow(/céntimos/);
  });
});
