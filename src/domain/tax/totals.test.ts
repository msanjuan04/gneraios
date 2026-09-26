import { describe, expect, expectTypeOf, it } from "vitest";
import { SPAIN_TAX_DEFAULTS, type TaxRateDefault } from "./spain-defaults";
import {
  computeInvoiceTotals,
  computeLine,
  negateLineInput,
  VAT_REGIMES,
  type InvoiceTotals,
  type LineAmounts,
  type LineInput,
  type TotalsLine,
  type VatRegime,
} from "./totals";

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
  return { int, pick, bool: () => next() < 0.5 };
}

const line = (overrides: Partial<LineInput> = {}): LineInput => ({
  quantity: "1",
  unitPriceCents: 0,
  discountBps: 0,
  vatBps: 2100,
  irpfBps: 0,
  irpfApplies: false,
  ...overrides,
});

type RegimeLine = LineInput & { vatRegime: VatRegime };

/** Computes the lines and the invoice exactly as the server does before issuing. */
function invoice(lines: readonly RegimeLine[]): { lines: LineAmounts[]; totals: InvoiceTotals } {
  const amounts = lines.map((input) => computeLine(input));
  const totalsLines: TotalsLine[] = amounts.map((amount, i) => ({
    ...amount,
    vatBps: lines[i].vatBps,
    vatRegime: lines[i].vatRegime,
  }));
  return { lines: amounts, totals: computeInvoiceTotals(totalsLines) };
}

/** Negation without producing -0, which `toBe` / `toEqual` distinguish from 0. */
const neg = (value: number) => (value === 0 ? 0 : -value);

const negateAmounts = <T extends Record<string, number>>(values: T): T =>
  Object.fromEntries(Object.entries(values).map(([key, value]) => [key, neg(value)])) as T;

const negateTotals = (totals: InvoiceTotals): InvoiceTotals => ({
  subtotalCents: neg(totals.subtotalCents),
  vatCents: neg(totals.vatCents),
  irpfCents: neg(totals.irpfCents),
  totalCents: neg(totals.totalCents),
  breakdown: totals.breakdown.map((row) => ({ ...row, baseCents: neg(row.baseCents), vatCents: neg(row.vatCents) })),
});

describe("computeLine", () => {
  it("reproduces the example invoice of ARCHITECTURE.md §7.1 (self-employed, IRPF 15 %)", () => {
    const maintenance = computeLine(line({ quantity: 1, unitPriceCents: 15000, irpfBps: 1500, irpfApplies: true }));
    const metaAds = computeLine(line({ quantity: "2", unitPriceCents: 37500, irpfBps: 1500, irpfApplies: true }));
    expect(maintenance).toEqual({
      grossCents: 15000,
      discountCents: 0,
      baseCents: 15000,
      vatCents: 3150,
      irpfCents: 2250,
      totalCents: 15900,
    });
    expect(metaAds).toEqual({
      grossCents: 75000,
      discountCents: 0,
      baseCents: 75000,
      vatCents: 15750,
      irpfCents: 11250,
      totalCents: 79500,
    });
    expect(maintenance.totalCents + metaAds.totalCents).toBe(95400);
  });

  it("applies the discount to the gross amount and taxes the discounted base", () => {
    expect(computeLine(line({ unitPriceCents: 100000, discountBps: 1000 }))).toEqual({
      grossCents: 100000,
      discountCents: 10000,
      baseCents: 90000,
      vatCents: 18900,
      irpfCents: 0,
      totalCents: 108900,
    });
    // 3 × 33,33 € = 99,99 €; 12,5 % = 12,49875 € → 12,50 €; IVA de 87,49 € = 18,3729 € → 18,37 €.
    expect(computeLine(line({ quantity: 3, unitPriceCents: 3333, discountBps: 1250 }))).toEqual({
      grossCents: 9999,
      discountCents: 1250,
      baseCents: 8749,
      vatCents: 1837,
      irpfCents: 0,
      totalCents: 10586,
    });
    expect(computeLine(line({ unitPriceCents: 5000, discountBps: 10_000, irpfBps: 1500, irpfApplies: true }))).toEqual({
      grossCents: 5000,
      discountCents: 5000,
      baseCents: 0,
      vatCents: 0,
      irpfCents: 0,
      totalCents: 0,
    });
  });

  it("withholds IRPF only when the line is subject to it", () => {
    const subject = computeLine(line({ unitPriceCents: 100000, irpfBps: 1500, irpfApplies: true }));
    const exempt = computeLine(line({ unitPriceCents: 100000, irpfBps: 1500, irpfApplies: false }));
    expect(subject).toMatchObject({ baseCents: 100000, vatCents: 21000, irpfCents: 15000, totalCents: 106000 });
    expect(exempt).toMatchObject({ baseCents: 100000, vatCents: 21000, irpfCents: 0, totalCents: 121000 });
    expect(computeLine(line({ unitPriceCents: 100000, irpfBps: 700, irpfApplies: true }))).toMatchObject({
      irpfCents: 7000,
      totalCents: 114000,
    });
  });

  it("charges no VAT at 0 % but still withholds IRPF on the base", () => {
    expect(computeLine(line({ unitPriceCents: 120000, vatBps: 0 }))).toMatchObject({ vatCents: 0, totalCents: 120000 });
    expect(computeLine(line({ unitPriceCents: 100000, vatBps: 0, irpfBps: 1500, irpfApplies: true }))).toMatchObject({
      baseCents: 100000,
      vatCents: 0,
      irpfCents: 15000,
      totalCents: 85000,
    });
  });

  it("multiplies quantities with up to 3 decimals exactly", () => {
    expect(computeLine(line({ quantity: 1.5, unitPriceCents: 4500 }))).toMatchObject({
      grossCents: 6750,
      vatCents: 1418, // 1417,5
      totalCents: 8168,
    });
    expect(computeLine(line({ quantity: "0.333", unitPriceCents: 100 }))).toMatchObject({ grossCents: 33 }); // 33,3
    expect(computeLine(line({ quantity: "2.125", unitPriceCents: 1999 }))).toMatchObject({
      grossCents: 4248, // 4247,875
      vatCents: 892, // 892,08
    });
    expect(computeLine(line({ quantity: "12.345", unitPriceCents: 12345 }))).toMatchObject({ grossCents: 152399 });
    expect(computeLine(line({ quantity: "1.005", unitPriceCents: 100 }))).toMatchObject({ grossCents: 101 }); // not float math
    expect(computeLine(line({ quantity: "0.001", unitPriceCents: 500 }))).toMatchObject({ grossCents: 1 }); // 0,5
  });

  it("rounds every half cent away from zero, in both signs", () => {
    const cases: [Partial<LineInput>, Partial<LineAmounts>][] = [
      [{ quantity: "0.5", unitPriceCents: 1, vatBps: 0 }, { grossCents: 1 }],
      [{ quantity: "0.5", unitPriceCents: 3, vatBps: 0 }, { grossCents: 2 }],
      [{ unitPriceCents: 10, discountBps: 500, vatBps: 0 }, { discountCents: 1, baseCents: 9 }],
      [{ unitPriceCents: 50 }, { vatCents: 11 }], // 10,5
      [{ unitPriceCents: 150 }, { vatCents: 32 }], // 31,5
      [{ unitPriceCents: 250 }, { vatCents: 53 }], // 52,5
      [{ unitPriceCents: 69 }, { vatCents: 14 }], // 14,49
      [{ unitPriceCents: 31 }, { vatCents: 7 }], // 6,51
      [{ unitPriceCents: 10, irpfBps: 1500, irpfApplies: true }, { irpfCents: 2 }], // 1,5
      [{ unitPriceCents: 50, irpfBps: 700, irpfApplies: true }, { irpfCents: 4 }], // 3,5
      [{ unitPriceCents: 50, irpfBps: 1500, irpfApplies: true }, { vatCents: 11, irpfCents: 8, totalCents: 53 }],
    ];
    for (const [input, expected] of cases) {
      const label = JSON.stringify(input);
      expect(computeLine(line(input)), label).toMatchObject(expected);
      const negated = computeLine(negateLineInput(line(input)));
      expect(negated, `-${label}`).toMatchObject(negateAmounts(expected as Record<string, number>));
    }
  });

  it("rejects rates out of range and malformed amounts", () => {
    for (const discountBps of [-1, 10_001, 1.5]) {
      expect(() => computeLine(line({ unitPriceCents: 100, discountBps })), String(discountBps)).toThrow(/descuento|puntos básicos/);
    }
    expect(() => computeLine(line({ unitPriceCents: 100, vatBps: -2100 }))).toThrow(/IVA/);
    expect(() => computeLine(line({ unitPriceCents: 100, vatBps: 2100.5 }))).toThrow(/puntos básicos/);
    expect(() => computeLine(line({ unitPriceCents: 100, irpfBps: 20_000, irpfApplies: false }))).toThrow(/IRPF/);
    expect(() => computeLine(line({ unitPriceCents: 10.5 }))).toThrow(/céntimos/);
    expect(() => computeLine(line({ unitPriceCents: 100, quantity: "1,5" }))).toThrow(/cantidad/);
    expect(() => computeLine(line({ unitPriceCents: 100, quantity: "0.0001" }))).toThrow(/3 decimales/);
    expect(() => computeLine(line({ unitPriceCents: Number.MAX_SAFE_INTEGER, vatBps: 10_000 }))).toThrow(/rango|céntimos/);
  });
});

describe("computeInvoiceTotals", () => {
  it("reproduces the example invoice of ARCHITECTURE.md §7.1: total to collect 954,00 €", () => {
    const { totals } = invoice([
      { ...line({ quantity: 1, unitPriceCents: 15000, irpfBps: 1500, irpfApplies: true }), vatRegime: "general" },
      { ...line({ quantity: 2, unitPriceCents: 37500, irpfBps: 1500, irpfApplies: true }), vatRegime: "general" },
    ]);
    expect(totals).toEqual({
      subtotalCents: 90000,
      vatCents: 18900,
      irpfCents: 13500,
      totalCents: 95400,
      breakdown: [{ vatBps: 2100, vatRegime: "general", baseCents: 90000, vatCents: 18900 }],
    });
  });

  it("returns zeros for an invoice without lines", () => {
    expect(computeInvoiceTotals([])).toEqual({ subtotalCents: 0, vatCents: 0, irpfCents: 0, totalCents: 0, breakdown: [] });
  });

  it("adds up the per-line VAT instead of recomputing it on the grouped base", () => {
    // Three lines of 0,50 €: 0,105 € of VAT each rounds to 0,11 €, so 0,33 € (not 0,315 → 0,32 €).
    const halves = computeInvoiceTotals(
      Array.from({ length: 3 }, () => ({ baseCents: 50, vatCents: 11, irpfCents: 0, vatBps: 2100, vatRegime: "general" as const })),
    );
    expect(halves.breakdown).toEqual([{ vatBps: 2100, vatRegime: "general", baseCents: 150, vatCents: 33 }]);
    expect(halves).toMatchObject({ subtotalCents: 150, vatCents: 33, totalCents: 183 });

    // Ten lines of 0,02 €: no VAT on any line, so none on the invoice (not 0,042 € → 0,04 €).
    const { totals } = invoice(Array.from({ length: 10 }, () => ({ ...line({ unitPriceCents: 2 }), vatRegime: "general" as const })));
    expect(totals.breakdown).toEqual([{ vatBps: 2100, vatRegime: "general", baseCents: 20, vatCents: 0 }]);
    expect(totals.vatCents).toBe(0);
  });

  it("groups by rate and regime, by rate descending and then by regime", () => {
    const lines: RegimeLine[] = [
      { ...line({ unitPriceCents: 10000, vatBps: 0 }), vatRegime: "not_subject" },
      { ...line({ unitPriceCents: 20000, vatBps: 1000 }), vatRegime: "general" },
      { ...line({ unitPriceCents: 30000, vatBps: 0 }), vatRegime: "exempt" },
      { ...line({ unitPriceCents: 40000, vatBps: 2100 }), vatRegime: "general" },
      { ...line({ unitPriceCents: 50000, vatBps: 0 }), vatRegime: "reverse_charge_eu" },
      { ...line({ unitPriceCents: 60000, vatBps: 400 }), vatRegime: "general" },
      { ...line({ unitPriceCents: 1000, vatBps: 2100 }), vatRegime: "general" },
      { ...line({ unitPriceCents: 2500, vatBps: 0 }), vatRegime: "exempt" },
      { ...line({ unitPriceCents: 7000, vatBps: 0 }), vatRegime: "general" }, // a 0 % general rate is allowed
    ];
    const { totals } = invoice(lines);
    expect(totals.breakdown).toEqual([
      { vatBps: 2100, vatRegime: "general", baseCents: 41000, vatCents: 8610 },
      { vatBps: 1000, vatRegime: "general", baseCents: 20000, vatCents: 2000 },
      { vatBps: 400, vatRegime: "general", baseCents: 60000, vatCents: 2400 },
      { vatBps: 0, vatRegime: "general", baseCents: 7000, vatCents: 0 },
      { vatBps: 0, vatRegime: "exempt", baseCents: 32500, vatCents: 0 },
      { vatBps: 0, vatRegime: "reverse_charge_eu", baseCents: 50000, vatCents: 0 },
      { vatBps: 0, vatRegime: "not_subject", baseCents: 10000, vatCents: 0 },
    ]);
    expect(totals).toMatchObject({ subtotalCents: 220500, vatCents: 13010, irpfCents: 0, totalCents: 233510 });
  });

  it("keeps groups whose lines cancel out, e.g. a rectification by differences", () => {
    const { totals } = invoice([
      { ...line({ unitPriceCents: 10000 }), vatRegime: "general" },
      { ...line({ unitPriceCents: -10000 }), vatRegime: "general" },
    ]);
    expect(totals).toEqual({
      subtotalCents: 0,
      vatCents: 0,
      irpfCents: 0,
      totalCents: 0,
      breakdown: [{ vatBps: 2100, vatRegime: "general", baseCents: 0, vatCents: 0 }],
    });
  });

  it("rejects malformed lines", () => {
    const valid: TotalsLine = { baseCents: 100, vatCents: 21, irpfCents: 0, vatBps: 2100, vatRegime: "general" };
    expect(() => computeInvoiceTotals([{ ...valid, baseCents: 100.5 }])).toThrow(/céntimos/);
    expect(() => computeInvoiceTotals([{ ...valid, vatCents: Number.NaN }])).toThrow(/céntimos/);
    expect(() => computeInvoiceTotals([{ ...valid, irpfCents: "15" as unknown as number }])).toThrow(/céntimos/);
    expect(() => computeInvoiceTotals([{ ...valid, vatBps: -1 }])).toThrow(/IVA/);
    expect(() => computeInvoiceTotals([{ ...valid, vatRegime: "reduced" as VatRegime }])).toThrow(/Régimen/);
    const huge = { ...valid, baseCents: Number.MAX_SAFE_INTEGER, vatCents: 0 };
    expect(() => computeInvoiceTotals([huge, huge])).toThrow(/céntimos/);
  });
});

describe("negateLineInput", () => {
  it("flips the unit price and keeps every other field", () => {
    const original = { ...line({ quantity: "2.5", unitPriceCents: 37500, discountBps: 500 }), vatRegime: "general" as const, id: "l1" };
    const negated = negateLineInput(original);
    expect(negated).toEqual({ ...original, unitPriceCents: -37500 });
    expect(original.unitPriceCents).toBe(37500); // not mutated
    expect(negateLineInput(negated)).toEqual(original);
  });

  it("never produces -0", () => {
    expect(Object.is(negateLineInput(line({ unitPriceCents: 0 })).unitPriceCents, 0)).toBe(true);
  });

  it("makes a fully negated invoice the exact negation of the original", () => {
    const random = prng(954);
    const vatRates = [
      [2100, "general"], [1000, "general"], [400, "general"], [0, "general"],
      [0, "exempt"], [0, "reverse_charge_eu"], [0, "not_subject"],
    ] as const;
    for (let i = 0; i < 1000; i++) {
      const lines: RegimeLine[] = Array.from({ length: random.int(1, 12) }, () => {
        const [vatBps, vatRegime] = random.pick(vatRates);
        const decimals = random.int(0, 3);
        const quantity = decimals === 0 ? String(random.int(0, 500)) : `${random.int(0, 99)}.${String(random.int(0, 10 ** decimals - 1)).padStart(decimals, "0")}`;
        return {
          quantity: random.bool() ? quantity : Number(quantity),
          unitPriceCents: random.int(0, 5_000_000) * random.pick([1, 1, 1, -1]),
          discountBps: random.pick([0, 0, 500, 1000, 1250, 3333, 10_000]),
          vatBps,
          vatRegime,
          irpfBps: random.pick([0, 700, 1500]),
          irpfApplies: random.bool(),
        };
      });

      const original = invoice(lines);
      const rectifying = invoice(lines.map((input) => negateLineInput(input)));
      expect(rectifying.lines).toEqual(original.lines.map((amounts) => negateAmounts(amounts)));
      expect(rectifying.totals).toEqual(negateTotals(original.totals));

      // The invoice is always the sum of its lines, and each line is within half a cent of exact.
      const { totals } = original;
      expect(totals.totalCents).toBe(totals.subtotalCents + totals.vatCents - totals.irpfCents);
      expect(totals.breakdown.reduce((sum, row) => sum + row.baseCents, 0)).toBe(totals.subtotalCents);
      expect(totals.breakdown.reduce((sum, row) => sum + row.vatCents, 0)).toBe(totals.vatCents);
      original.lines.forEach((amounts, index) => {
        const exactTimes10k = BigInt(amounts.baseCents) * BigInt(lines[index].vatBps);
        const error = BigInt(amounts.vatCents) * BigInt(10_000) - exactTimes10k;
        expect(error <= BigInt(5000) && error >= BigInt(-5000)).toBe(true);
        expect(amounts.totalCents).toBe(amounts.baseCents + amounts.vatCents - amounts.irpfCents);
      });
    }
  });
});

describe("VatRegime", () => {
  it("has the same values as the regimes of the tax rate defaults", () => {
    expectTypeOf<VatRegime>().toEqualTypeOf<NonNullable<TaxRateDefault["regime"]>>();
    const defaults = new Set(SPAIN_TAX_DEFAULTS.filter((rate) => rate.kind === "vat").map((rate) => rate.regime));
    expect(defaults).toEqual(new Set(VAT_REGIMES));
  });
});
