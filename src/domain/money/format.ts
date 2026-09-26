import { assertBps, assertCents, type Bps, type Cents } from "./money";

const formatters = new Map<string, Intl.NumberFormat>();

function formatter(key: string, create: () => Intl.NumberFormat): Intl.NumberFormat {
  let cached = formatters.get(key);
  if (!cached) {
    cached = create();
    formatters.set(key, cached);
  }
  return cached;
}

/**
 * Exact decimal string for value / 10^scale (473000, 2 → "4730.00"), so Intl formats the
 * exact amount instead of a binary float approximation.
 */
function toDecimalString(value: number, scale: number): `${number}` {
  const digits = String(Math.abs(value)).padStart(scale + 1, "0");
  const sign = value < 0 ? "-" : "";
  return `${sign}${digits.slice(0, -scale)}.${digits.slice(-scale)}` as `${number}`;
}

/**
 * Formats cents (hundredths of the currency unit) as currency: 473000 → "4.730,00 €".
 * Grouping is forced to "always" because es-ES does not group 4-digit numbers by default
 * and would print "4730,00 €". Intl puts a non-breaking space (U+00A0) before "€".
 */
export function formatMoney(
  cents: Cents,
  opts: { locale?: string; currency?: string; wholeUnits?: boolean } = {},
): string {
  const { locale = "es-ES", currency = "EUR" } = opts;
  // `wholeUnits`: sin céntimos cuando el importe es redondo (estimaciones, KPIs): "12.000 €".
  const whole = opts.wholeUnits === true && assertCents(cents) % 100 === 0;
  const nf = formatter(`money:${locale}:${currency}:${whole}`, () =>
    new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      useGrouping: "always",
      ...(whole && { minimumFractionDigits: 0, maximumFractionDigits: 0 }),
    }),
  );
  return nf.format(toDecimalString(assertCents(cents), 2));
}

/** Formats basis points as a percentage: 2100 → "21 %", 1550 → "15,5 %". */
export function formatBps(bps: Bps, locale = "es-ES"): string {
  const nf = formatter(`bps:${locale}`, () =>
    new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 2 }),
  );
  return nf.format(toDecimalString(assertBps(bps), 4));
}

const MONEY_INPUT = /^(-?)(€?)([\d.,]+)(€?)$/;
const GROUPED_INTEGER = /^\d{1,3}(?:\.\d{3})+$/;
const DOT_DECIMAL = /^(\d*)\.(\d{1,2})$/;

/**
 * Parses what a Spanish user types into a money field. Returns null if the input is not
 * a valid amount. The rule:
 *
 * 1. Whitespace (including non-breaking spaces) is ignored anywhere, so "1 234,56" works.
 *    A single "€" is allowed at the start or at the end, and a leading "-" makes the
 *    amount negative ("-1.234,56 €", "-€12").
 * 2. If there is a comma, it is the decimal separator and must be followed by 1–2 digits.
 *    Dots before it are thousands separators in groups of three: "1.234,56", "1234,5".
 * 3. Without a comma, a single dot followed by exactly 1–2 digits is the decimal
 *    separator ("1234.5", "12.34", numeric keypad style). Otherwise dots are thousands
 *    separators in groups of three: "1.234" is 1.234,00 €, "1.234.567" is 1.234.567,00 €.
 * 4. The integer part may be empty when there are decimals (",5" and ".5" are 0,50 €).
 *
 * Anything else is null: more than 2 decimals ("12,345", "1.2345"), malformed groups
 * ("12.34.56"), US style ("1,234.56"), a dangling separator ("12,", "12."), letters,
 * "+" or repeated signs, and amounts beyond the safe integer range.
 */
export function parseMoneyInput(input: string): Cents | null {
  if (typeof input !== "string") return null;
  const match = MONEY_INPUT.exec(input.replace(/\s+/g, ""));
  if (!match) return null;
  const [, sign, prefix, body, suffix] = match;
  if (prefix && suffix) return null;

  let integerPart = body;
  let fractionPart = "";
  const comma = body.indexOf(",");
  if (comma !== -1) {
    integerPart = body.slice(0, comma);
    fractionPart = body.slice(comma + 1);
    if (!/^\d{1,2}$/.test(fractionPart)) return null;
  } else {
    const dotDecimal = DOT_DECIMAL.exec(body);
    if (dotDecimal) [, integerPart, fractionPart] = dotDecimal;
  }

  if (integerPart.includes(".")) {
    if (!GROUPED_INTEGER.test(integerPart)) return null;
    integerPart = integerPart.replace(/\./g, "");
  }

  const cents = BigInt(integerPart || "0") * BigInt(100) + BigInt(fractionPart.padEnd(2, "0"));
  const value = Number(sign === "-" ? -cents : cents);
  return Number.isSafeInteger(value) ? value : null;
}
