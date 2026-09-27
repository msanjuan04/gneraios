// Los valores que se reconocen por su forma dentro de una línea: fechas (dd/mm/aaaa y «15 de marzo
// de 2025»), importes («1.234,56 €»), porcentajes, NIF y cuentas IBAN. Cada uno con su posición en
// la línea, para después buscar su etiqueta a la izquierda o encima.

import { formatCivil, parseCivilDate, type CivilDate } from "../dates/civil-date";
import { normalizeTaxId, validateSpanishTaxId } from "../tax-id";
import { foldSameLength } from "./text";

export type Span = { start: number; end: number };
export type DateToken = Span & { value: CivilDate };
export type MoneyToken = Span & { cents: number; currency: boolean };
export type PercentToken = Span & { bps: number };
export type TaxIdToken = Span & { value: string; kind: "es" | "eu_vat" };
export type NumberToken = Span & { value: string };

const MIN_YEAR = 1990;
const MAX_YEAR = 2100;

function civil(year: number, month: number, day: number): CivilDate | null {
  if (year < MIN_YEAR || year > MAX_YEAR) return null;
  try {
    const value = formatCivil({ year, month, day });
    parseCivilDate(value);
    return value;
  } catch {
    return null;
  }
}

const fullYear = (text: string) => (text.length === 4 ? Number(text) : 2000 + Number(text));

// Meses en castellano, catalán e inglés (plegados: sin acentos y en minúscula), con abreviaturas.
const MONTHS: Readonly<Record<string, number>> = {
  enero: 1, ene: 1, gener: 1, gen: 1, january: 1, jan: 1,
  febrero: 2, feb: 2, febr: 2, febrer: 2, february: 2,
  marzo: 3, mar: 3, marc: 3, march: 3,
  abril: 4, abr: 4, april: 4, apr: 4,
  mayo: 5, may: 5, maig: 5,
  junio: 6, jun: 6, juny: 6, june: 6,
  julio: 7, jul: 7, juliol: 7, july: 7,
  agosto: 8, ago: 8, agost: 8, ag: 8, august: 8, aug: 8,
  septiembre: 9, setiembre: 9, sept: 9, sep: 9, set: 9, setembre: 9, september: 9,
  octubre: 10, oct: 10, october: 10,
  noviembre: 11, nov: 11, novembre: 11, november: 11,
  diciembre: 12, dic: 12, desembre: 12, des: 12, december: 12, dec: 12,
};
const MONTH_ALT = Object.keys(MONTHS)
  .sort((a, b) => b.length - a.length)
  .join("|");

const NUMERIC_DATE = /(?<![\p{L}\p{N}/.])(\d{1,2})([/.-])(\d{1,2})\2(\d{4}|\d{2})(?![\p{N}/]|[.-]\d)/gu;
const ISO_DATE = /(?<![\p{L}\p{N}/.-])(\d{4})-(\d{2})-(\d{2})(?![\p{N}/]|[.-]\d)/gu;
const TEXT_DATE = new RegExp(
  `(?<![\\p{L}\\p{N}])(\\d{1,2})(?:\\s*(?:de|d'|del)\\s*|\\s*[-/.]\\s*|\\s+)(${MONTH_ALT})\\.?(?:\\s*(?:de|del|,)\\s*|\\s*[-/.]\\s*|\\s+)(\\d{4})(?!\\p{N})`,
  "gu",
);
const TEXT_DATE_MONTH_FIRST = new RegExp(`(?<![\\p{L}\\p{N}])(${MONTH_ALT})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})(?!\\p{N})`, "gu");

/** Fechas de la línea, en orden. dd/mm siempre (España); aaaa-mm-dd y con el mes en letra también. */
export function findDates(line: string): DateToken[] {
  const found: DateToken[] = [];
  const add = (start: number, end: number, value: CivilDate | null) => {
    if (value && !found.some((d) => d.start < end && start < d.end)) found.push({ start, end, value });
  };
  for (const m of line.matchAll(ISO_DATE)) add(m.index, m.index + m[0].length, civil(Number(m[1]), Number(m[2]), Number(m[3])));
  for (const m of line.matchAll(NUMERIC_DATE)) {
    add(m.index, m.index + m[0].length, civil(fullYear(m[4]!), Number(m[3]), Number(m[1])));
  }
  const folded = foldSameLength(line);
  for (const m of folded.matchAll(TEXT_DATE)) {
    add(m.index, m.index + m[0].length, civil(Number(m[3]), MONTHS[m[2]!] ?? 0, Number(m[1])));
  }
  for (const m of folded.matchAll(TEXT_DATE_MONTH_FIRST)) {
    add(m.index, m.index + m[0].length, civil(Number(m[3]), MONTHS[m[1]!] ?? 0, Number(m[2])));
  }
  return found.sort((a, b) => a.start - b.start);
}

// ---------------------------------------------------------------------------
// Porcentajes
// ---------------------------------------------------------------------------

const PERCENT = /(?<![\p{L}\p{N}.,])(-\s?)?(\d{1,3}(?:[.,]\d{1,3})?)\s?%/gu;

/** «21 %», «21,00%», «-15%» → puntos básicos (el signo se ignora). Solo de 0 a 100 %. */
export function findPercents(line: string): PercentToken[] {
  const found: PercentToken[] = [];
  for (const m of line.matchAll(PERCENT)) {
    const bps = percentToBps(m[2]!);
    if (bps !== null) found.push({ start: m.index, end: m.index + m[0].length, bps });
  }
  return found;
}

/** «21», «21,00», «10.5» → 2100, 2100, 1050. null fuera de 0-100. */
export function percentToBps(text: string): number | null {
  const m = /^(\d{1,3})(?:[.,](\d{1,3}))?$/.exec(text.trim());
  if (!m) return null;
  const fraction = (m[2] ?? "").padEnd(3, "0");
  // Milésimas de punto porcentual → puntos básicos, redondeado.
  const thousandths = Number(m[1]) * 1000 + Number(fraction);
  const bps = Math.round(thousandths / 10);
  return bps <= 10_000 ? bps : null;
}

// ---------------------------------------------------------------------------
// Importes
// ---------------------------------------------------------------------------

const CURRENCY_BEFORE = /(?:€|eur)\s?-?\s?$/i;
const CURRENCY_AFTER = /^\s?(?:€|eur(?:os?)?(?![a-z]))/i;

/**
 * Céntimos de un número escrito a la española («1.234,56») o a la inglesa («1,234.56»). Sin
 * decimales («1.234», «150») solo vale si lleva moneda: lo dice quien llama.
 */
export function amountToCents(raw: string, allowInteger: boolean): number | null {
  const lastComma = raw.lastIndexOf(",");
  const lastDot = raw.lastIndexOf(".");
  let integer = raw;
  let fraction = "";
  let thousands: "." | "," | null = null;
  if (lastComma !== -1 && lastDot !== -1) {
    const decimal = lastComma > lastDot ? "," : ".";
    thousands = decimal === "," ? "." : ",";
    integer = raw.slice(0, raw.lastIndexOf(decimal));
    fraction = raw.slice(raw.lastIndexOf(decimal) + 1);
  } else if (lastComma !== -1 || lastDot !== -1) {
    const sep = lastComma !== -1 ? "," : ".";
    const tail = raw.length - raw.lastIndexOf(sep) - 1;
    const count = raw.split(sep).length - 1;
    if (count === 1 && tail <= 2) {
      integer = raw.slice(0, raw.lastIndexOf(sep));
      fraction = raw.slice(raw.lastIndexOf(sep) + 1);
    } else if (tail === 3) {
      thousands = sep;
    } else {
      return null;
    }
  }
  if (fraction !== "" && !/^\d{1,2}$/.test(fraction)) return null;
  if (thousands) {
    if (!new RegExp(`^\\d{1,3}(?:\\${thousands}\\d{3})+$`).test(integer) && !/^\d+$/.test(integer)) return null;
    integer = integer.split(thousands).join("");
  }
  if (!/^\d+$/.test(integer)) return null;
  if (fraction === "" && !allowInteger) return null;
  const cents = Number(integer) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

const overlapsAny = (start: number, end: number, masks: readonly Span[]) => masks.some((m) => m.start < end && start < m.end);

/**
 * Importes de la línea: con dos decimales o con el símbolo de la moneda. Se saltan los números que
 * son parte de otra cosa (una fecha, un NIF, un IBAN, un código «F2025-12»), los porcentajes y las
 * cantidades sin decimales.
 */
export function findMoney(line: string, masks: readonly Span[] = []): MoneyToken[] {
  const found: MoneyToken[] = [];
  for (const m of line.matchAll(/\d[\d.,]*/g)) {
    const raw = m[0].replace(/[.,]+$/, "");
    const start = m.index;
    const end = start + raw.length;
    if (overlapsAny(start, end, masks)) continue;
    const before = line.slice(Math.max(0, start - 10), start);
    const after = line.slice(end, end + 10);
    const prev = before.at(-1) ?? "";
    // Parte de una palabra o un código («F2025», «B-12…», «nº12/», «F2025-12,50»): no es un importe.
    if (/[\p{L}\p{N}/_]/u.test(prev) && !/(?:€|eur)$/i.test(before)) continue;
    if (prev === "-" && /[\p{L}\p{N}]/u.test(before.at(-2) ?? "")) continue;
    if (/^[-/]\d/.test(after) || /^\s?%/.test(after) || /^[\p{L}]/u.test(after) && !CURRENCY_AFTER.test(after)) continue;
    const currency = CURRENCY_BEFORE.test(before) || CURRENCY_AFTER.test(after);
    // Sin moneda, un importe lleva sus dos decimales («3,5» es una cantidad, no 3,50 €).
    if (!currency && !/[.,]\d{2}$/.test(raw)) continue;
    const cents = amountToCents(raw, currency);
    if (cents === null) continue;
    const beforeSign = before.replace(/(?:€|eur)\s?$/i, "");
    const negative = /-\s?$/.test(beforeSign) || (/\(\s?$/.test(beforeSign) && /^\s?(?:€\s?)?\)/.test(after));
    found.push({ start, end, cents: negative && cents !== 0 ? -cents : cents, currency });
  }
  return found;
}

// Números sueltos (cantidades de una línea de la tabla): «1», «3,5», «2,000».
const PLAIN_NUMBER = /(?<![\p{L}\p{N}.,/])\d{1,7}(?:[.,]\d{1,3})?(?![\p{L}\p{N}%/]|[.,]\d)/gu;

export function findNumbers(line: string, masks: readonly Span[] = []): NumberToken[] {
  const found: NumberToken[] = [];
  for (const m of line.matchAll(PLAIN_NUMBER)) {
    const end = m.index + m[0].length;
    if (!overlapsAny(m.index, end, masks)) found.push({ start: m.index, end, value: m[0] });
  }
  return found;
}

/** «3,5» → "3.5"; «1.000» (miles) → "1000"; null si no es una cantidad válida (> 0, hasta 3 decimales). */
export function quantityOf(text: string): string | null {
  const t = text.trim();
  let value: string;
  if (/^\d{1,3}(?:\.\d{3})+$/.test(t)) value = t.replace(/\./g, "");
  else if (/^\d+(?:[.,]\d{1,3})?$/.test(t)) value = t.replace(",", ".");
  else return null;
  value = value.replace(/^0+(?=\d)/, "");
  if (value.includes(".")) value = value.replace(/0+$/, "").replace(/\.$/, "");
  if (/^0(?:\.0*)?$/.test(value) || value.split(".")[0]!.length > 9) return null;
  return value;
}

// ---------------------------------------------------------------------------
// NIF e IBAN
// ---------------------------------------------------------------------------

// DNI (8 cifras + letra), NIE (X/Y/Z + 7 cifras + letra) y CIF (letra + 7 cifras + control), con
// separadores opcionales y el prefijo «ES» del IVA intracomunitario.
const ES_TAX_ID =
  /(?<![A-Z0-9])(?:ES[\s.-]?)?(?:[A-HJ-NP-SUVW][\s.-]?(?:\d[\s.]?){6}\d[\s.-]?[0-9A-J]|(?:\d[\s.]?){7}\d[\s.-]?[A-Z]|[XYZ][\s.-]?(?:\d[\s.]?){6}\d[\s.-]?[A-Z])(?![A-Z0-9])/g;
const EU_VAT =
  /(?:VAT|NIF|CIF|TVA|UST|BTW|NIPC|IVA|TAX)[\s.:#-]*(?:IDNR|ID|NO|NUMBER|NUM|NR|N[º°O])?[\s.:#-]*((?:AT|BE|BG|CY|CZ|DE|DK|EE|EL|FI|FR|HR|HU|IE|IT|LT|LU|LV|MT|NL|PL|PT|RO|SE|SI|SK|XI)[\s.-]?[0-9A-Z]{2}(?:[\s.]?[0-9A-Z]){4,10})(?![A-Z0-9])/g;
const IBAN = /(?<![A-Z0-9])[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,3})?(?![A-Z0-9])/g;

/** NIF españoles válidos (con su carácter de control) y números de IVA de otros países de la UE. */
export function findTaxIds(line: string): TaxIdToken[] {
  const upper = line.toUpperCase();
  const found: TaxIdToken[] = [];
  for (const m of upper.matchAll(ES_TAX_ID)) {
    const normalized = normalizeTaxId(m[0]).replace(/[^A-Z0-9]/g, "");
    const candidates = normalized.startsWith("ES") ? [normalized.slice(2), normalized] : [normalized];
    const valid = candidates.map((c) => validateSpanishTaxId(c)).find((r) => r.valid);
    if (valid) found.push({ start: m.index, end: m.index + m[0].length, value: valid.normalized, kind: "es" });
  }
  for (const m of upper.matchAll(EU_VAT)) {
    const value = m[1]!.replace(/[^A-Z0-9]/g, "");
    const at = m.index + m[0].length - m[1]!.length;
    const digits = value.match(/\d/g)?.length ?? 0;
    if (/^[A-Z]{2}[A-Z0-9]{6,14}$/.test(value) && digits >= 6 && !found.some((f) => f.start < at + m[1]!.length && at < f.end)) {
      found.push({ start: at, end: at + m[1]!.length, value, kind: "eu_vat" });
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

export function findIbans(line: string): Span[] {
  return [...line.toUpperCase().matchAll(IBAN)].map((m) => ({ start: m.index, end: m.index + m[0].length }));
}
