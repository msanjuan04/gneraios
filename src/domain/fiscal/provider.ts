// Capa fiscal (ARCHITECTURE.md §7.6). GNERAI OS no implementa Verifactu: delega la emisión en
// un FiscalProvider. Hoy solo existe el interno (numeración propia sin huecos y PDF propio),
// que emite legalmente mientras el emisor no esté obligado a Verifactu. Conectar un proveedor
// certificado (FacturaDirecta, Invopop, Holded…) se reduce a escribir su adaptador.

import type { CivilDate } from "../dates/civil-date";
import type { Cents } from "../money";

export type FiscalProviderId = "internal" | "fake_certified";

export type FiscalTotals = { subtotalCents: Cents; vatCents: Cents; irpfCents: Cents; totalCents: Cents };

/** Lo que se envía al proveedor: la factura ya validada, con emisor y cliente congelados. */
export type FiscalDocument = {
  invoiceId: string;
  kind: "ordinary" | "rectifying";
  /** Número asignado por GNERAI OS cuando el proveedor no numera (proveedor interno). */
  number: string | null;
  /** Serie del proveedor (`invoice_series.provider_series_ref`), si numera él. */
  seriesRef: string | null;
  issuedOn: CivilDate;
  issuer: { taxId: string; legalName: string };
  client: { taxId: string | null; legalName: string; countryCode: string };
  lines: Array<{
    description: string;
    quantity: string;
    unitPriceCents: Cents;
    discountBps: number;
    baseCents: Cents;
    vatBps: number;
    vatRegime: "general" | "exempt" | "reverse_charge_eu" | "not_subject";
    vatCents: Cents;
    irpfCents: Cents;
  }>;
  totals: FiscalTotals;
  rectifies: { number: string; issuedOn: CivilDate; reason: string } | null;
};

export type ProviderRef = { provider: FiscalProviderId; id: string };

export type IssueResult = {
  number: string;
  issuedOn: CivilDate;
  providerRef?: ProviderRef;
  /** Se comparan con los nuestros: si no cuadran, no se da por emitida. */
  totals: FiscalTotals;
  legal?: { qrUrl?: string; hash?: string; aeatStatus?: string };
};

export type ProviderStatus = { state: "accepted" | "pending" | "rejected"; detail?: string };

export interface FiscalProvider {
  readonly id: FiscalProviderId;
  readonly capabilities: {
    /** El proveedor asigna el número (si no, lo asigna el contador sin huecos de GNERAI OS). */
    assignsNumber: boolean;
    verifactu: boolean;
    /** Devuelve el PDF legal (con su QR): es el que se guarda y se envía al cliente. */
    providesPdf: boolean;
  };
  /** Idempotente por `idempotencyKey` (el id de la factura): reintentar nunca registra dos veces. */
  issue(doc: FiscalDocument, opts: { idempotencyKey: string }): Promise<IssueResult>;
  /** Reconciliación del estado en el proveedor (p. ej. aceptación de la AEAT). */
  getStatus(ref: ProviderRef): Promise<ProviderStatus>;
  getPdf?(ref: ProviderRef): Promise<Uint8Array>;
}

export class FiscalError extends Error {
  constructor(
    readonly code: "number_missing" | "number_mismatch" | "totals_mismatch" | "provider_unavailable" | "provider_rejected",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "FiscalError";
  }
}

export function totalsMatch(a: FiscalTotals, b: FiscalTotals): boolean {
  return (
    a.subtotalCents === b.subtotalCents &&
    a.vatCents === b.vatCents &&
    a.irpfCents === b.irpfCents &&
    a.totalCents === b.totalCents
  );
}
