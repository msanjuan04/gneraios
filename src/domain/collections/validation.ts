// Qué impide generar (o previsualizar) una remesa: los datos del acreedor, la fecha de cobro y,
// recibo a recibo, el mandato, la cuenta y el importe. La generación exige todo; la vista previa
// se conforma con un identificador de acreedor utilizable, aunque aún no esté confirmado con el
// banco (así se puede preparar todo antes de contratar los adeudos directos).

import { type CivilDate, compareCivil } from "@/domain/dates/civil-date";
import { validateIban } from "@/domain/tax-id";
import { isTargetBusinessDay } from "./business-day";
import { normalizeCreditorId, proposeSpanishCreditorId, validateBic, validateCreditorId } from "./creditor-id";
import { isSepaIban, isValidMandateReference } from "./mandate";
import { SEPA_LIMITS } from "./pain008";
import { toSepaText } from "./sepa-text";

/** Datos de acreedor de un emisor, ya resueltos (lo guardado por el owner o, si falta, lo del emisor). */
export type CreditorConfig = {
  /** ICS guardado por el owner; null si aún no hay ninguno. */
  creditorId: string | null;
  /** El owner ha confirmado ese ICS con el banco. */
  creditorIdConfirmed: boolean;
  /** NIF del emisor: sin ICS guardado, se propone el que sale de él. */
  issuerTaxId: string | null;
  name: string | null;
  iban: string | null;
  bic: string | null;
};

export type CreditorIdSource = "confirmed" | "unconfirmed" | "proposed";

export type CreditorIssue =
  | "creditorIdUnconfirmed"
  | "creditorIdMissing"
  | "creditorIdInvalid"
  | "creditorNameMissing"
  | "creditorIbanMissing"
  | "creditorIbanInvalid"
  | "creditorBicInvalid";

export type RemittanceIssue = "collectionDatePast" | "noItems";
export type RemittanceWarning = "collectionDateNotBusinessDay";

export type ItemIssue =
  | "mandateMissing"
  | "mandateNotYetSigned"
  | "mandateReferenceInvalid"
  | "debtorNameMissing"
  | "debtorIbanInvalid"
  | "debtorIbanNotSepa"
  | "debtorBicInvalid"
  | "amountNotPositive"
  | "amountTooLarge"
  | "invoiceNumberMissing";

export type MandateForCheck = {
  reference: string;
  debtorName: string;
  iban: string;
  bic: string | null;
  signedOn: CivilDate;
};

export type ItemCheckInput = {
  id: string;
  invoiceNumber: string | null;
  /** Lo que se cobraría: el pendiente de la factura (con IVA). */
  amountCents: number;
  /** El mandato activo del cliente con este acreedor, o null. */
  mandate: MandateForCheck | null;
};

export type CreditorCheck = {
  /** El ICS con el que se generaría el fichero (guardado o propuesto), o null si no hay ninguno utilizable. */
  creditorId: string | null;
  source: CreditorIdSource | null;
  issues: CreditorIssue[];
};

export type RemittanceCheck = {
  creditor: CreditorCheck;
  issues: RemittanceIssue[];
  warnings: RemittanceWarning[];
  /** Problemas de cada recibo, por id (solo los que tienen alguno). */
  items: Record<string, ItemIssue[]>;
  /** Hay con qué montar una vista previa del fichero. */
  canPreview: boolean;
  /** Se puede generar el fichero definitivo. */
  canGenerate: boolean;
};

// Lo único que no impide la vista previa: el ICS sin confirmar y una fecha de cobro ya pasada.
const PREVIEW_TOLERATED: ReadonlySet<CreditorIssue | RemittanceIssue> = new Set(["creditorIdUnconfirmed", "collectionDatePast"]);

/** El ICS utilizable y lo que falta en los datos de acreedor. */
export function checkCreditor(config: CreditorConfig): CreditorCheck {
  const issues: CreditorIssue[] = [];
  let creditorId: string | null = null;
  let source: CreditorIdSource | null = null;

  if (config.creditorId) {
    if (validateCreditorId(config.creditorId)) {
      creditorId = normalizeCreditorId(config.creditorId);
      source = config.creditorIdConfirmed ? "confirmed" : "unconfirmed";
      if (!config.creditorIdConfirmed) issues.push("creditorIdUnconfirmed");
    } else {
      issues.push("creditorIdInvalid");
    }
  } else {
    const proposed = config.issuerTaxId ? proposeSpanishCreditorId(config.issuerTaxId) : null;
    if (proposed) {
      creditorId = proposed;
      source = "proposed";
      issues.push("creditorIdUnconfirmed");
    } else {
      issues.push("creditorIdMissing");
    }
  }

  if (!config.name || !toSepaText(config.name, SEPA_LIMITS.name)) issues.push("creditorNameMissing");
  if (!config.iban) issues.push("creditorIbanMissing");
  else if (!isSepaIban(config.iban)) issues.push("creditorIbanInvalid");
  if (config.bic && !validateBic(config.bic)) issues.push("creditorBicInvalid");
  return { creditorId, source, issues };
}

/** Lo que falla en un recibo para cobrarlo en `collectionOn`. */
export function checkItem(item: ItemCheckInput, collectionOn: CivilDate): ItemIssue[] {
  const issues: ItemIssue[] = [];
  if (!item.invoiceNumber) issues.push("invoiceNumberMissing");
  if (!Number.isSafeInteger(item.amountCents) || item.amountCents <= 0) issues.push("amountNotPositive");
  else if (item.amountCents > SEPA_LIMITS.maxAmountCents) issues.push("amountTooLarge");

  const m = item.mandate;
  if (!m) {
    issues.push("mandateMissing");
    return issues;
  }
  if (compareCivil(m.signedOn, collectionOn) > 0) issues.push("mandateNotYetSigned");
  if (!isValidMandateReference(m.reference)) issues.push("mandateReferenceInvalid");
  if (!toSepaText(m.debtorName, SEPA_LIMITS.name)) issues.push("debtorNameMissing");
  if (!validateIban(m.iban)) issues.push("debtorIbanInvalid");
  else if (!isSepaIban(m.iban)) issues.push("debtorIbanNotSepa");
  if (m.bic && !validateBic(m.bic)) issues.push("debtorBicInvalid");
  return issues;
}

/**
 * Comprobación completa de una remesa. `today` es hoy en la zona de la org: la fecha de cobro
 * tiene que ser posterior (el banco necesita el fichero antes de ese día).
 */
export function checkRemittance(input: {
  today: CivilDate;
  collectionOn: CivilDate;
  creditor: CreditorConfig;
  items: readonly ItemCheckInput[];
}): RemittanceCheck {
  const creditor = checkCreditor(input.creditor);
  const issues: RemittanceIssue[] = [];
  const warnings: RemittanceWarning[] = [];
  if (compareCivil(input.collectionOn, input.today) <= 0) issues.push("collectionDatePast");
  if (!isTargetBusinessDay(input.collectionOn)) warnings.push("collectionDateNotBusinessDay");
  if (input.items.length === 0) issues.push("noItems");

  const items: Record<string, ItemIssue[]> = {};
  for (const item of input.items) {
    const found = checkItem(item, input.collectionOn);
    if (found.length > 0) items[item.id] = found;
  }
  const validItems = input.items.filter((i) => !items[i.id]).length;
  const blocking = [...creditor.issues, ...issues];

  return {
    creditor,
    issues,
    warnings,
    items,
    canPreview: creditor.creditorId !== null && validItems > 0 && blocking.every((i) => PREVIEW_TOLERATED.has(i)),
    canGenerate: blocking.length === 0 && Object.keys(items).length === 0,
  };
}
