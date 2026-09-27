import "server-only";
import { type HistoryExpense, type HistoryInvoice, type HistoryPayment, type HistoryReceipt, paymentBase } from "@/domain/invoicing/history";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/server/billing/context";

export type InvoiceHistorySource = {
  invoices: HistoryInvoice[];
  payments: HistoryPayment[];
  /** Cobros sin factura. */
  receipts: HistoryReceipt[];
  /** Solo al mirar un cliente: la base de sus gastos asignados. */
  expenses: HistoryExpense[] | null;
};

/**
 * Todo lo emitido y cobrado (con factura o sin ella) de la org o de un cliente desde siempre, para el histórico de
 * Facturas. Lo pendiente sale de invoices_overview, la única definición de «cobrada».
 */
export async function loadInvoiceHistory(orgId: string, clientId: string | null): Promise<InvoiceHistorySource> {
  const supabase = await createClient();
  const [invoices, payments, receipts, expenses] = await Promise.all([
    fetchAll((a, b) => {
      let query = supabase
        .from("invoices_overview")
        .select("id, issued_on, kind, subtotal_cents, vat_cents, irpf_cents, total_cents, outstanding_cents")
        .eq("org_id", orgId)
        .eq("lifecycle", "issued");
      if (clientId) query = query.eq("client_id", clientId);
      return query.order("id").range(a, b);
    }, "invoices.history.invoices"),
    fetchAll((a, b) => {
      let query = supabase
        .from("payments")
        .select("id, amount_cents, paid_on, invoices!inner(client_id, subtotal_cents, total_cents)")
        .eq("org_id", orgId);
      if (clientId) query = query.eq("invoices.client_id", clientId);
      return query.order("id").range(a, b);
    }, "invoices.history.payments"),
    fetchAll((a, b) => {
      let query = supabase.from("client_receipts").select("id, received_on, amount_cents").eq("org_id", orgId);
      if (clientId) query = query.eq("client_id", clientId);
      return query.order("id").range(a, b);
    }, "invoices.history.receipts"),
    clientId
      ? fetchAll(
          (a, b) =>
            supabase
              .from("expenses")
              .select("id, issued_on, base_cents")
              .eq("org_id", orgId)
              .eq("allocation", "client")
              .eq("client_id", clientId)
              .order("id")
              .range(a, b),
          "invoices.history.expenses",
        )
      : null,
  ]);

  return {
    invoices: invoices.flatMap((r) =>
      r.issued_on && r.kind
        ? [
            {
              issuedOn: r.issued_on,
              kind: r.kind,
              baseCents: r.subtotal_cents ?? 0,
              vatCents: r.vat_cents ?? 0,
              irpfCents: r.irpf_cents ?? 0,
              totalCents: r.total_cents ?? 0,
              outstandingCents: r.outstanding_cents ?? 0,
            },
          ]
        : [],
    ),
    payments: payments.map((p) => ({
      paidOn: p.paid_on,
      amountCents: p.amount_cents,
      baseCents: paymentBase(p.amount_cents, p.invoices.subtotal_cents, p.invoices.total_cents),
    })),
    receipts: receipts.map((r) => ({ receivedOn: r.received_on, amountCents: r.amount_cents })),
    expenses: expenses?.map((e) => ({ issuedOn: e.issued_on, baseCents: e.base_cents })) ?? null,
  };
}
