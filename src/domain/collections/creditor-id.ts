// Identificador de acreedor SEPA (en España, «ICS»: identificador del acreedor en el esquema
// SEPA). Estructura (EPC262-08, «Creditor Identifier Overview»):
//
//   ES 11 000 B12345674
//   │  │  │   └─ identificador nacional: en España, el NIF del acreedor (9 caracteres)
//   │  │  └───── código comercial del acreedor («sufijo»): 3 caracteres que elige él, "000" por defecto
//   │  └──────── 2 dígitos de control
//   └─────────── país (ISO 3166)
//
// Los dígitos de control son ISO 7064 MOD 97-10 sobre el identificador nacional seguido del país
// y "00", con las letras convertidas a números (A = 10 … Z = 35): 98 − (n mod 97), con dos cifras.
// El código comercial NO entra en el cálculo, así que cambiar el sufijo no cambia los dígitos.
//
// Lo emite el banco al contratar el servicio de adeudos directos SEPA (cuaderno 19.14): la app
// propone el que sale del NIF, pero es el banco quien lo confirma.

import { normalizeTaxId, validateSpanishTaxId } from "@/domain/tax-id";

export type CreditorIdParts = {
  countryCode: string;
  checkDigits: string;
  businessCode: string;
  nationalId: string;
};

const STRUCTURE = /^([A-Z]{2})(\d{2})([A-Z0-9]{3})([A-Z0-9]{1,28})$/;
const BUSINESS_CODE = /^[A-Z0-9]{3}$/;
// En España el identificador nacional es el NIF: 16 caracteres en total.
const SPAIN_LENGTH = 16;

/** Mayúsculas y sin espacios, puntos ni guiones: "es11 000-b12345674" → "ES11000B12345674". */
export function normalizeCreditorId(input: string): string {
  return input.replace(/[\s.\-‐-―−]/g, "").toUpperCase();
}

/** Código comercial ("sufijo") normalizado: "0a1" → "0A1". No valida. */
export function normalizeBusinessCode(input: string): string {
  return input.replace(/\s/g, "").toUpperCase();
}

export function isValidBusinessCode(input: string): boolean {
  return BUSINESS_CODE.test(normalizeBusinessCode(input));
}

/** Resto de dividir entre 97 el número que resulta de cambiar cada letra por 10-35 (por trozos). */
function mod97(value: string): number {
  let remainder = 0;
  for (const char of value) {
    const digit = parseInt(char, 36);
    if (Number.isNaN(digit)) throw new Error(`Carácter no válido en el identificador: ${char}`);
    remainder = (remainder * (digit > 9 ? 100 : 10) + digit) % 97;
  }
  return remainder;
}

/** Dígitos de control (MOD 97-10) de un identificador nacional en un país: ("ES", "B12345674") → "11". */
export function creditorIdCheckDigits(countryCode: string, nationalId: string): string {
  const country = countryCode.toUpperCase();
  const national = normalizeCreditorId(nationalId);
  if (!/^[A-Z]{2}$/.test(country)) throw new Error(`País no válido: ${countryCode}`);
  if (!/^[A-Z0-9]{1,28}$/.test(national)) throw new Error(`Identificador nacional no válido: ${nationalId}`);
  return String(98 - mod97(`${national}${country}00`)).padStart(2, "0");
}

/** Partes de un identificador con la estructura correcta (no comprueba los dígitos de control), o null. */
export function parseCreditorId(input: string): CreditorIdParts | null {
  const m = STRUCTURE.exec(normalizeCreditorId(input));
  if (!m) return null;
  return { countryCode: m[1]!, checkDigits: m[2]!, businessCode: m[3]!, nationalId: m[4]! };
}

/**
 * Identificador de acreedor válido: estructura, longitud española (16) si el país es ES y dígitos
 * de control correctos (el MOD 97 del identificador nacional + país + dígitos da 1).
 */
export function validateCreditorId(input: string): boolean {
  const parts = parseCreditorId(input);
  if (!parts) return false;
  if (parts.countryCode === "ES" && normalizeCreditorId(input).length !== SPAIN_LENGTH) return false;
  return mod97(`${parts.nationalId}${parts.countryCode}${parts.checkDigits}`) === 1;
}

/**
 * ICS que corresponde a un NIF español con el algoritmo estándar: "ES" + dígitos de control +
 * código comercial (por defecto "000") + NIF. Es una propuesta: el banco lo confirma al contratar
 * los adeudos directos. null si el NIF no es válido o el código comercial no tiene 3 caracteres.
 */
export function proposeSpanishCreditorId(nif: string, businessCode = "000"): string | null {
  const national = normalizeTaxId(nif);
  const code = normalizeBusinessCode(businessCode);
  if (!validateSpanishTaxId(national).valid || !BUSINESS_CODE.test(code)) return null;
  return `ES${creditorIdCheckDigits("ES", national)}${code}${national}`;
}

/** Forma de lectura: "ES11 000 B12345674". No valida. */
export function formatCreditorId(input: string): string {
  const parts = parseCreditorId(input);
  if (!parts) return normalizeCreditorId(input);
  return `${parts.countryCode}${parts.checkDigits} ${parts.businessCode} ${parts.nationalId}`;
}

// ---------------------------------------------------------------------------
// BIC (ISO 9362): opcional en SEPA desde 2016 («IBAN only»)
// ---------------------------------------------------------------------------

const BIC_PATTERN = /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/;

/** "caix es bb xxx" → "CAIXESBBXXX". No valida. */
export function normalizeBic(input: string): string {
  return input.replace(/\s/g, "").toUpperCase();
}

/** 8 u 11 caracteres: banco (4 letras), país (2 letras), localidad (2) y, opcional, oficina (3). */
export function validateBic(input: string): boolean {
  return BIC_PATTERN.test(normalizeBic(input));
}
