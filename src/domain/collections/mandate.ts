// Mandatos de adeudo directo SEPA: la orden firmada con la que el cliente (deudor) autoriza al
// acreedor a cargarle en su cuenta. La referencia la elige el acreedor, tiene hasta 35 caracteres
// y es única para ese acreedor para siempre (también la de un mandato ya revocado).

import { type CivilDate, compareCivil, parseCivilDate } from "@/domain/dates/civil-date";
import { normalizeIban, validateIban } from "@/domain/tax-id";
import { normalizeBic, validateBic } from "./creditor-id";
import { SEPA_LIMITS } from "./pain008";
import { isSepaIdentifier, toIdentifierPart, toSepaText } from "./sepa-text";

/**
 * Países del esquema SEPA de adeudos (UE, EEE, Suiza, Reino Unido, microestados y los que se han
 * adherido después). Un IBAN de otro país no se puede domiciliar.
 */
export const SEPA_COUNTRIES: ReadonlySet<string> = new Set([
  // UE
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU",
  "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
  // EEE, Suiza, Reino Unido y dependencias con IBAN propio
  "IS", "LI", "NO", "CH", "GB", "GI", "GG", "JE", "IM",
  // Microestados
  "AD", "MC", "SM", "VA",
  // Adheridos en 2024-2025
  "AL", "MD", "ME", "MK",
]);

/** Referencia de mandato normalizada: sin espacios en los extremos. */
export function normalizeMandateReference(input: string): string {
  return input.trim();
}

/** Referencia válida: identificador SEPA de hasta 35 caracteres, sin espacios. */
export function isValidMandateReference(input: string): boolean {
  return isSepaIdentifier(normalizeMandateReference(input), SEPA_LIMITS.identifier);
}

/**
 * Referencia propuesta para un mandato nuevo: el nombre del cliente y la fecha de firma
 * ("Restaurant del Port", 2026-09-26 → "RESTAURANT-DEL-PORT-20260926"). Única en la práctica;
 * la base de datos rechaza una repetida para el mismo acreedor.
 */
export function suggestMandateReference(clientName: string, signedOn: CivilDate): string {
  parseCivilDate(signedOn);
  const name = toIdentifierPart(clientName, SEPA_LIMITS.identifier - 9) || "M";
  return `${name}-${signedOn.replace(/-/g, "")}`;
}

/** ¿Se puede domiciliar en esta cuenta? IBAN válido de un país SEPA. */
export function isSepaIban(input: string): boolean {
  const iban = normalizeIban(input);
  return validateIban(iban) && SEPA_COUNTRIES.has(iban.slice(0, 2));
}

export type MandateInput = {
  reference: string;
  debtorName: string;
  iban: string;
  bic: string | null;
  signedOn: CivilDate;
};

export type MandateIssue = "referenceInvalid" | "debtorNameMissing" | "ibanInvalid" | "ibanNotSepa" | "bicInvalid" | "signedInFuture";

/** Lo que falla en los datos de un mandato (vacío si está bien). `today` en la zona de la org. */
export function checkMandate(m: MandateInput, today: CivilDate): MandateIssue[] {
  const issues: MandateIssue[] = [];
  if (!isValidMandateReference(m.reference)) issues.push("referenceInvalid");
  if (!toSepaText(m.debtorName, SEPA_LIMITS.name)) issues.push("debtorNameMissing");
  if (!validateIban(m.iban)) issues.push("ibanInvalid");
  else if (!isSepaIban(m.iban)) issues.push("ibanNotSepa");
  if (m.bic !== null && m.bic.trim() !== "" && !validateBic(normalizeBic(m.bic))) issues.push("bicInvalid");
  if (compareCivil(m.signedOn, today) > 0) issues.push("signedInFuture");
  return issues;
}
