import "server-only";
import type { PaymentMethod } from "@/app/[org]/clients/schema";
import { type CollectionEntry, type CollectionsSummary, sortCollections, summarizeCollections } from "@/domain/clients/collections";
import { nowInZone } from "@/lib/clock";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/server/billing/context";

/** Cobros que se enseñan en la ficha; el resto, en el histórico. */
const CARD_LIMIT = 8;

export type ClientCollectionItem = CollectionEntry & {
  method: PaymentMethod;
  reference: string | null;
  /** Sin factura: su concepto, notas y proyecto. */
  concept: string | null;
  notes: string | null;
  projectId: string | null;
  projectName: string | null;
  /** De una factura: cuál. */
  invoiceId: string | null;
  invoiceNumber: string | null;
};

export type ClientCollectionsData = {
  /** Los más recientes (CARD_LIMIT). */
  items: ClientCollectionItem[];
  summary: CollectionsSummary;
};

/**
 * Lo que ha pagado un cliente: los cobros de sus facturas y los cobros sin factura, juntos y
 * de lo más reciente a lo más antiguo, con los totales de siempre y del año.
 */
export async function getClientCollections(org: { id: string; timezone: string }, clientId: string): Promise<ClientCollectionsData> {
  const supabase = await createClient();
  const [payments, receipts] = await Promise.all([
    fetchAll(
      (a, b) =>
        supabase
          .from("payments")
          .select("id, amount_cents, paid_on, method, reference, invoice_id, invoices!inner(client_id, number)")
          .eq("org_id", org.id)
          .eq("invoices.client_id", clientId)
          .order("id")
          .range(a, b),
      "clients.collections.payments",
    ),
    fetchAll(
      (a, b) =>
        supabase
          .from("client_receipts")
          .select("id, amount_cents, received_on, method, reference, concept, notes, project_id, projects(name)")
          .eq("org_id", org.id)
          .eq("client_id", clientId)
          .order("id")
          .range(a, b),
      "clients.collections.receipts",
    ),
  ]);

  const entries: ClientCollectionItem[] = [
    ...payments.map((p) => ({
      kind: "invoice" as const,
      id: p.id,
      on: p.paid_on,
      amountCents: p.amount_cents,
      method: p.method,
      reference: p.reference,
      concept: null,
      notes: null,
      projectId: null,
      projectName: null,
      invoiceId: p.invoice_id,
      invoiceNumber: p.invoices.number,
    })),
    ...receipts.map((r) => ({
      kind: "receipt" as const,
      id: r.id,
      on: r.received_on,
      amountCents: r.amount_cents,
      method: r.method,
      reference: r.reference,
      concept: r.concept,
      notes: r.notes,
      projectId: r.project_id,
      projectName: r.projects?.name ?? null,
      invoiceId: null,
      invoiceNumber: null,
    })),
  ];
  return {
    items: sortCollections(entries).slice(0, CARD_LIMIT),
    summary: summarizeCollections(entries, nowInZone(org.timezone).date),
  };
}
