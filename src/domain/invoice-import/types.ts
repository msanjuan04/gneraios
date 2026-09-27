// Lo que se lee de una factura en PDF, venga del texto del PDF (parse.ts) o de Claude: la misma
// forma, con cada dato acompañado de lo seguro que es. Nada de esto se guarda tal cual: rellena el
// formulario que el socio revisa antes de importar.

import type { CivilDate } from "../dates/civil-date";
import type { PaymentMethod } from "../dataio/values";
import type { VatRegime } from "../tax";

/**
 * - high: impreso con su etiqueta y cuadra con el resto (p. ej. los totales).
 * - medium: impreso pero sin etiqueta clara, o deducido de otros datos que sí lo están.
 * - low: una suposición (la primera fecha del documento, el primer NIF…): hay que revisarlo.
 */
export type Confidence = "high" | "medium" | "low";

export const CONFIDENCES = ["high", "medium", "low"] as const satisfies readonly Confidence[];

export type Field<T> = { value: T; confidence: Confidence };

export type ExtractedParty = {
  /** Normalizado (solo letras y números) y validado: un NIF español con su carácter de control. */
  taxId: Field<string> | null;
  name: Field<string> | null;
  address: Field<string> | null;
  postalCode: Field<string> | null;
  city: Field<string> | null;
  province: Field<string> | null;
  /** ISO 3166-1 alfa-2. */
  countryCode: Field<string> | null;
};

export type ExtractedLine = {
  description: string;
  /** Con punto decimal y hasta 3 decimales, como `numeric(12,3)`: "1", "3.5". */
  quantity: string | null;
  unitPriceCents: number | null;
  discountBps: number | null;
  vatBps: number | null;
  /** Base de la línea (después del descuento). */
  amountCents: number;
  periodStart: CivilDate | null;
  periodEnd: CivilDate | null;
  confidence: Confidence;
};

export const EXTRACTION_WARNINGS = [
  // El PDF no tiene capa de texto (escaneado o una foto): no se ha podido leer nada.
  "no_text",
  // No parece una factura.
  "not_invoice",
  // Base + IVA − IRPF no da el total impreso.
  "totals_mismatch",
  // Las líneas no suman la base imponible.
  "lines_mismatch",
  // Es una factura rectificativa (abono): se importan desde Ajustes → Datos.
  "rectifying",
  // Lleva varios tipos de IVA.
  "multiple_vat_rates",
  // Los importes no están en euros.
  "foreign_currency",
] as const;

export type ExtractionWarning = (typeof EXTRACTION_WARNINGS)[number];

export type ExtractedInvoice = {
  number: Field<string> | null;
  /** La serie, si la factura la imprime aparte del número ("Serie A · Nº 42"). */
  series: Field<string> | null;
  issuedOn: Field<CivilDate> | null;
  operationOn: Field<CivilDate> | null;
  dueOn: Field<CivilDate> | null;
  issuer: ExtractedParty;
  recipient: ExtractedParty;
  baseCents: Field<number> | null;
  /** El tipo de IVA si la factura lleva uno solo. */
  vatBps: Field<number> | null;
  vatRegime: Field<VatRegime> | null;
  vatCents: Field<number> | null;
  irpfBps: Field<number> | null;
  /** La retención, en positivo (se resta del total). */
  irpfCents: Field<number> | null;
  totalCents: Field<number> | null;
  lines: ExtractedLine[];
  paymentMethod: Field<PaymentMethod> | null;
  /** La factura dice que está cobrada (sello «PAGADA», «Pagado el…») o pendiente. */
  paid: Field<boolean> | null;
  /** La fecha en que se cobró, si la imprime (no el vencimiento). */
  paidOn: Field<CivilDate> | null;
  warnings: ExtractionWarning[];
};

/** Lo que el lector sabe de antemano de la org: con qué NIF factura (así sabe quién es el emisor). */
export type ExtractionHints = {
  issuerTaxIds?: readonly string[];
};

export const emptyParty = (): ExtractedParty => ({
  taxId: null,
  name: null,
  address: null,
  postalCode: null,
  city: null,
  province: null,
  countryCode: null,
});

export const emptyExtraction = (warnings: ExtractionWarning[] = []): ExtractedInvoice => ({
  number: null,
  series: null,
  issuedOn: null,
  operationOn: null,
  dueOn: null,
  issuer: emptyParty(),
  recipient: emptyParty(),
  baseCents: null,
  vatBps: null,
  vatRegime: null,
  vatCents: null,
  irpfBps: null,
  irpfCents: null,
  totalCents: null,
  lines: [],
  paymentMethod: null,
  paid: null,
  paidOn: null,
  warnings,
});

export const field = <T>(value: T, confidence: Confidence): Field<T> => ({ value, confidence });

const RANK: Record<Confidence, number> = { high: 2, medium: 1, low: 0 };

/** La menor de varias confianzas. */
export function minConfidence(...values: Confidence[]): Confidence {
  return values.reduce<Confidence>((min, c) => (RANK[c] < RANK[min] ? c : min), "high");
}

export function atLeast(value: Confidence | null | undefined, min: Confidence): boolean {
  return value !== null && value !== undefined && RANK[value] >= RANK[min];
}
