import type { CivilDate } from "@/domain/dates/civil-date";
import type { PdfIssuer, PdfLocale, PdfParty, PdfVatGroup, PdfVatRegime } from "./types";

// Datos de la plantilla de presupuesto (ARCHITECTURE.md §9.3): la misma estética que la
// factura, con lo puntual, lo recurrente y lo de uso por separado. Como en la factura, todo
// llega ya calculado por el llamador (src/app/[org]/quotes/summary.ts): aquí no se redondea.

export type QuotePdfBillingType = "one_off" | "monthly" | "yearly" | "usage";
export type QuotePdfPlanWhen = "on_accept" | "on_delivery" | "date";

export type QuotePdfLine = {
  description: string;
  billingType: QuotePdfBillingType;
  /** `numeric(12,3)` en texto ("1.500"). */
  quantity: string;
  unitPriceCents: number;
  discountBps: number;
  /** Base de un ciclo (o de un uso): cantidad × precio − descuento. */
  baseCents: number;
  vatBps: number;
  vatRegime: PdfVatRegime;
  /** Recurrentes y de uso: desde cuándo (null = desde la aceptación) y hasta cuándo. */
  startsOn?: CivilDate | null;
  endsOn?: CivilDate | null;
};

/** Totales de un tipo de línea (sin IRPF: la retención va en cada factura). */
export type QuotePdfTotals = { subtotalCents: number; vatCents: number; totalCents: number; vatBreakdown: PdfVatGroup[] };

/** Un pago del plan con lo que cobra (el último, el resto). */
export type QuotePdfPayment = {
  label: string;
  percentBps: number;
  when: QuotePdfPlanWhen;
  plannedOn?: CivilDate | null;
  baseCents: number;
  totalCents: number;
};

export type QuoteDocumentData = {
  locale: PdfLocale;
  /** Sin número todavía: marca de borrador. */
  isDraft: boolean;
  number: string | null;
  title: string;
  issuedOn: CivilDate;
  validUntil: CivilDate | null;
  issuer: PdfIssuer;
  client: PdfParty;
  /** En el orden del presupuesto; la plantilla las reparte por secciones. */
  lines: QuotePdfLine[];
  /** Ya calculados y separados: nunca se suman entre sí. null = no hay líneas de ese tipo. */
  totals: { oneOff: QuotePdfTotals | null; monthly: QuotePdfTotals | null; yearly: QuotePdfTotals | null };
  /** Plan de pagos de lo puntual (vacío si no hay nada puntual). */
  payments: QuotePdfPayment[];
  /** Menciones ya resueltas (p. ej. inversión del sujeto pasivo), tal cual. */
  legalNotes: string[];
  notes?: string | null;
  /** Aceptado: la fecha sustituye a los huecos de firma. */
  acceptedOn?: CivilDate | null;
};
