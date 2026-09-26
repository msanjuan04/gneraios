// Money primitives (ARCHITECTURE.md §6.1, §7.1). Amounts are always integers and every
// intermediate product is computed with BigInt, because cents × quantity × basis points
// can exceed 2^53. Rounding is half away from zero, which is symmetric: a full credit
// note is always the exact negation of the original invoice.

/** Integer number of euro cents (a safe integer). */
export type Cents = number;

/** Integer basis points: 2100 = 21 %. */
export type Bps = number;

const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);
const BPS_SCALE = BigInt(10_000);
const QUANTITY_SCALE = BigInt(1_000);
const QUANTITY_DECIMALS = 3;
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE = BigInt(Number.MIN_SAFE_INTEGER);
const DECIMAL_PATTERN = /^([+-]?)(\d+)(?:\.(\d+))?$/;

/**
 * Exact integer division rounded half away from zero: 5/2 → 3, −5/2 → −3, 7/3 → 2.
 * The denominator must be positive.
 */
export function divRoundHalfAwayFromZero(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= ZERO) {
    throw new Error("El divisor debe ser un entero positivo.");
  }
  const quotient = numerator / denominator; // truncates toward zero
  const remainder = numerator % denominator; // takes the sign of the numerator
  const twiceRemainder = (remainder < ZERO ? -remainder : remainder) * TWO;
  if (twiceRemainder < denominator) return quotient;
  return numerator < ZERO ? quotient - ONE : quotient + ONE;
}

/** Returns `value` as Cents, or throws if it is not a safe integer. */
export function assertCents(value: number): Cents {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`El importe debe ser un número entero de céntimos: ${String(value)}.`);
  }
  return value;
}

/** Returns `value` as Bps, or throws if it is not a safe integer. */
export function assertBps(value: number): Bps {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`El porcentaje debe ser un número entero de puntos básicos: ${String(value)}.`);
  }
  return value;
}

/** amount × bps / 10 000, rounded half away from zero (e.g. 21 % VAT of a line base). */
export function applyBps(amount: Cents, bps: Bps): Cents {
  const product = BigInt(assertCents(amount)) * BigInt(assertBps(bps));
  return toCents(divRoundHalfAwayFromZero(product, BPS_SCALE));
}

/**
 * unitPrice × quantity, rounded half away from zero. The quantity (up to 3 decimals, as
 * stored in `numeric(12,3)`) is read from its decimal representation into exact
 * thousandths, never through float multiplication: 100 × 1.005 is 101, not 100.
 */
export function multiplyQuantity(unitPrice: Cents, quantity: string | number): Cents {
  const product = BigInt(assertCents(unitPrice)) * quantityToThousandths(quantity);
  return toCents(divRoundHalfAwayFromZero(product, QUANTITY_SCALE));
}

function toCents(value: bigint): Cents {
  if (value > MAX_SAFE || value < MIN_SAFE) {
    throw new Error("El importe resultante excede el rango admitido.");
  }
  return Number(value);
}

/** "1.5" → 1500, "-0.333" → -333, 2 → 2000. Trailing zeros beyond 3 decimals are exact. */
function quantityToThousandths(quantity: string | number): bigint {
  const text = typeof quantity === "number" ? numberToDecimal(quantity) : String(quantity).trim();
  const match = DECIMAL_PATTERN.exec(text);
  if (!match) {
    throw new Error(`La cantidad no es un número válido: «${String(quantity)}».`);
  }
  const [, sign, integerPart, fractionPart = ""] = match;
  const fraction = fractionPart.replace(/0+$/, "");
  if (fraction.length > QUANTITY_DECIMALS) {
    throw new Error(`La cantidad admite como máximo 3 decimales: «${String(quantity)}».`);
  }
  const thousandths = BigInt(integerPart + fraction.padEnd(QUANTITY_DECIMALS, "0"));
  return sign === "-" ? -thousandths : thousandths;
}

/** Shortest round-trip decimal of a JS number (0.333 → "0.333"), without exponent notation. */
function numberToDecimal(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`La cantidad debe ser un número finito: ${String(value)}.`);
  }
  const text = String(value);
  if (!text.includes("e")) return text;
  // Exponent notation only appears for |value| ≥ 1e21 (always an integer) or |value| < 1e-6.
  if (Number.isInteger(value)) return BigInt(value).toString();
  throw new Error(`La cantidad admite como máximo 3 decimales: «${text}».`);
}
