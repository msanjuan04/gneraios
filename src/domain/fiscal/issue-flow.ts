// Orquestación de la emisión (ARCHITECTURE.md §7.5), independiente de la base de datos y del
// proveedor, para poder probar el camino completo con un proveedor simulado:
//
//   draft ──(begin: validar · congelar · nº interno)──▶ issuing ──(proveedor OK · PDF guardado)──▶ issued
//
// Si algo falla a mitad, la factura se queda en «emitiendo» con su número (si ya lo tenía):
// ni se pierde ni se duplica. El reintento vuelve a entrar por `begin`, que es idempotente, y
// el proveedor recibe la misma clave de idempotencia (el id de la factura).

import type { CivilDate } from "../dates/civil-date";
import { FiscalError, totalsMatch, type FiscalDocument, type FiscalProvider, type FiscalProviderId, type IssueResult } from "./provider";

export type BeginResult = {
  lifecycle: "draft" | "issuing" | "issued";
  number: string | null;
  issuedOn: CivilDate | null;
  fiscalProvider: FiscalProviderId;
};

export type IssueFlowDeps = {
  /** Paso 1 en la base de datos (RPC issue_invoice_begin). */
  begin(invoiceId: string, issuedOn: CivilDate | undefined): Promise<BeginResult>;
  /** La factura tal como quedó congelada al empezar la emisión. */
  loadDocument(invoiceId: string): Promise<FiscalDocument>;
  provider(id: FiscalProviderId): FiscalProvider;
  /** PDF propio (con el QR del proveedor, si lo hay). */
  renderPdf(invoiceId: string, issued: IssueResult): Promise<Uint8Array>;
  /** Guarda el PDF legal y devuelve su ruta. Mientras la factura está en emisión puede sobrescribir. */
  storePdf(invoiceId: string, pdf: Uint8Array): Promise<string>;
  /** Paso 2 en la base de datos (RPC issue_invoice_complete). */
  complete(
    invoiceId: string,
    result: { number?: string; pdfPath: string; providerRef?: string; providerPayload?: Record<string, unknown> | null },
  ): Promise<void>;
};

export type IssueFlowResult = { number: string; alreadyIssued: boolean };

export async function runIssueFlow(
  deps: IssueFlowDeps,
  invoiceId: string,
  opts: { issuedOn?: CivilDate } = {},
): Promise<IssueFlowResult> {
  const begun = await deps.begin(invoiceId, opts.issuedOn);
  if (begun.lifecycle === "issued") {
    if (!begun.number) throw new FiscalError("number_missing");
    return { number: begun.number, alreadyIssued: true };
  }

  const doc = await deps.loadDocument(invoiceId);
  const provider = deps.provider(begun.fiscalProvider);
  if (!provider.capabilities.assignsNumber && !doc.number) {
    throw new FiscalError("number_missing", "La base de datos no ha asignado número.");
  }

  const result = await provider.issue(doc, { idempotencyKey: invoiceId });
  if (!totalsMatch(result.totals, doc.totals)) {
    throw new FiscalError("totals_mismatch", "Los totales del proveedor no cuadran con los nuestros.");
  }
  if (doc.number && result.number !== doc.number) {
    throw new FiscalError("number_mismatch", "El proveedor ha devuelto otro número.");
  }

  const pdf =
    provider.capabilities.providesPdf && provider.getPdf && result.providerRef
      ? await provider.getPdf(result.providerRef)
      : await deps.renderPdf(invoiceId, result);
  const pdfPath = await deps.storePdf(invoiceId, pdf);

  await deps.complete(invoiceId, {
    number: provider.capabilities.assignsNumber ? result.number : undefined,
    pdfPath,
    providerRef: result.providerRef?.id,
    providerPayload: result.legal ? { ...result.legal } : null,
  });
  return { number: result.number, alreadyIssued: false };
}
