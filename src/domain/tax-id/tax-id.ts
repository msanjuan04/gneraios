// Spanish tax identifiers (DNI, NIE, CIF) and IBAN, validated with their official
// control-character algorithms.

export type TaxIdKind = "dni" | "nie" | "cif";

export interface TaxIdValidation {
  valid: boolean;
  /**
   * Format recognised from the shape of the normalized input, even when its control
   * character is wrong (so the UI can say "la letra del DNI no es correcta"); null when the
   * input matches no known format.
   */
  kind: TaxIdKind | null;
  normalized: string;
}

// Whitespace, dots and dashes (hyphen-minus, Unicode hyphens and dashes, minus sign).
const SEPARATORS = /[\s.‐-―−-]/g;

const DNI_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";
const CIF_CONTROL_LETTERS = "JABCDEFGHI";

const DNI_PATTERN = /^(\d{8})([A-Z])$/;
const NIE_PATTERN = /^([XYZ])(\d{7})([A-Z])$/;
// Organisation letters: A, B, E, H end in a digit; K, P, Q, S, N, W end in a letter;
// C, D, F, G, J, R, U, V accept either.
const CIF_PATTERN = /^([ABCDEFGHJKNPQRSUVW])(\d{7})([0-9A-Z])$/;
const CIF_DIGIT_ONLY = "ABEH";
const CIF_LETTER_ONLY = "KPQSNW";

/** Uppercases and removes spaces, dots and dashes: " 12.345.678-z " → "12345678Z". */
export function normalizeTaxId(input: string): string {
  return input.replace(SEPARATORS, "").toUpperCase();
}

/** Validates a DNI, NIE or CIF (NIF of an entity) with its official control character. */
export function validateSpanishTaxId(input: string): TaxIdValidation {
  const normalized = normalizeTaxId(input);
  const result = (valid: boolean, kind: TaxIdKind | null): TaxIdValidation => ({ valid, kind, normalized });

  const dni = DNI_PATTERN.exec(normalized);
  if (dni) return result(dniLetter(dni[1]) === dni[2], "dni");

  const nie = NIE_PATTERN.exec(normalized);
  if (nie) return result(dniLetter("XYZ".indexOf(nie[1]) + nie[2]) === nie[3], "nie");

  const cif = CIF_PATTERN.exec(normalized);
  if (cif) return result(isValidCifControl(cif[1], cif[2], cif[3]), "cif");

  return result(false, null);
}

function dniLetter(digits: string): string {
  return DNI_LETTERS[Number(digits) % 23];
}

/**
 * CIF control digit: digits in even positions are added; digits in odd positions are
 * doubled and the digits of each product added (Luhn). The control digit is
 * (10 − units of the sum) mod 10, and the control letter is "JABCDEFGHI"[digit].
 */
function cifControlDigit(digits: string): number {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    const digit = Number(digits[i]);
    const doubled = digit * 2;
    sum += i % 2 === 0 ? Math.floor(doubled / 10) + (doubled % 10) : digit;
  }
  return (10 - (sum % 10)) % 10;
}

function isValidCifControl(letter: string, digits: string, control: string): boolean {
  const expected = cifControlDigit(digits);
  const isDigit = control === String(expected);
  const isLetter = control === CIF_CONTROL_LETTERS[expected];
  if (CIF_DIGIT_ONLY.includes(letter)) return isDigit;
  if (CIF_LETTER_ONLY.includes(letter)) return isLetter;
  return isDigit || isLetter;
}

// Country-specific IBAN formats (length and BBAN charset); other countries only get the
// generic ISO 13616 checks.
const IBAN_PATTERN = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/;
const IBAN_COUNTRY_PATTERNS: Readonly<Record<string, RegExp>> = { ES: /^ES\d{22}$/ };

/** Electronic format: uppercase, without spaces, dots or dashes. */
export function normalizeIban(input: string): string {
  return input.replace(SEPARATORS, "").toUpperCase();
}

/** ISO 13616: structure, length for known countries (ES = 24), check digits 02–98 and mod 97 = 1. */
export function validateIban(input: string): boolean {
  const iban = normalizeIban(input);
  if (!IBAN_PATTERN.test(iban)) return false;
  const countryPattern = IBAN_COUNTRY_PATTERNS[iban.slice(0, 2)];
  if (countryPattern && !countryPattern.test(iban)) return false;
  const checkDigits = Number(iban.slice(2, 4));
  if (checkDigits < 2 || checkDigits > 98) return false;
  return ibanMod97(iban) === 1;
}

/** Print format: groups of four characters separated by spaces. Does not validate. */
export function formatIban(input: string): string {
  return normalizeIban(input).replace(/(.{4})(?!$)/g, "$1 ");
}

/** Moves the first 4 characters to the end, maps A–Z to 10–35 and reduces mod 97 piecewise. */
function ibanMod97(iban: string): number {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const char of rearranged) {
    const value = parseInt(char, 36);
    remainder = (remainder * (value > 9 ? 100 : 10) + value) % 97;
  }
  return remainder;
}
