// Facturación del informe: las facturas emitidas en el mes y lo que queda pendiente de pago el día
// en que se genera (de ese mes o de antes). Los estados son los que ve el cliente en su portal
// (clientInvoiceStatus) y los importes, con IVA.

import { compareCivil } from "../dates/civil-date";
import type { Month } from "../metrics/months";
import { clientInvoiceStatus, isPayable } from "../portal/payment";
import { inMonth } from "./month";
import type { ReportInvoice, ReportInvoiceFact } from "./types";

type Issued = ReportInvoiceFact & { number: string; issuedOn: string };

const byDate = (a: ReportInvoice, b: ReportInvoice) => compareCivil(a.issuedOn, b.issuedOn) || a.number.localeCompare(b.number);

function toReportInvoice(invoice: Issued): ReportInvoice | null {
  const status = clientInvoiceStatus(invoice.kind, invoice.status);
  if (!status) return null;
  return {
    id: invoice.id,
    number: invoice.number,
    issuedOn: invoice.issuedOn,
    dueOn: invoice.dueOn,
    totalCents: invoice.totalCents,
    outstandingCents: invoice.outstandingCents,
    status,
  };
}

/**
 * `issued`: las emitidas en el mes, en orden. `pending`: las demás que siguen pendientes de pago.
 * `pendingTotalCents`: todo lo pendiente (las de las dos listas).
 */
export function reportInvoices(
  invoices: readonly ReportInvoiceFact[],
  month: Month,
): { issued: ReportInvoice[]; pending: ReportInvoice[]; pendingTotalCents: number } {
  const emitted = invoices.filter((invoice): invoice is Issued => Boolean(invoice.number && invoice.issuedOn));
  const issued: ReportInvoice[] = [];
  const pending: ReportInvoice[] = [];
  let pendingTotalCents = 0;
  for (const invoice of emitted) {
    const view = toReportInvoice(invoice);
    if (!view) continue;
    const payable = isPayable(invoice);
    if (payable) pendingTotalCents += invoice.outstandingCents;
    if (inMonth(invoice.issuedOn, month)) issued.push(view);
    else if (payable) pending.push(view);
  }
  return { issued: issued.sort(byDate), pending: pending.sort(byDate), pendingTotalCents };
}
