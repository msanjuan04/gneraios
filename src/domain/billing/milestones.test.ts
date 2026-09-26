import { describe, expect, it } from "vitest";
import { splitByMilestones, validateMilestones } from "./milestones";

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
  return { int };
}

const plan = (...percents: number[]) => percents.map((percentBps, index) => ({ id: `m${index + 1}`, percentBps }));

/** Shares of a single line, in milestone order. */
function sharesOf(baseCents: number, percents: number[]): number[] {
  const split = splitByMilestones([{ id: "line", baseCents }], plan(...percents));
  return Object.values(split).map((byLine) => byLine.line);
}

describe("validateMilestones", () => {
  it("accepts plans that add up to exactly 100 %", () => {
    for (const percents of [[10_000], [5000, 5000], [4000, 3000, 3000], [3333, 3333, 3334], [2500, 2500, 2500, 2500], [1, 9999]]) {
      expect(validateMilestones(percents), percents.join("/")).toBeNull();
    }
  });

  it("requires at least one milestone", () => {
    expect(validateMilestones([])).toBe("milestonesEmpty");
  });

  it("requires every percent to be a positive integer of basis points", () => {
    for (const percents of [[0, 10_000], [-1000, 11_000], [5000, 0, 5000], [3333.33, 3333.33, 3333.34], [Number.NaN], [Number.POSITIVE_INFINITY], [0, 5000]]) {
      expect(validateMilestones(percents), percents.join("/")).toBe("milestonePercentInvalid");
    }
  });

  it("requires the percents to add up to 10 000", () => {
    for (const percents of [[5000, 4999], [5000, 5001], [3333, 3333, 3333], [10_001], [50, 50], [9999]]) {
      expect(validateMilestones(percents), percents.join("/")).toBe("milestonesSumNot100");
    }
  });
});

describe("splitByMilestones", () => {
  it("splits 50/50, giving the odd cent to the first milestone by rounding and the rest to the last", () => {
    expect(sharesOf(100_001, [5000, 5000])).toEqual([50_001, 50_000]); // 500,005 € → 500,01 + 500,00
    expect(sharesOf(999, [5000, 5000])).toEqual([500, 499]);
    expect(sharesOf(1, [5000, 5000])).toEqual([1, 0]);
    expect(sharesOf(0, [5000, 5000])).toEqual([0, 0]);
    expect(sharesOf(150_000, [5000, 5000])).toEqual([75_000, 75_000]);
  });

  it("splits 40/30/30 line by line", () => {
    const lines = [
      { id: "setup", baseCents: 150_000 },
      { id: "design", baseCents: 1999 },
      { id: "copy", baseCents: 1001 },
      { id: "domain", baseCents: 1 },
    ];
    expect(splitByMilestones(lines, plan(4000, 3000, 3000))).toEqual({
      m1: { setup: 60_000, design: 800, copy: 400, domain: 0 }, // 799,6 · 400,4 · 0,4
      m2: { setup: 45_000, design: 600, copy: 300, domain: 0 }, // 599,7 · 300,3 · 0,3
      m3: { setup: 45_000, design: 599, copy: 301, domain: 1 },
    });
  });

  it("splits 33.33/33.33/33.34 so that each line adds up to its base", () => {
    expect(sharesOf(100, [3333, 3333, 3334])).toEqual([33, 33, 34]);
    expect(sharesOf(99_999, [3333, 3333, 3334])).toEqual([33_330, 33_330, 33_339]); // 33 329,67 each
    expect(sharesOf(10, [3333, 3333, 3334])).toEqual([3, 3, 4]);
    expect(sharesOf(2, [3333, 3333, 3334])).toEqual([1, 1, 0]); // 0,67 rounds up twice: nothing left
    expect(sharesOf(100_000, [3333, 3333, 3334])).toEqual([33_330, 33_330, 33_340]);
  });

  it("bills the whole base with a single milestone", () => {
    expect(sharesOf(123_457, [10_000])).toEqual([123_457]);
  });

  it("is symmetric for negative bases", () => {
    expect(sharesOf(-1001, [4000, 3000, 3000])).toEqual([-400, -300, -301]);
    expect(sharesOf(-100_001, [5000, 5000])).toEqual([-50_001, -50_000]);
  });

  it("follows the rule even when it leaves the last milestone below zero (a few cents over many milestones)", () => {
    // 3 cents in 6 milestones: four round 0,5001 up to 1 cent, so the last one gets −1.
    expect(sharesOf(3, [1667, 1667, 1667, 1667, 1666, 1666])).toEqual([1, 1, 1, 1, 0, -1]);
  });

  it("always adds up to each base and rounds every milestone but the last", () => {
    const random = prng(403_030);
    const roundHalfAway = (value: number) => Math.sign(value) * Math.round(Math.abs(value));
    for (let i = 0; i < 500; i++) {
      // A random plan: 1–6 positive integer percents that add up to 10 000.
      const count = random.int(1, 6);
      const cuts = Array.from({ length: count - 1 }, () => random.int(1, 9999)).sort((a, b) => a - b);
      const bounds = [0, ...cuts, 10_000];
      const percents = bounds.slice(1).map((bound, index) => bound - bounds[index]);
      if (percents.some((percent) => percent === 0)) continue;
      expect(validateMilestones(percents)).toBeNull();

      const lines = Array.from({ length: random.int(0, 5) }, (_, index) => ({ id: `l${index}`, baseCents: random.int(-1e9, 1e9) }));
      const split = splitByMilestones(lines, plan(...percents));
      expect(Object.keys(split)).toEqual(percents.map((_, index) => `m${index + 1}`));
      for (const line of lines) {
        const shares = Object.values(split).map((byLine) => byLine[line.id]);
        expect(shares.reduce((sum, share) => sum + share, 0)).toBe(line.baseCents);
        shares.slice(0, -1).forEach((share, index) => {
          expect(share).toBe(roundHalfAway((line.baseCents * percents[index]) / 10_000) || 0);
        });
      }
    }
  });

  it("returns an empty split per milestone when there are no lines", () => {
    expect(splitByMilestones([], plan(5000, 5000))).toEqual({ m1: {}, m2: {} });
  });

  it("uses any id as a key, even __proto__", () => {
    const split = splitByMilestones([{ id: "__proto__", baseCents: 100 }], [{ id: "constructor", percentBps: 10_000 }]);
    expect(Object.keys(split)).toEqual(["constructor"]);
    const byLine: unknown = Object.getOwnPropertyDescriptor(split, "constructor")?.value;
    expect(Object.getOwnPropertyDescriptor(byLine, "__proto__")?.value).toBe(100);
  });

  it("rejects an invalid plan, repeated ids and non-integer amounts", () => {
    const lines = [{ id: "a", baseCents: 1000 }];
    expect(() => splitByMilestones(lines, plan(5000, 4000))).toThrow(/milestonesSumNot100/);
    expect(() => splitByMilestones(lines, [])).toThrow(/milestonesEmpty/);
    expect(() => splitByMilestones(lines, plan(0, 10_000))).toThrow(/milestonePercentInvalid/);
    expect(() => splitByMilestones([...lines, { id: "a", baseCents: 5 }], plan(10_000))).toThrow(/líneas/);
    expect(() => splitByMilestones(lines, [{ id: "m", percentBps: 5000 }, { id: "m", percentBps: 5000 }])).toThrow(/hitos/);
    expect(() => splitByMilestones([{ id: "a", baseCents: 10.5 }], plan(10_000))).toThrow(/céntimos/);
  });
});
