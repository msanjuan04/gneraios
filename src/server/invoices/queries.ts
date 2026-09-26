import "server-only";
import { type ListFilter, sanitizeSearch, statusesFor } from "@/app/[org]/invoices/schema";
import type {
  ClientInvoiceItem,
  ClientInvoicesData,
  InvoiceListItem,
  InvoicesSummary,
  LastBillingRun,
  OutboxItem,
} from "@/components/invoices/types";
import { addDays, daysBetween, type CivilDate } from "@/domain/dates/civil-date";
import { nowInZone } from "@/lib/clock";
import type { Database } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/server/billing/context";
import { BILLING_JOB } from "@/server/billing/run";

type Supabase = Awaited<ReturnType<typeof createClient>>;
type OverviewRow = Database["public"]["Views"]["invoices_overview"]["Row"];

const LIST_COLUMNS =
  "id, number, kind, status, lifecycle, client_id, client_name, issuer_id, issuer_name, series_code, issued_on, due_on, subtotal_cents, total_cents, outstanding_cents, lines_count, created_at";

/** Filas de la vista con lo imprescindible (la vista lo devuelve todo como nullable). */
function toListItem(row: Partial<OverviewRow>): InvoiceListItem | null {
  if (!row.id || !row.client_id || !row.issuer_id || !row.status || !row.kind) return null;
  return {
    id: row.id,
    number: row.number ?? null,
    kind: row.kind,
    status: row.status,
    clientId: row.client_id,
    clientName: row.client_name ?? "",
    issuerId: row.issuer_id,
    issuerName: row.issuer_name ?? "",
    seriesCode: row.series_code ?? null,
    issuedOn: row.issued_on ?? null,
    dueOn: row.due_on ?? null,
    subtotalCents: row.subtotal_cents ?? 0,
    totalCents: row.total_cents ?? 0,
    outstandingCents: row.outstanding_cents ?? 0,
    linesCount: row.lines_count ?? 0,
    createdAt: row.created_at ?? "",
  };
}

/** Clientes cuyo nombre coincide sin tener en cuenta los acentos ("Mataro" encuentra "Mataró"). */
async function matchingClientIds(supabase: Supabase, orgId: string, q: string): Promise<string[]> {
  const { data, error } = await supabase.rpc("search_org", { p_org: orgId, p_query: q, p_limit: 50 });
  if (error) {
    console.error("[invoices] search_org", error);
    return [];
  }
  return (data ?? []).filter((r) => r.kind === "client").map((r) => r.id);
}

/**
 * Facturas de una pestaña del listado, con búsqueda por número o cliente. Primero los
 * borradores, después lo emitido de lo más reciente a lo más antiguo.
 */
export async function listInvoices(
  supabase: Supabase,
  orgId: string,
  opts: { filter: ListFilter; q: string; clientId: string | null; limit: number },
): Promise<{ rows: InvoiceListItem[]; truncated: boolean }> {
  let query = supabase.from("invoices_overview").select(LIST_COLUMNS).eq("org_id", orgId);
  const statuses = statusesFor(opts.filter);
  if (statuses) query = query.in("status", statuses);
  if (opts.clientId) query = query.eq("client_id", opts.clientId);

  const q = sanitizeSearch(opts.q);
  if (q) {
    const ids = await matchingClientIds(supabase, orgId, q);
    const conditions = [`number.ilike.*${q}*`, `client_name.ilike.*${q}*`];
    if (ids.length > 0) conditions.push(`client_id.in.(${ids.join(",")})`);
    query = query.or(conditions.join(","));
  }

  const { data, error } = await query
    .order("lifecycle", { ascending: true })
    .order("issued_on", { ascending: false, nullsFirst: true })
    .order("created_at", { ascending: false })
    .limit(opts.limit + 1);
  if (error) throw error;
  const rows = (data ?? []).flatMap((r) => toListItem(r) ?? []);
  return { rows: rows.slice(0, opts.limit), truncated: rows.length > opts.limit };
}

/** Cabecera del listado: pendiente de cobro, vencido, borradores y cuántas hay en cada pestaña. */
export async function getInvoicesSummary(supabase: Supabase, orgId: string): Promise<InvoicesSummary> {
  const [open, paid, all] = await Promise.all([
    fetchAll(
      (from, to) =>
        supabase
          .from("invoices_overview")
          .select("id, status, outstanding_cents, total_cents")
          .eq("org_id", orgId)
          .in("status", ["draft", "issuing", "issued", "overdue"])
          .order("id")
          .range(from, to),
      "invoices.summary",
    ),
    supabase.from("invoices_overview").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("status", "paid"),
    supabase.from("invoices").select("id", { count: "exact", head: true }).eq("org_id", orgId),
  ]);
  if (paid.error) throw paid.error;
  if (all.error) throw all.error;

  const summary: InvoicesSummary = {
    pendingCents: 0,
    pendingCount: 0,
    overdueCents: 0,
    overdueCount: 0,
    draftsCount: 0,
    draftsTotalCents: 0,
    counts: { draft: 0, issued: 0, overdue: 0, paid: paid.count ?? 0, all: all.count ?? 0 },
  };
  for (const row of open) {
    const outstanding = row.outstanding_cents ?? 0;
    if (row.status === "draft" || row.status === "issuing") {
      summary.draftsCount += 1;
      summary.draftsTotalCents += row.total_cents ?? 0;
      summary.counts.draft += 1;
    } else if (row.status === "issued" || row.status === "overdue") {
      // Las rectificativas no tienen pendiente propio: restan del de su original.
      if (outstanding !== 0) {
        summary.pendingCents += outstanding;
        summary.pendingCount += 1;
      }
      summary.counts[row.status] += 1;
      if (row.status === "overdue") {
        summary.overdueCents += outstanding;
        summary.overdueCount += 1;
      }
    }
  }
  return summary;
}

/** Última ejecución del cron de facturación ("Último cron: hoy 06:00 · OK"). */
export async function getLastBillingRun(supabase: Supabase, orgId: string, timeZone: string): Promise<LastBillingRun | null> {
  const { data, error } = await supabase
    .from("job_runs")
    .select("status, started_at, run_on, error")
    .eq("org_id", orgId)
    .eq("job", BILLING_JOB)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const today = nowInZone(timeZone).date;
  const day = nowInZone(timeZone, new Date(data.started_at)).date;
  return {
    status: data.status,
    startedAt: data.started_at,
    day: day === today ? "today" : day === addDays(today, -1) ? "yesterday" : "earlier",
    runOn: data.run_on,
    error: data.error,
  };
}

/** Recordatorios esperando a que un socio los apruebe. */
export async function getOutboxCount(supabase: Supabase, orgId: string): Promise<number> {
  const { count, error } = await supabase
    .from("outbound_emails")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("status", "pending_approval");
  if (error) throw error;
  return count ?? 0;
}

const OUTBOX_LIMIT = 100;

/** Bandeja «Por enviar» (recordatorios por aprobar) o el historial de envíos. */
export async function listOutbox(
  supabase: Supabase,
  orgId: string,
  tab: "pending" | "sent",
  today: CivilDate,
): Promise<OutboxItem[]> {
  const base = supabase
    .from("outbound_emails")
    .select("id, template, status, language, to_emails, subject, body, created_at, sent_at, error, invoice_id")
    .eq("org_id", orgId);
  const { data, error } = await (tab === "pending"
    ? base.eq("status", "pending_approval").order("created_at", { ascending: true })
    : base.in("status", ["sent", "failed"]).order("created_at", { ascending: false })
  ).limit(OUTBOX_LIMIT);
  if (error) throw error;

  const invoiceIds = [...new Set(data.map((e) => e.invoice_id).filter((id): id is string => Boolean(id)))];
  const invoices = new Map<string, NonNullable<OutboxItem["invoice"]>>();
  if (invoiceIds.length > 0) {
    const res = await supabase
      .from("invoices_overview")
      .select("id, number, client_id, client_name, due_on, outstanding_cents, status")
      .in("id", invoiceIds);
    if (res.error) throw res.error;
    for (const r of res.data) {
      if (!r.id || !r.client_id || !r.status) continue;
      invoices.set(r.id, {
        id: r.id,
        number: r.number,
        clientId: r.client_id,
        clientName: r.client_name ?? "",
        dueOn: r.due_on,
        outstandingCents: r.outstanding_cents ?? 0,
        status: r.status,
      });
    }
  }

  return data.map((e) => {
    const invoice = e.invoice_id ? (invoices.get(e.invoice_id) ?? null) : null;
    const days = invoice?.dueOn ? daysBetween(invoice.dueOn, today) : null;
    return {
      id: e.id,
      template: e.template,
      status: e.status,
      language: e.language,
      to: e.to_emails,
      subject: e.subject,
      body: e.body,
      createdAt: e.created_at,
      sentAt: e.sent_at,
      error: e.error,
      invoice,
      daysOverdue: days !== null && days > 0 ? days : null,
    };
  });
}

const CLIENT_CARD_LIMIT = 6;

/**
 * Facturas de un cliente para su ficha 360: las más recientes (borradores primero), lo que
 * tiene pendiente de cobro y vencido (con IVA) y su facturación neta emitida (base, sin IVA).
 */
export async function getClientInvoices(orgId: string, clientId: string): Promise<ClientInvoicesData> {
  const supabase = await createClient();
  const [latest, open, total, billed] = await Promise.all([
    supabase
      .from("invoices_overview")
      .select("id, number, kind, status, issued_on, due_on, subtotal_cents, total_cents, outstanding_cents")
      .eq("org_id", orgId)
      .eq("client_id", clientId)
      .order("lifecycle", { ascending: true })
      .order("issued_on", { ascending: false, nullsFirst: true })
      .order("created_at", { ascending: false })
      .limit(CLIENT_CARD_LIMIT),
    supabase
      .from("invoices_overview")
      .select("status, outstanding_cents")
      .eq("org_id", orgId)
      .eq("client_id", clientId)
      .in("status", ["draft", "issuing", "issued", "overdue"]),
    supabase.from("invoices").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("client_id", clientId),
    supabase.from("clients_overview").select("billed_net_cents").eq("org_id", orgId).eq("id", clientId).maybeSingle(),
  ]);
  for (const res of [latest, open, total, billed]) if (res.error) throw res.error;

  const invoices: ClientInvoiceItem[] = (latest.data ?? []).flatMap((r) =>
    r.id && r.status && r.kind
      ? [
          {
            id: r.id,
            number: r.number,
            kind: r.kind,
            status: r.status,
            issuedOn: r.issued_on,
            dueOn: r.due_on,
            subtotalCents: r.subtotal_cents ?? 0,
            totalCents: r.total_cents ?? 0,
            outstandingCents: r.outstanding_cents ?? 0,
          },
        ]
      : [],
  );

  let outstandingCents = 0;
  let overdueCents = 0;
  let overdueCount = 0;
  let draftsCount = 0;
  for (const row of open.data ?? []) {
    if (row.status === "draft" || row.status === "issuing") draftsCount += 1;
    else {
      outstandingCents += row.outstanding_cents ?? 0;
      if (row.status === "overdue") {
        overdueCents += row.outstanding_cents ?? 0;
        overdueCount += 1;
      }
    }
  }

  return {
    invoices,
    totalCount: total.count ?? 0,
    outstandingCents,
    overdueCents,
    overdueCount,
    draftsCount,
    billedNetCents: billed.data?.billed_net_cents ?? 0,
  };
}
