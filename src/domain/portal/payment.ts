import type { CivilDate } from "@/domain/dates/civil-date";
import { formatIban } from "@/domain/tax-id";

/**
 * Cómo pagar una factura desde el portal. Por transferencia: el IBAN del emisor (el que imprime
 * la factura), lo que falta por cobrar y el número de la factura como concepto. Domiciliada
 * (SEPA): se carga sola, no hay que hacer nada. Cobrada, anulada o rectificativa: nada que pagar.
 */

export type InvoiceStatus = "draft" | "issuing" | "issued" | "overdue" | "paid" | "voided";
export type PaymentMethod = "transfer" | "sepa_debit" | "card" | "cash" | "other";

export type PayableInvoice = {
  kind: "ordinary" | "rectifying";
  status: InvoiceStatus;
  number: string | null;
  outstandingCents: number;
  dueOn: CivilDate | null;
  paymentMethod: PaymentMethod;
  /** IBAN del emisor en la factura (su copia congelada al emitir) o, si no lo tiene, el actual. */
  iban: string | null;
};

export type PaymentInstruction =
  | { kind: "transfer"; iban: string | null; amountCents: number; reference: string; dueOn: CivilDate | null; overdue: boolean }
  | { kind: "sepa_debit"; amountCents: number; dueOn: CivilDate | null; overdue: boolean };

/** ¿Está pendiente de pago? Solo una ordinaria emitida (o vencida) con algo por cobrar. */
export function isPayable(invoice: Pick<PayableInvoice, "kind" | "status" | "outstandingCents">): boolean {
  return invoice.kind === "ordinary" && (invoice.status === "issued" || invoice.status === "overdue") && invoice.outstandingCents > 0;
}

export function paymentInstruction(invoice: PayableInvoice): PaymentInstruction | null {
  if (!isPayable(invoice) || !invoice.number) return null;
  const overdue = invoice.status === "overdue";
  if (invoice.paymentMethod === "sepa_debit") {
    return { kind: "sepa_debit", amountCents: invoice.outstandingCents, dueOn: invoice.dueOn, overdue };
  }
  const iban = invoice.iban?.trim() ? formatIban(invoice.iban) : null;
  return {
    kind: "transfer",
    iban,
    amountCents: invoice.outstandingCents,
    reference: invoice.number,
    dueOn: invoice.dueOn,
    overdue,
  };
}

/** Lo que el cliente ve de una factura: pagada, pendiente, vencida, anulada o rectificativa. */
export type ClientInvoiceStatus = "paid" | "pending" | "overdue" | "voided" | "rectifying";

export function clientInvoiceStatus(kind: PayableInvoice["kind"], status: InvoiceStatus): ClientInvoiceStatus | null {
  if (status === "draft" || status === "issuing") return null;
  // Una rectificativa no se cobra: corrige otra (la vista la deja siempre como emitida).
  if (kind === "rectifying") return "rectifying";
  switch (status) {
    case "paid":
      return "paid";
    case "overdue":
      return "overdue";
    case "issued":
      return "pending";
    case "voided":
      return "voided";
    default:
      // Borradores y facturas en emisión nunca llegan al cliente.
      return null;
  }
}
