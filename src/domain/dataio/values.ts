// Valores de una celda importada: importes, porcentajes, fechas, sí/no, emails, países y NIF, tal y
// como llegan de Excel en español (y de otras herramientas). Cada función devuelve null si el valor
// no se entiende: quien la llama decide si eso es un error o un aviso.

import { addDays, formatCivil, parseCivilDate, type CivilDate } from "../dates/civil-date";
import { divRoundHalfAwayFromZero } from "../money";
import { validateSpanishTaxId } from "../tax-id";
import { cleanText, normalizeKey } from "./text";

export type DecimalSeparator = "," | ".";
export type DateOrder = "dmy" | "mdy";

// Espacios que Excel e Intl usan como separador de miles.
const SPACES = /[\s    ]+/g;
const CURRENCY = /€|eur(?:os?)?|\$|usd/gi;

type Decimal = { negative: boolean; integer: string; fraction: string };

/**
 * Un número escrito a la española ("1.234,56"), a la inglesa ("1,234.56") o sin miles, con signo
 * delante o detrás, entre paréntesis (contabilidad) y con símbolo de moneda. Si aparecen los dos
 * separadores, el último es el decimal. Si solo aparece uno, manda `decimal`, salvo que no pueda
 * serlo: "1.5" con decimal "," no son miles (grupo de 3), así que es un decimal con punto.
 */
export function parseDecimal(input: string, decimal: DecimalSeparator): Decimal | null {
  let text = input.replace(SPACES, "").replace(CURRENCY, "").replace(/−/g, "-");
  if (text === "") return null;
  let negative = false;
  const paren = /^\((.*)\)$/.exec(text);
  if (paren) {
    negative = true;
    text = paren[1]!;
  }
  if (/^[+-]/.test(text)) {
    negative = negative !== (text[0] === "-");
    text = text.slice(1);
  } else if (/-$/.test(text)) {
    negative = !negative;
    text = text.slice(0, -1);
  }
  if (!/^[\d.,]+$/.test(text) || !/\d/.test(text)) return null;

  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  let separator: DecimalSeparator | null;
  if (lastComma !== -1 && lastDot !== -1) {
    separator = lastComma > lastDot ? "," : ".";
  } else if (lastComma === -1 && lastDot === -1) {
    separator = null;
  } else {
    const only: DecimalSeparator = lastComma !== -1 ? "," : ".";
    const occurrences = text.split(only).length - 1;
    const tail = text.length - text.lastIndexOf(only) - 1;
    if (only === decimal) {
      // "1,234,567" no puede ser decimal: es de miles aunque el decimal sea ",".
      separator = occurrences > 1 ? null : only;
    } else {
      // Separador contrario al esperado: son miles si forman grupos de 3; si no, es un decimal.
      separator = tail === 3 ? null : occurrences === 1 ? only : null;
    }
  }

  let integer = text;
  let fraction = "";
  if (separator) {
    const at = text.lastIndexOf(separator);
    integer = text.slice(0, at);
    fraction = text.slice(at + 1);
    if (!/^\d*$/.test(fraction) || fraction === "") return null;
  }
  const thousands = separator === "," ? "." : separator === "." ? "," : null;
  if (thousands && integer.includes(thousands)) {
    if (!/^\d{1,3}(?:[.,]\d{3})+$/.test(integer) || integer.includes(separator!)) return null;
    integer = integer.split(thousands).join("");
  } else if (!separator && /[.,]/.test(integer)) {
    // Sin decimal: solo miles, en grupos de 3 y con un único tipo de separador.
    if (!/^\d{1,3}(?:\.\d{3})+$/.test(integer) && !/^\d{1,3}(?:,\d{3})+$/.test(integer)) return null;
    integer = integer.replace(/[.,]/g, "");
  }
  if (!/^\d*$/.test(integer)) return null;
  if (integer === "") integer = "0";
  return { negative, integer: integer.replace(/^0+(?=\d)/, ""), fraction };
}

/**
 * Separador decimal de una columna a partir de sus valores: vota cada valor que no sea ambiguo
 * ("12,50" → ","; "12.5" → "."; "1.234" o "1,234" no votan). Sin votos, el de reserva.
 */
export function inferDecimalSeparator(samples: readonly string[], fallback: DecimalSeparator): DecimalSeparator {
  let comma = 0;
  let dot = 0;
  for (const raw of samples) {
    const text = raw.replace(SPACES, "").replace(CURRENCY, "");
    const lastComma = text.lastIndexOf(",");
    const lastDot = text.lastIndexOf(".");
    if (lastComma !== -1 && lastDot !== -1) {
      if (lastComma > lastDot) comma += 1;
      else dot += 1;
      continue;
    }
    const only = lastComma !== -1 ? "," : lastDot !== -1 ? "." : null;
    if (!only) continue;
    const tail = text.length - text.lastIndexOf(only) - 1;
    if (tail === 3 && /^\(?[+-]?\d{1,3}$/.test(text.slice(0, text.lastIndexOf(only)))) continue;
    if (text.split(only).length - 1 > 1) {
      // "1.234.567" → el punto son miles, luego el decimal es la coma.
      if (only === ".") comma += 1;
      else dot += 1;
      continue;
    }
    if (only === ",") comma += 1;
    else dot += 1;
  }
  if (comma === dot) return fallback;
  return comma > dot ? "," : ".";
}

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/** Importe a céntimos; con más de 2 decimales se redondea (medio céntimo, lejos del cero). */
export function parseAmountCents(input: string, decimal: DecimalSeparator): number | null {
  const value = parseDecimal(input, decimal);
  if (!value) return null;
  const scale = BigInt(10) ** BigInt(value.fraction.length);
  const units = BigInt(value.integer + value.fraction);
  const cents = divRoundHalfAwayFromZero(units * BigInt(100), scale);
  if (cents > MAX_SAFE) return null;
  const result = Number(cents);
  return value.negative && result !== 0 ? -result : result;
}

/** Cantidad con hasta 3 decimales, como "1.5" (el formato de `numeric(12,3)`); null si tiene más. */
export function parseQuantity(input: string, decimal: DecimalSeparator): { value: string; negative: boolean } | null {
  const parsed = parseDecimal(input, decimal);
  if (!parsed) return null;
  const fraction = parsed.fraction.replace(/0+$/, "");
  if (fraction.length > 3 || parsed.integer.length > 9) return null;
  const value = fraction ? `${parsed.integer}.${fraction}` : parsed.integer;
  if (/^0(\.0*)?$/.test(value)) return null;
  return { value, negative: parsed.negative };
}

/**
 * Porcentaje a puntos básicos: "21", "21 %", "21,00" y "0,21" (fracción, como la exporta Excel
 * cuando la celda tiene formato de porcentaje) son 2100. Fuera de 0-100 %, null.
 */
export function parseRateBps(input: string, decimal: DecimalSeparator): number | null {
  const hasPercent = input.includes("%");
  const parsed = parseDecimal(input.replace(/%/g, ""), decimal);
  if (!parsed || parsed.negative) return null;
  const digits = parsed.integer + parsed.fraction;
  const scale = parsed.fraction.length;
  const asNumber = Number(`${parsed.integer}.${parsed.fraction || "0"}`);
  // En tanto por uno (0,21) si es menor que 1 con decimales y no lleva "%".
  const isFraction = !hasPercent && asNumber > 0 && asNumber < 1 && parsed.fraction.length > 0;
  // bps = valor × 100 (o × 10 000 en tanto por uno), redondeado.
  const factor = isFraction ? BigInt(10_000) : BigInt(100);
  const bps = Number(divRoundHalfAwayFromZero(BigInt(digits) * factor, BigInt(10) ** BigInt(scale)));
  if (!Number.isSafeInteger(bps) || bps < 0 || bps > 10_000) return null;
  return bps;
}

// ---------------------------------------------------------------------------
// Fechas
// ---------------------------------------------------------------------------

const EXCEL_EPOCH: CivilDate = "1899-12-30";

/** Número de serie de Excel (días desde el 30/12/1899) a fecha civil, para 1954-2119. */
export function excelSerialToCivil(serial: number): CivilDate | null {
  if (!Number.isFinite(serial) || serial < 20_000 || serial > 80_000) return null;
  return addDays(EXCEL_EPOCH, Math.floor(serial));
}

function fullYear(year: string): number {
  if (year.length === 4) return Number(year);
  const two = Number(year);
  return two >= 70 ? 1900 + two : 2000 + two;
}

function civilOrNull(year: number, month: number, day: number): CivilDate | null {
  try {
    const value = formatCivil({ year, month, day });
    parseCivilDate(value);
    return value;
  } catch {
    return null;
  }
}

const YMD = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/;
const DMY = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?:\s.*)?$/;

/**
 * Fecha en los formatos habituales: dd/mm/aaaa (también con "-" o ".", y año de 2 cifras),
 * aaaa-mm-dd (con hora o sin ella) y número de serie de Excel. `order` decide entre dd/mm y
 * mm/dd cuando la fila no lo deja claro (ver `inferDateOrder`).
 */
export function parseDateLoose(input: string, order: DateOrder = "dmy"): CivilDate | null {
  const text = input.trim();
  if (text === "") return null;
  const ymd = YMD.exec(text);
  if (ymd) return civilOrNull(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]));
  const dmy = DMY.exec(text);
  if (dmy) {
    const [a, b] = [Number(dmy[1]), Number(dmy[2])];
    const year = fullYear(dmy[3]!);
    return order === "dmy" ? civilOrNull(year, b, a) : civilOrNull(year, a, b);
  }
  if (/^\d{5}(?:[.,]\d+)?$/.test(text)) return excelSerialToCivil(Number(text.replace(",", ".")));
  return null;
}

/**
 * Orden día/mes de una columna: si algún valor tiene el primer número por encima de 12, es dd/mm;
 * si lo tiene el segundo, mm/dd. Por defecto, dd/mm (España).
 */
export function inferDateOrder(samples: readonly string[]): DateOrder {
  let dayFirst = 0;
  let monthFirst = 0;
  for (const sample of samples) {
    const m = DMY.exec(sample.trim());
    if (!m) continue;
    if (Number(m[1]) > 12) dayFirst += 1;
    else if (Number(m[2]) > 12) monthFirst += 1;
  }
  return monthFirst > dayFirst ? "mdy" : "dmy";
}

// ---------------------------------------------------------------------------
// Sí / no, emails, idioma, forma de pago
// ---------------------------------------------------------------------------

const TRUE_WORDS = new Set([
  "si", "s", "yes", "y", "true", "verdadero", "cierto", "1", "x", "ok", "cobrada", "cobrado", "cobrat", "pagada",
  "pagado", "pagat", "paid", "liquidada",
]);
const FALSE_WORDS = new Set([
  "no", "n", "false", "falso", "0", "pendiente", "pendent", "pending", "impagada", "vencida", "unpaid", "overdue",
  "sent", "enviada", "emitida", "draft", "borrador",
]);

/** "Sí", "x", "cobrada"… → true; "no", "pendiente"… → false; lo demás, null. */
export function parseBooleanLoose(input: string): boolean | null {
  const key = normalizeKey(input);
  if (key === "") return null;
  if (TRUE_WORDS.has(key)) return true;
  if (FALSE_WORDS.has(key)) return false;
  return null;
}

// La misma comprobación que la columna `contacts.email` de la base de datos.
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export type ParsedEmails = { email: string | null; extra: string[]; invalid: string[] };

/** Uno o varios emails en una celda ("a@x.com; b@y.com", "Ana <ana@x.com>"): el primero válido y el resto. */
export function parseEmails(input: string): ParsedEmails {
  const parts = input
    .replace(/mailto:/gi, "")
    .split(/[;,\s/]+/)
    .map((p) => p.replace(/^[<("']+|[>)"']+$/g, "").trim().toLowerCase())
    .filter((p) => p !== "" && p.includes("@"));
  const valid = parts.filter((p) => EMAIL.test(p));
  const invalid = parts.filter((p) => !EMAIL.test(p));
  if (valid.length === 0 && invalid.length === 0 && input.trim() !== "") invalid.push(input.trim());
  return { email: valid[0] ?? null, extra: valid.slice(1), invalid };
}

export type AppLocale = "es" | "ca" | "en";

const LANGUAGES: Record<string, AppLocale> = {
  es: "es", esp: "es", espanol: "es", castellano: "es", spanish: "es", castella: "es",
  ca: "ca", cat: "ca", catalan: "ca", catala: "ca", valencia: "ca",
  en: "en", eng: "en", ingles: "en", angles: "en", english: "en",
};

export function parseLanguage(input: string): AppLocale | null {
  return LANGUAGES[normalizeKey(input)] ?? null;
}

export type PaymentMethod = "transfer" | "sepa_debit" | "card" | "cash" | "other";

const PAYMENT_METHODS: [RegExp, PaymentMethod][] = [
  [/\b(transferencia|transferencia bancaria|transfer|bank transfer|wire)\b/, "transfer"],
  [/\b(domiciliacion|domiciliacio|sepa|recibo|rebut|direct debit|adeudo)\b/, "sepa_debit"],
  [/\b(tarjeta|targeta|card|stripe|tpv|visa|mastercard|paypal)\b/, "card"],
  [/\b(efectivo|efectiu|cash|metalico)\b/, "cash"],
  [/\b(bizum|cheque|pagare|other|otro|otros|altre)\b/, "other"],
];

/** "Transferencia", "Bizum", "Stripe", "Efectivo" (los de la app de facturas) y equivalentes. */
export function parsePaymentMethod(input: string): PaymentMethod | null {
  const key = normalizeKey(input);
  if (key === "") return null;
  for (const [pattern, method] of PAYMENT_METHODS) if (pattern.test(key)) return method;
  return null;
}

// ---------------------------------------------------------------------------
// Países y NIF
// ---------------------------------------------------------------------------

/** Estados de la UE por código ISO. El IVA intracomunitario de Grecia usa el prefijo "EL". */
export const EU_COUNTRIES: ReadonlySet<string> = new Set([
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR", "HR", "HU", "IE", "IT", "LT", "LU", "LV",
  "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK",
]);
const VAT_PREFIXES: ReadonlySet<string> = new Set([...EU_COUNTRIES, "EL", "XI"]);

const COUNTRY_NAMES: Record<string, string> = {
  espana: "ES", espanya: "ES", spain: "ES", "reino de espana": "ES",
  portugal: "PT", francia: "FR", franca: "FR", france: "FR", alemania: "DE", alemanya: "DE", germany: "DE",
  deutschland: "DE", italia: "IT", italy: "IT", "reino unido": "GB", "regne unit": "GB", "united kingdom": "GB",
  uk: "GB", inglaterra: "GB", "gran bretana": "GB", irlanda: "IE", ireland: "IE", "paises bajos": "NL",
  holanda: "NL", "paisos baixos": "NL", netherlands: "NL", belgica: "BE", belgium: "BE", andorra: "AD",
  suiza: "CH", suissa: "CH", switzerland: "CH", "estados units": "US", "estados unidos": "US", eeuu: "US",
  "ee uu": "US", usa: "US", "united states": "US", mexico: "MX", argentina: "AR", colombia: "CO", chile: "CL",
  peru: "PE", luxemburgo: "LU", luxembourg: "LU", austria: "AT", suecia: "SE", sweden: "SE", dinamarca: "DK",
  denmark: "DK", finlandia: "FI", finland: "FI", noruega: "NO", norway: "NO", polonia: "PL", poland: "PL",
  chequia: "CZ", "republica checa": "CZ", grecia: "GR", greece: "GR", rumania: "RO", romania: "RO",
  bulgaria: "BG", croacia: "HR", eslovenia: "SI", eslovaquia: "SK", hungria: "HU", estonia: "EE", letonia: "LV",
  lituania: "LT", malta: "MT", chipre: "CY", marruecos: "MA", canada: "CA", brasil: "BR", brazil: "BR",
  uruguay: "UY", venezuela: "VE", ecuador: "EC", "republica dominicana": "DO", china: "CN", japon: "JP",
  japan: "JP", "emiratos arabes unidos": "AE", emiratos: "AE", israel: "IL", australia: "AU",
};

/** País a código ISO de 2 letras ("España", "Spain", "ES", "UK" → "GB"). */
export function parseCountry(input: string): string | null {
  const key = normalizeKey(input);
  if (key === "") return null;
  if (COUNTRY_NAMES[key]) return COUNTRY_NAMES[key]!;
  if (/^[a-z]{2}$/.test(key)) {
    const code = key.toUpperCase();
    return code === "UK" ? "GB" : code === "EL" ? "GR" : code;
  }
  return null;
}

export type TaxIdKind = "es" | "eu_vat" | "foreign";

export type ClassifiedTaxId =
  | { ok: true; kind: TaxIdKind; value: string }
  | { ok: false; reason: "control" | "format" };

const STORED = /^[A-Z0-9]{2,20}$/;

/**
 * NIF de un cliente con su tipo, como lo guarda `clients` (solo letras y números):
 * - DNI, NIE o CIF español válido (también con el prefijo "ES" del IVA intracomunitario) → "es".
 * - Con prefijo de un país de la UE y 2-12 caracteres → "eu_vat".
 * - Si el cliente no es de España, cualquier identificador de 2-20 caracteres → "foreign".
 * Un NIF con forma española y el carácter de control mal es un error ("control").
 */
export function classifyTaxId(input: string, countryCode: string | null): ClassifiedTaxId {
  const value = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (value === "") return { ok: false, reason: "format" };
  const spanish = validateSpanishTaxId(value);
  if (spanish.valid) return { ok: true, kind: "es", value: spanish.normalized };
  if (value.startsWith("ES")) {
    const inner = validateSpanishTaxId(value.slice(2));
    if (inner.valid) return { ok: true, kind: "es", value: inner.normalized };
  }
  const domestic = countryCode === null || countryCode === "ES";
  if (spanish.kind !== null && domestic) return { ok: false, reason: "control" };
  const prefix = value.slice(0, 2);
  if (VAT_PREFIXES.has(prefix) && prefix !== "ES" && /^[A-Z]{2}[A-Z0-9]{2,12}$/.test(value)) {
    return { ok: true, kind: "eu_vat", value };
  }
  if (!domestic && STORED.test(value)) return { ok: true, kind: "foreign", value };
  return { ok: false, reason: "format" };
}

/**
 * Código postal. En España son 5 cifras y Excel se come el cero inicial ("8301" era "08301"):
 * se repone y se avisa. Fuera de España se guarda tal cual.
 */
export function parsePostalCode(input: string, countryCode: string): { value: string | null; padded: boolean; valid: boolean } {
  const text = cleanText(input, 12);
  if (!text) return { value: null, padded: false, valid: true };
  if (countryCode !== "ES") return { value: text, padded: false, valid: true };
  const digits = text.replace(/\s/g, "");
  if (/^\d{5}$/.test(digits)) return { value: digits, padded: false, valid: true };
  if (/^\d{4}$/.test(digits)) return { value: `0${digits}`, padded: true, valid: true };
  return { value: text, padded: false, valid: false };
}

/** Un teléfono que Excel ha convertido en número en notación científica ("6,12E+08") ya no se puede recuperar. */
export function isScientificNumber(input: string): boolean {
  return /^\d+(?:[.,]\d+)?e\+?\d+$/i.test(input.trim());
}
