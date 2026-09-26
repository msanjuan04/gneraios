// Invoice line and invoice totals (ARCHITECTURE.md §7.1). Every amount is rounded once, per
// line, half away from zero; the invoice only adds up the rounded line amounts. Because the
// rounding is symmetric, a line with the unit price negated (a credit note, §7.5) yields the
// exact negation of every amount of the original line.

import { applyBps, assertBps, assertCents, multiplyQuantity, type Bps, type Cents } from "../money";

/** In the order the VAT breakdown lists regimes that share a rate. Same values as the `vat_regime` enum. */
export const VAT_REGIMES = ["general", "exempt", "reverse_charge_eu", "not_subject"] as const;

export type VatRegime = (typeof VAT_REGIMES)[number];

export type LineInput = {
  /** Up to 3 decimals, as stored in `numeric(12,3)`. */
  quantity: string | number;
  unitPriceCents: Cents;
  discountBps: Bps;
  vatBps: Bps;
  irpfBps: Bps;
  irpfApplies: boolean;
};

export type LineAmounts = {
  grossCents: Cents;
  discountCents: Cents;
  baseCents: Cents;
  vatCents: Cents;
  irpfCents: Cents;
  /** base + VAT − IRPF. */
  totalCents: Cents;
};

/** What the invoice totals need from each line (e.g. an `invoice_lines` row). */
export type TotalsLine = {
  baseCents: Cents;
  vatCents: Cents;
  irpfCents: Cents;
  vatBps: Bps;
  vatRegime: VatRegime;
};

export type VatBreakdownRow = { vatBps: Bps; vatRegime: VatRegime; baseCents: Cents; vatCents: Cents };

export type InvoiceTotals = {
  subtotalCents: Cents;
  vatCents: Cents;
  irpfCents: Cents;
  /** Total a cobrar: subtotal + VAT − IRPF. */
  totalCents: Cents;
  /** One row per (rate, regime), by rate descending, then in the order of VAT_REGIMES. */
  breakdown: VatBreakdownRow[];
};

const MAX_BPS = 10_000;

function assertRate(bps: Bps, what: string): Bps {
  assertBps(bps);
  if (bps < 0 || bps > MAX_BPS) throw new Error(`${what} debe estar entre 0 y 10 000 puntos básicos: ${bps}.`);
  return bps;
}

/** a + b, or throws if the exact sum is not a safe integer (so it can never lose a cent). */
function add(a: Cents, b: Cents): Cents {
  return assertCents(a + b);
}

/**
 * Amounts of one line:
 * 1. gross = round(unit price × quantity)
 * 2. discount = round(gross × discount / 10 000); base = gross − discount
 * 3. VAT = round(base × VAT / 10 000)
 * 4. IRPF = round(base × IRPF / 10 000) if the line is subject to it, else 0
 * 5. total = base + VAT − IRPF
 */
export function computeLine(input: LineInput): LineAmounts {
  const discountBps = assertRate(input.discountBps, "El descuento");
  const vatBps = assertRate(input.vatBps, "El IVA");
  const irpfBps = assertRate(input.irpfBps, "El IRPF");

  const grossCents = multiplyQuantity(input.unitPriceCents, input.quantity);
  const discountCents = applyBps(grossCents, discountBps);
  const baseCents = add(grossCents, -discountCents);
  const vatCents = applyBps(baseCents, vatBps);
  const irpfCents = input.irpfApplies ? applyBps(baseCents, irpfBps) : 0;
  const totalCents = add(add(baseCents, vatCents), -irpfCents);
  return { grossCents, discountCents, baseCents, vatCents, irpfCents, totalCents };
}

/**
 * Invoice totals as the sums of the (already rounded) line amounts. The VAT breakdown groups
 * the lines by rate and regime and adds up their VAT; it never recomputes VAT on the grouped
 * base, so it always matches the lines to the cent.
 */
export function computeInvoiceTotals(lines: readonly TotalsLine[]): InvoiceTotals {
  let subtotalCents = 0;
  let vatCents = 0;
  let irpfCents = 0;
  const groups = new Map<string, VatBreakdownRow>();

  for (const line of lines) {
    assertCents(line.baseCents);
    assertCents(line.vatCents);
    assertCents(line.irpfCents);
    const vatBps = assertRate(line.vatBps, "El IVA");
    if (!VAT_REGIMES.includes(line.vatRegime)) throw new Error(`Régimen de IVA desconocido: ${String(line.vatRegime)}.`);

    subtotalCents = add(subtotalCents, line.baseCents);
    vatCents = add(vatCents, line.vatCents);
    irpfCents = add(irpfCents, line.irpfCents);

    const key = `${vatBps}:${line.vatRegime}`;
    const group = groups.get(key) ?? { vatBps, vatRegime: line.vatRegime, baseCents: 0, vatCents: 0 };
    group.baseCents = add(group.baseCents, line.baseCents);
    group.vatCents = add(group.vatCents, line.vatCents);
    groups.set(key, group);
  }

  const breakdown = [...groups.values()].sort(
    (a, b) => b.vatBps - a.vatBps || VAT_REGIMES.indexOf(a.vatRegime) - VAT_REGIMES.indexOf(b.vatRegime),
  );
  const totalCents = add(add(subtotalCents, vatCents), -irpfCents);
  return { subtotalCents, vatCents, irpfCents, totalCents, breakdown };
}

/**
 * The same line with its unit price negated, for a rectifying invoice (§7.5). Every other
 * field, including any extra ones, is kept. A zero price stays 0 (never −0).
 */
export function negateLineInput<T extends Pick<LineInput, "unitPriceCents">>(input: T): T {
  const unitPriceCents = assertCents(input.unitPriceCents);
  return { ...input, unitPriceCents: unitPriceCents === 0 ? 0 : -unitPriceCents };
}
