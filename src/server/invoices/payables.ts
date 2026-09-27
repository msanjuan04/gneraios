import "server-only";
import type { PaymentMethod } from "@/app/[org]/invoices/schema";
import { createClient } from "@/lib/supabase/server";

/** Como mucho, las facturas pendientes que se enseñan para cobrar de una vez. */
const PAYABLE_LIMIT = 100;

/** Una factura emitida con algo pendiente de cobro, para «Registrar cobro» en la ficha o el proyecto. */
export type PayableInvoice = {
  id: string;
  number: string;
  issuedOn: string;
  dueOn: string | null;
  /** Lo que hay que cobrar: el total con IVA menos lo rectificado. */
  netTotalCents: number;
  outstandingCents: number;
  overdue: boolean;
  /**
   * Contratos que factura (los de sus líneas, como en project_contract_revenue): así se sabe qué
   * facturas son de un proyecto aunque la factura agrupe varios contratos.
   */
  contractIds: string[];
  /** El método con el que se emitió: el que se propone al cobrarla. */
  paymentMethod: PaymentMethod;
};

/**
 * Facturas del cliente con algo pendiente (ordinarias emitidas, con o sin vencer), de la más
 * antigua a la más nueva: el orden en que se reparte un cobro. Lo pendiente sale de
 * invoices_overview, la única definición de «cobrada».
 */
export async function getPayableInvoices(orgId: string, clientId: string): Promise<PayableInvoice[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invoices_overview")
    .select("id, number, issued_on, due_on, net_total_cents, outstanding_cents, status, contract_id")
    .eq("org_id", orgId)
    .eq("client_id", clientId)
    .eq("kind", "ordinary")
    .in("status", ["issued", "overdue"])
    .gt("outstanding_cents", 0)
    .order("issued_on", { ascending: true })
    .order("number", { ascending: true })
    .limit(PAYABLE_LIMIT);
  if (error) throw error;
  const rows = data ?? [];
  if (rows.length === 0) return [];

  const ids = rows.flatMap((r) => (r.id ? [r.id] : []));
  const [methods, contracts] = await Promise.all([
    supabase.from("invoices").select("id, payment_method").eq("org_id", orgId).in("id", ids),
    supabase.from("project_contract_revenue").select("invoice_id, contract_id").eq("org_id", orgId).in("invoice_id", ids),
  ]);
  if (methods.error) throw methods.error;
  if (contracts.error) throw contracts.error;
  const methodOf = new Map((methods.data ?? []).map((m) => [m.id, m.payment_method]));
  const contractsOf = new Map<string, Set<string>>();
  const addContract = (invoiceId: string | null, contractId: string | null) => {
    if (!invoiceId || !contractId) return;
    const set = contractsOf.get(invoiceId) ?? new Set<string>();
    set.add(contractId);
    contractsOf.set(invoiceId, set);
  };
  for (const r of rows) addContract(r.id, r.contract_id);
  for (const c of contracts.data ?? []) addContract(c.invoice_id, c.contract_id);

  return rows.flatMap((r) =>
    r.id && r.number && r.issued_on
      ? [
          {
            id: r.id,
            number: r.number,
            issuedOn: r.issued_on,
            dueOn: r.due_on,
            netTotalCents: r.net_total_cents ?? 0,
            outstandingCents: r.outstanding_cents ?? 0,
            overdue: r.status === "overdue",
            contractIds: [...(contractsOf.get(r.id) ?? [])],
            paymentMethod: methodOf.get(r.id) ?? "transfer",
          },
        ]
      : [],
  );
}
