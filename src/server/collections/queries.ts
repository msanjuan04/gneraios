import "server-only";
import { cache } from "react";
import type {
  InvoiceCollectionsData,
  RemittanceEditorData,
  RemittanceListItem,
  RemittanceViewData,
  RemittanceViewItem,
} from "@/components/collections/types";
import { checkItem } from "@/domain/collections";
import type { CivilDate } from "@/domain/dates/civil-date";
import type { Tables } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/server/action-utils";
import { fetchAll } from "@/server/billing/context";
import { loadCreditor } from "./creditors";
import { loadSepaSources } from "./sources";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Remesas de la org, de la fecha de cobro más reciente a la más antigua. */
export async function listRemittances(supabase: Supabase, orgId: string): Promise<RemittanceListItem[]> {
  const rows = await fetchAll(
    (from, to) =>
      supabase
        .from("sepa_remittances_overview")
        .select(
          "id, issuer_id, issuer_name, collection_on, status, items_count, total_cents, returned_count, returned_cents, message_id, generated_at, sent_at, settled_on, created_at",
        )
        .eq("org_id", orgId)
        .order("collection_on", { ascending: false })
        .order("created_at", { ascending: false })
        .range(from, to),
    "collections.remittances",
  );
  return rows.flatMap((r) =>
    r.id && r.issuer_id && r.collection_on && r.status && r.created_at
      ? [
          {
            id: r.id,
            issuerId: r.issuer_id,
            issuerName: r.issuer_name ?? "",
            collectionOn: r.collection_on,
            status: r.status,
            itemsCount: r.items_count ?? 0,
            totalCents: r.total_cents ?? 0,
            returnedCount: r.returned_count ?? 0,
            returnedCents: r.returned_cents ?? 0,
            messageId: r.message_id,
            generatedAt: r.generated_at,
            sentAt: r.sent_at,
            settledOn: r.settled_on,
            createdAt: r.created_at,
          },
        ]
      : [],
  );
}

/** La remesa (fila), si existe en la org. Una vez por petición. */
export const getRemittanceRecord = cache(async (orgId: string, remittanceId: string): Promise<Tables<"sepa_remittances"> | null> => {
  if (!idSchema.safeParse(remittanceId).success) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.from("sepa_remittances").select("*").eq("org_id", orgId).eq("id", remittanceId).maybeSingle();
  if (error) throw error;
  return data;
});

/**
 * Selección de facturas de una remesa en borrador (o de una nueva): las candidatas del emisor, con
 * su mandato y si ya van en otra remesa. En una nueva se preseleccionan las vencidas en la fecha
 * de cobro con forma de pago SEPA, mandato activo y sin problemas.
 */
export async function loadRemittanceEditor(
  org: Pick<Tables<"orgs">, "id">,
  target:
    | { mode: "create"; remittanceId: string; issuerId: string; collectionOn: CivilDate }
    | { mode: "edit"; remittance: Tables<"sepa_remittances"> },
  today: CivilDate,
): Promise<RemittanceEditorData | null> {
  const supabase = await createClient();
  const issuerId = target.mode === "create" ? target.issuerId : target.remittance.issuer_id;
  const collectionOn = target.mode === "create" ? target.collectionOn : target.remittance.collection_on;
  const remittanceId = target.mode === "create" ? target.remittanceId : target.remittance.id;

  let draftInvoiceIds: string[] = [];
  if (target.mode === "edit") {
    const { data, error } = await supabase.from("sepa_remittance_items").select("invoice_id").eq("remittance_id", remittanceId);
    if (error) throw error;
    draftInvoiceIds = data.map((i) => i.invoice_id);
  }

  const [creditor, sources] = await Promise.all([
    loadCreditor(supabase, org.id, issuerId),
    loadSepaSources(supabase, org.id, issuerId, { include: draftInvoiceIds, exceptRemittanceId: remittanceId }),
  ]);
  if (!creditor) return null;

  const inDraft = new Set(draftInvoiceIds);
  const rows = sources.map((s) => ({
    ...s,
    selected:
      target.mode === "edit"
        ? inDraft.has(s.invoiceId)
        : s.paymentMethod === "sepa_debit" &&
          s.otherRemittance === null &&
          s.dueOn !== null &&
          s.dueOn <= collectionOn &&
          checkItem({ id: s.invoiceId, invoiceNumber: s.number, amountCents: s.outstandingCents, mandate: s.mandate }, collectionOn)
            .length === 0,
  }));

  return {
    mode: target.mode,
    remittanceId,
    updatedAt: target.mode === "edit" ? target.remittance.updated_at : null,
    issuer: { id: issuerId, name: creditor.issuerName },
    collectionOn,
    notes: target.mode === "edit" ? (target.remittance.notes ?? "") : "",
    creditor,
    rows,
    today,
  };
}

type Snapshot = { creditor_id?: unknown; name?: unknown; iban?: unknown; bic?: unknown };

/** Una remesa ya generada (o enviada, o cobrada): lo congelado en el fichero y cómo va cada recibo. */
export async function loadRemittanceView(
  org: Pick<Tables<"orgs">, "id">,
  remittance: Tables<"sepa_remittances">,
  today: CivilDate,
): Promise<RemittanceViewData> {
  const supabase = await createClient();
  const [overview, items, issuer] = await Promise.all([
    supabase
      .from("sepa_remittances_overview")
      .select("items_count, total_cents, returned_count, returned_cents")
      .eq("id", remittance.id)
      .maybeSingle(),
    supabase
      .from("sepa_remittance_items_overview")
      .select(
        "id, invoice_id, invoice_number, client_id, client_name, amount_cents, sequence_type, end_to_end_id, mandate_id, state, returned_on, return_code, return_reason, invoice_status, outstanding_cents",
      )
      .eq("remittance_id", remittance.id)
      .order("invoice_number"),
    supabase.from("issuers").select("legal_name, trade_name").eq("id", remittance.issuer_id).maybeSingle(),
  ]);
  for (const res of [overview, items, issuer]) if (res.error) throw res.error;

  const mandateIds = [...new Set((items.data ?? []).flatMap((i) => (i.mandate_id ? [i.mandate_id] : [])))];
  const mandates = new Map<string, Pick<Tables<"client_mandates">, "reference" | "debtor_name" | "iban">>();
  if (mandateIds.length > 0) {
    const { data, error } = await supabase.from("client_mandates").select("id, reference, debtor_name, iban").in("id", mandateIds);
    if (error) throw error;
    for (const m of data) mandates.set(m.id, m);
  }

  const snapshot = (remittance.creditor_snapshot ?? null) as Snapshot | null;
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  const creditor =
    snapshot && str(snapshot.creditor_id) && str(snapshot.iban)
      ? { creditorId: str(snapshot.creditor_id)!, name: str(snapshot.name) ?? "", iban: str(snapshot.iban)!, bic: str(snapshot.bic) }
      : null;

  const viewItems: RemittanceViewItem[] = (items.data ?? []).flatMap((i) => {
    if (!i.id || !i.invoice_id || !i.client_id || !i.state || !i.invoice_status) return [];
    const m = i.mandate_id ? mandates.get(i.mandate_id) : undefined;
    return [
      {
        id: i.id,
        invoiceId: i.invoice_id,
        invoiceNumber: i.invoice_number,
        clientId: i.client_id,
        clientName: i.client_name ?? "",
        amountCents: i.amount_cents ?? 0,
        sequenceType: i.sequence_type,
        endToEndId: i.end_to_end_id,
        mandateReference: m?.reference ?? null,
        debtorName: m?.debtor_name ?? null,
        debtorIban: m?.iban ?? null,
        state: i.state,
        returnedOn: i.returned_on,
        returnCode: i.return_code,
        returnReason: i.return_reason,
        invoiceStatus: i.invoice_status,
        outstandingCents: i.outstanding_cents ?? 0,
      },
    ];
  });

  return {
    id: remittance.id,
    status: remittance.status,
    issuer: { id: remittance.issuer_id, name: issuer.data ? (issuer.data.trade_name ?? issuer.data.legal_name) : "" },
    collectionOn: remittance.collection_on,
    notes: remittance.notes,
    messageId: remittance.message_id,
    generatedAt: remittance.generated_at,
    sentAt: remittance.sent_at,
    settledOn: remittance.settled_on,
    settledAt: remittance.settled_at,
    hasFile: remittance.file_path !== null,
    creditor,
    items: viewItems,
    totals: {
      count: overview.data?.items_count ?? viewItems.length,
      totalCents: overview.data?.total_cents ?? 0,
      returnedCount: overview.data?.returned_count ?? 0,
      returnedCents: overview.data?.returned_cents ?? 0,
    },
    today,
  };
}

/**
 * Cómo se cobra una factura por domiciliación: el mandato del cliente con su emisor, sus recibos en
 * remesas y qué cobros vienen de una remesa. Para la vista de la factura (InvoiceView).
 */
export async function getInvoiceCollections(
  orgId: string,
  invoice: { id: string; clientId: string; issuerId: string; paymentMethod: string },
): Promise<InvoiceCollectionsData> {
  const supabase = await createClient();
  const [items, mandates] = await Promise.all([
    supabase
      .from("sepa_remittance_items_overview")
      .select(
        "id, remittance_id, collection_on, remittance_status, state, amount_cents, sequence_type, returned_on, return_code, return_reason, payment_id, reversal_payment_id, created_at",
      )
      .eq("org_id", orgId)
      .eq("invoice_id", invoice.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("client_mandates_overview")
      .select("id, reference, iban, next_sequence_type")
      .eq("org_id", orgId)
      .eq("client_id", invoice.clientId)
      .eq("issuer_id", invoice.issuerId)
      .eq("is_active", true)
      .maybeSingle(),
  ]);
  if (items.error) throw items.error;
  if (mandates.error) throw mandates.error;

  const remittancePayments: Record<string, string> = {};
  const entries = (items.data ?? []).flatMap((i) => {
    if (!i.id || !i.remittance_id || !i.collection_on || !i.remittance_status || !i.state) return [];
    if (i.payment_id) remittancePayments[i.payment_id] = i.remittance_id;
    if (i.reversal_payment_id) remittancePayments[i.reversal_payment_id] = i.remittance_id;
    return [
      {
        itemId: i.id,
        remittanceId: i.remittance_id,
        collectionOn: i.collection_on,
        status: i.remittance_status,
        state: i.state,
        amountCents: i.amount_cents ?? 0,
        sequenceType: i.sequence_type,
        returnedOn: i.returned_on,
        returnCode: i.return_code,
        returnReason: i.return_reason,
      },
    ];
  });
  const m = mandates.data;
  return {
    issuerId: invoice.issuerId,
    mandate:
      m?.id && m.reference && m.iban ? { id: m.id, reference: m.reference, iban: m.iban, nextSequence: m.next_sequence_type ?? "FRST" } : null,
    entries,
    remittancePayments,
    sepa: Boolean(m) || entries.length > 0 || invoice.paymentMethod === "sepa_debit",
  };
}
