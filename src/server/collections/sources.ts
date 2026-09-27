import "server-only";
import type { DraftMandate, DraftRow, RemittanceStatus } from "@/components/collections/types";
import type { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/server/billing/context";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Una factura que se puede domiciliar, con su mandato y si ya va en otra remesa abierta. */
export type SepaSource = Omit<DraftRow, "selected">;

const CHUNK = 100;

/** Trocea una lista de ids para no pasar URLs enormes a PostgREST. */
function chunks<T>(values: readonly T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

const OVERVIEW_COLUMNS = "id, number, client_id, client_name, issued_on, due_on, outstanding_cents, status, kind, lifecycle, issuer_id";

/** Mandatos activos de un acreedor, por cliente. */
export async function activeMandatesByClient(supabase: Supabase, orgId: string, issuerId: string): Promise<Map<string, DraftMandate>> {
  const rows = await fetchAll(
    (from, to) =>
      supabase
        .from("client_mandates_overview")
        .select("id, client_id, reference, debtor_name, iban, bic, signed_on, next_sequence_type")
        .eq("org_id", orgId)
        .eq("issuer_id", issuerId)
        .eq("is_active", true)
        .order("id")
        .range(from, to),
    "collections.mandates",
  );
  const out = new Map<string, DraftMandate>();
  for (const m of rows) {
    if (!m.id || !m.client_id || !m.reference || !m.debtor_name || !m.iban || !m.signed_on) continue;
    out.set(m.client_id, {
      id: m.id,
      reference: m.reference,
      debtorName: m.debtor_name,
      iban: m.iban,
      bic: m.bic,
      signedOn: m.signed_on,
      nextSequence: m.next_sequence_type ?? "FRST",
    });
  }
  return out;
}

/**
 * Facturas de un emisor para una remesa. Sin `invoiceIds`, las candidatas: emitidas ordinarias con
 * algo pendiente cuya forma de pago es la domiciliación o cuyo cliente tiene mandato con este
 * acreedor (más `include`, las que ya están en el borrador). Con `invoiceIds`, exactamente esas.
 * `exceptRemittanceId` es la remesa que se edita: sus propios recibos no cuentan como «otra remesa».
 */
export async function loadSepaSources(
  supabase: Supabase,
  orgId: string,
  issuerId: string,
  opts: { invoiceIds?: readonly string[]; include?: readonly string[]; exceptRemittanceId?: string | null } = {},
): Promise<SepaSource[]> {
  const overview = opts.invoiceIds
    ? (
        await Promise.all(
          chunks([...new Set(opts.invoiceIds)]).map(async (ids) => {
            const { data, error } = await supabase
              .from("invoices_overview")
              .select(OVERVIEW_COLUMNS)
              .eq("org_id", orgId)
              .eq("issuer_id", issuerId)
              .in("id", ids);
            if (error) throw error;
            return data;
          }),
        )
      ).flat()
    : [
        ...(await fetchAll(
          (from, to) =>
            supabase
              .from("invoices_overview")
              .select(OVERVIEW_COLUMNS)
              .eq("org_id", orgId)
              .eq("issuer_id", issuerId)
              .eq("kind", "ordinary")
              .in("status", ["issued", "overdue"])
              .gt("outstanding_cents", 0)
              .order("id")
              .range(from, to),
          "collections.candidates",
        )),
        ...(
          await Promise.all(
            chunks([...new Set(opts.include ?? [])]).map(async (ids) => {
              const { data, error } = await supabase
                .from("invoices_overview")
                .select(OVERVIEW_COLUMNS)
                .eq("org_id", orgId)
                .eq("issuer_id", issuerId)
                .in("id", ids);
              if (error) throw error;
              return data;
            }),
          )
        ).flat(),
      ];

  const byId = new Map(overview.flatMap((r) => (r.id ? [[r.id, r] as const] : [])));
  const ids = [...byId.keys()];
  const [methods, mandates, openItems] = await Promise.all([
    Promise.all(
      chunks(ids).map(async (chunk) => {
        const { data, error } = await supabase.from("invoices").select("id, payment_method").eq("org_id", orgId).in("id", chunk);
        if (error) throw error;
        return data;
      }),
    ).then((rows) => new Map(rows.flat().map((r) => [r.id, r.payment_method]))),
    activeMandatesByClient(supabase, orgId, issuerId),
    fetchAll(
      (from, to) =>
        supabase
          .from("sepa_remittance_items_overview")
          .select("invoice_id, remittance_id, remittance_status, collection_on")
          .eq("org_id", orgId)
          .eq("issuer_id", issuerId)
          .is("returned_on", null)
          .in("remittance_status", ["draft", "generated", "sent"])
          .order("id")
          .range(from, to),
      "collections.openItems",
    ),
  ]);

  const other = new Map<string, { id: string; collectionOn: string; status: RemittanceStatus }>();
  for (const it of openItems) {
    if (!it.invoice_id || !it.remittance_id || !it.collection_on || !it.remittance_status) continue;
    if (it.remittance_id === opts.exceptRemittanceId) continue;
    other.set(it.invoice_id, { id: it.remittance_id, collectionOn: it.collection_on, status: it.remittance_status });
  }

  const included = new Set([...(opts.include ?? []), ...(opts.invoiceIds ?? [])]);
  const sources: SepaSource[] = [];
  for (const row of byId.values()) {
    if (!row.id || !row.client_id || !row.status) continue;
    const mandate = mandates.get(row.client_id) ?? null;
    const paymentMethod = methods.get(row.id) ?? "transfer";
    if (!included.has(row.id) && paymentMethod !== "sepa_debit" && !mandate) continue;
    sources.push({
      invoiceId: row.id,
      number: row.number,
      clientId: row.client_id,
      clientName: row.client_name ?? "",
      issuedOn: row.issued_on,
      dueOn: row.due_on,
      outstandingCents: row.outstanding_cents ?? 0,
      invoiceStatus: row.status,
      paymentMethod,
      mandate,
      otherRemittance: other.get(row.id) ?? null,
    });
  }
  return sources.sort(
    (a, b) =>
      (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999") ||
      a.clientName.localeCompare(b.clientName, "es") ||
      (a.number ?? "").localeCompare(b.number ?? ""),
  );
}
