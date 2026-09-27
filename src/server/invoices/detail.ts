import "server-only";
import { randomUUID } from "node:crypto";
import { cache } from "react";
import { bpsToInput, centsToInput, quantityToInput } from "@/app/[org]/invoices/schema";
import type {
  DraftEditorData,
  EditorClient,
  EditorContext,
  EditorIssuer,
  EditorSeries,
  EditorTaxRate,
  InvoiceViewData,
  LineOrigin,
  PartySnapshot,
  RelatedInvoice,
} from "@/components/invoices/types";
import type { CivilDate } from "@/domain/dates/civil-date";
import { defaultIrpfBps } from "@/domain/invoicing/draft-line";
import type { Database, Json, Tables } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/server/action-utils";

type Supabase = Awaited<ReturnType<typeof createClient>>;
type OverviewRow = Database["public"]["Views"]["invoices_overview"]["Row"];

export type InvoiceRecord = { row: Tables<"invoices">; overview: OverviewRow };

/** La factura (fila y vista con su estado derivado), si existe en la org. Una vez por petición. */
export const getInvoiceRecord = cache(async (orgId: string, invoiceId: string): Promise<InvoiceRecord | null> => {
  if (!idSchema.safeParse(invoiceId).success) return null;
  const supabase = await createClient();
  const [row, overview] = await Promise.all([
    supabase.from("invoices").select("*").eq("org_id", orgId).eq("id", invoiceId).maybeSingle(),
    supabase.from("invoices_overview").select("*").eq("org_id", orgId).eq("id", invoiceId).maybeSingle(),
  ]);
  if (row.error) throw row.error;
  if (overview.error) throw overview.error;
  if (!row.data || !overview.data) return null;
  return { row: row.data, overview: overview.data };
});

// ---------------------------------------------------------------------------
// Datos fiscales que faltan (los mismos que comprueba issue_invoice_begin)
// ---------------------------------------------------------------------------

type IssuerFiscal = Pick<Tables<"issuers">, "tax_id" | "address_line" | "postal_code" | "city">;
type ClientFiscal = Pick<Tables<"clients">, "tax_id" | "tax_id_kind" | "address_line" | "postal_code" | "city" | "country_code">;

function missingIssuerFields(i: IssuerFiscal): string[] {
  return [
    !i.tax_id && "issuer_tax_id",
    !i.address_line && "issuer_address_line",
    !i.postal_code && "issuer_postal_code",
    !i.city && "issuer_city",
  ].filter((f): f is string => Boolean(f));
}

function missingClientFields(c: ClientFiscal): string[] {
  return [
    !c.tax_id && c.tax_id_kind !== "foreign" && "client_tax_id",
    !c.address_line && "client_address_line",
    !c.postal_code && c.country_code === "ES" && "client_postal_code",
    !c.city && "client_city",
  ].filter((f): f is string => Boolean(f));
}

/** Misma regla que issue_invoice_begin: la SL sin fecha de alta aún no está constituida. */
function issuerActiveOn(
  i: Pick<Tables<"issuers">, "kind" | "active_from" | "active_until" | "archived_at">,
  day: CivilDate,
): boolean {
  if (i.archived_at) return false;
  if (!i.active_from && i.kind === "company") return false;
  if (i.active_from && day < i.active_from) return false;
  return !(i.active_until && day > i.active_until);
}

// ---------------------------------------------------------------------------
// Editor de borradores (también la factura manual nueva)
// ---------------------------------------------------------------------------

/**
 * Todo lo que necesita el editor: opciones (emisores, series con sus contadores, tipos de
 * IVA e IRPF, clientes) y los valores del formulario. Sin factura, prepara una manual nueva.
 */
export async function loadDraftEditor(
  org: Pick<Tables<"orgs">, "id">,
  record: InvoiceRecord | null,
  opts: { today: CivilDate; orgPaymentTermsDays: number; clientId?: string | null },
): Promise<DraftEditorData> {
  const supabase = await createClient();
  const invoice = record?.row ?? null;
  const [issuersRes, seriesRes, countersRes, ratesRes, clientsRes, linesRes] = await Promise.all([
    supabase
      .from("issuers")
      .select(
        "id, kind, legal_name, trade_name, default_irpf_bps, verifactu_from, fiscal_provider, tax_id, address_line, postal_code, city, active_from, active_until, archived_at, is_primary",
      )
      .eq("org_id", org.id)
      .order("is_primary", { ascending: false })
      .order("legal_name"),
    supabase
      .from("invoice_series")
      .select("id, issuer_id, code, name, kind, is_default, format, reset_yearly, archived_at")
      .eq("org_id", org.id)
      .order("code"),
    supabase.rpc("series_counters", { p_org: org.id }),
    supabase
      .from("tax_rates")
      .select("id, kind, name, rate_bps, regime, legal_note, is_default, archived_at")
      .eq("org_id", org.id)
      .order("position")
      .order("name"),
    supabase
      .from("clients")
      .select(
        "id, display_name, is_business, tax_id_kind, country_code, preferred_language, payment_terms_days, tax_id, address_line, postal_code, city, archived_at",
      )
      .eq("org_id", org.id)
      .order("display_name"),
    invoice
      ? supabase
          .from("invoice_lines")
          .select("*")
          .eq("invoice_id", invoice.id)
          .order("position")
          .order("created_at")
      : null,
  ]);
  for (const res of [issuersRes, seriesRes, countersRes, ratesRes, clientsRes, linesRes]) if (res?.error) throw res.error;
  const lines = linesRes?.data ?? [];

  const itemsRes =
    lines.length > 0
      ? await supabase
          .from("billable_items")
          .select("invoice_line_id, source")
          .in(
            "invoice_line_id",
            lines.map((l) => l.id),
          )
      : null;
  if (itemsRes?.error) throw itemsRes.error;
  const itemSource = new Map((itemsRes?.data ?? []).map((i) => [i.invoice_line_id, i.source]));

  // Lo archivado solo aparece si este borrador ya lo usa.
  const usedRates = new Set(lines.map((l) => l.tax_rate_id));
  const issuers: EditorIssuer[] = (issuersRes.data ?? [])
    .filter((i) => !i.archived_at || i.id === invoice?.issuer_id)
    .map((i) => ({
      id: i.id,
      name: i.trade_name || i.legal_name,
      kind: i.kind,
      defaultIrpfBps: i.default_irpf_bps,
      verifactuFrom: i.verifactu_from,
      fiscalProvider: i.fiscal_provider,
      activeToday: issuerActiveOn(i, opts.today),
      missing: missingIssuerFields(i),
    }));

  const counters = new Map<string, Record<number, number>>();
  for (const c of countersRes.data ?? []) {
    const byYear = counters.get(c.series_id) ?? {};
    byYear[c.year] = c.last_number;
    counters.set(c.series_id, byYear);
  }
  const series: EditorSeries[] = (seriesRes.data ?? [])
    .filter((s) => !s.archived_at || s.id === invoice?.series_id)
    .map((s) => ({
      id: s.id,
      issuerId: s.issuer_id,
      code: s.code,
      name: s.name,
      kind: s.kind,
      isDefault: s.is_default && !s.archived_at,
      format: s.format,
      resetYearly: s.reset_yearly,
      lastByYear: counters.get(s.id) ?? {},
    }));

  const rates = ratesRes.data ?? [];
  const vatRates: EditorTaxRate[] = rates
    .filter((r) => r.kind === "vat" && (!r.archived_at || usedRates.has(r.id)))
    .map((r) => ({
      id: r.id,
      name: r.name,
      rateBps: r.rate_bps,
      regime: r.regime ?? "general",
      legalNote: r.legal_note,
      isDefault: r.is_default && !r.archived_at,
      archived: Boolean(r.archived_at),
    }));
  const irpfRates = rates
    .filter((r) => r.kind === "irpf" && !r.archived_at)
    .map((r) => ({ bps: r.rate_bps, name: r.name }));

  const clients: EditorClient[] = (clientsRes.data ?? [])
    .filter((c) => !c.archived_at || c.id === invoice?.client_id)
    .map((c) => ({
      id: c.id,
      name: c.display_name,
      isBusiness: c.is_business,
      taxIdKind: c.tax_id_kind,
      countryCode: c.country_code,
      language: c.preferred_language,
      paymentTermsDays: c.payment_terms_days,
      missing: missingClientFields(c),
    }));

  const lineOrigins: Record<string, LineOrigin> = {};
  for (const l of lines) {
    lineOrigins[l.id] = { contractLineId: l.contract_line_id, itemSource: itemSource.get(l.id) ?? null };
  }

  if (invoice) {
    let rectifies: EditorContext["rectifies"] = null;
    if (invoice.rectifies_invoice_id) {
      const { data, error } = await supabase
        .from("invoices")
        .select("id, number")
        .eq("id", invoice.rectifies_invoice_id)
        .maybeSingle();
      if (error) throw error;
      if (data) rectifies = { id: data.id, number: data.number ?? "" };
    }
    const fromContract =
      invoice.contract_id !== null || invoice.grouping_key !== null || lines.some((l) => l.contract_line_id !== null);
    const lockReason = invoice.kind === "rectifying" ? "rectifying" : fromContract ? "contract" : null;

    return {
      context: {
        mode: "edit",
        invoiceId: invoice.id,
        kind: invoice.kind,
        updatedAt: invoice.updated_at,
        lockParties: lockReason !== null,
        lockReason,
        rectifies,
        lineOrigins,
      },
      defaults: {
        issuer_id: invoice.issuer_id,
        client_id: invoice.client_id,
        series_id: invoice.series_id ?? "",
        issued_on: invoice.issued_on ?? "",
        operation_on: invoice.operation_on ?? "",
        due_mode: invoice.due_on ? "date" : "terms",
        due_on: invoice.due_on ?? "",
        payment_terms_days: invoice.payment_terms_days === null ? "" : String(invoice.payment_terms_days),
        language: invoice.language,
        irpf_bps: String(invoice.irpf_bps),
        payment_method: invoice.payment_method,
        notes: invoice.notes ?? "",
        rectification_reason: invoice.rectification_reason ?? "",
        lines: lines.map((l) => ({
          id: l.id,
          description: l.description,
          quantity: quantityToInput(l.quantity),
          unit_price: centsToInput(l.unit_price_cents),
          discount: l.discount_bps === 0 ? "" : bpsToInput(l.discount_bps),
          tax_rate_id: l.tax_rate_id ?? "",
          irpf_applies: l.irpf_applies,
          billing_type: l.billing_type,
          period_start: l.period_start ?? "",
          period_end: l.period_end ?? "",
        })),
      },
      issuers,
      series,
      vatRates,
      irpfRates,
      clients,
      orgPaymentTermsDays: opts.orgPaymentTermsDays,
    };
  }

  // Factura manual nueva: el emisor principal que pueda emitir hoy y, si llega, el cliente.
  const issuer = issuers.find((i) => i.activeToday) ?? issuers[0] ?? null;
  const client = clients.find((c) => c.id === opts.clientId) ?? null;
  const irpf =
    issuer && client
      ? defaultIrpfBps(
          { defaultIrpfBps: issuer.defaultIrpfBps },
          { isBusiness: client.isBusiness, taxIdKind: client.taxIdKind, countryCode: client.countryCode },
        )
      : 0;
  const defaultVat = vatRates.find((r) => r.isDefault) ?? vatRates[0];

  return {
    context: {
      mode: "create",
      invoiceId: null,
      kind: "ordinary",
      updatedAt: null,
      lockParties: false,
      lockReason: null,
      rectifies: null,
      lineOrigins: {},
    },
    defaults: {
      issuer_id: issuer?.id ?? "",
      client_id: client?.id ?? "",
      series_id: "",
      issued_on: "",
      operation_on: "",
      due_mode: "terms",
      due_on: "",
      payment_terms_days: "",
      language: client?.language ?? "es",
      irpf_bps: String(irpf),
      payment_method: "transfer",
      notes: "",
      rectification_reason: "",
      lines: [
        {
          id: randomUUID(),
          description: "",
          quantity: "1",
          unit_price: "",
          discount: "",
          tax_rate_id: defaultVat?.id ?? "",
          irpf_applies: true,
          // Una factura hecha a mano suele ser de algo puntual; se puede cambiar.
          billing_type: "one_off",
          period_start: "",
          period_end: "",
        },
      ],
    },
    issuers,
    series,
    vatRates,
    irpfRates,
    clients,
    orgPaymentTermsDays: opts.orgPaymentTermsDays,
  };
}

// ---------------------------------------------------------------------------
// Factura emitida (o en emisión): lo congelado al emitir
// ---------------------------------------------------------------------------

function snapshot(value: Json | null, kind: "issuer" | "client"): PartySnapshot {
  const s = (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as Record<string, unknown>;
  const str = (key: string) => (typeof s[key] === "string" && (s[key] as string).trim() ? (s[key] as string) : null);
  const legalName = str("legal_name") ?? str("display_name") ?? "";
  const tradeName = kind === "issuer" ? str("trade_name") : str("display_name");
  return {
    legalName,
    tradeName: tradeName && tradeName !== legalName ? tradeName : null,
    taxId: str("tax_id"),
    addressLine: str("address_line"),
    postalCode: str("postal_code"),
    city: str("city"),
    province: str("province"),
    countryCode: str("country_code"),
    email: str("email"),
    iban: str("iban"),
    registryInfo: str("registry_info"),
  };
}

export async function loadInvoiceView(record: InvoiceRecord): Promise<InvoiceViewData> {
  const supabase: Supabase = await createClient();
  const { row, overview } = record;
  const [linesRes, paymentsRes, emailsRes, rectificationsRes, originalRes] = await Promise.all([
    supabase.from("invoice_lines").select("*").eq("invoice_id", row.id).order("position").order("created_at"),
    supabase
      .from("payments")
      .select("id, amount_cents, paid_on, method, reference")
      .eq("invoice_id", row.id)
      .order("paid_on", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase
      .from("outbound_emails")
      .select("id, template, status, to_emails, subject, sent_at, created_at, error")
      .eq("invoice_id", row.id)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("invoices")
      .select("id, number, lifecycle, issued_on, total_cents, rectification_reason")
      .eq("rectifies_invoice_id", row.id)
      .order("created_at"),
    row.rectifies_invoice_id
      ? supabase
          .from("invoices_overview")
          .select("id, number, lifecycle, status, issued_on, total_cents")
          .eq("id", row.rectifies_invoice_id)
          .maybeSingle()
      : null,
  ]);
  for (const res of [linesRes, paymentsRes, emailsRes, rectificationsRes, originalRes]) if (res?.error) throw res.error;
  const lines = linesRes.data ?? [];

  // Conceptos del contrato que siguen enlazados: si la factura se anula, se vuelven a facturar o se condonan.
  let linkedItemsCount = 0;
  if (row.kind === "ordinary" && lines.length > 0) {
    const { count, error } = await supabase
      .from("billable_items")
      .select("id", { count: "exact", head: true })
      .in(
        "invoice_line_id",
        lines.map((l) => l.id),
      );
    if (error) throw error;
    linkedItemsCount = count ?? 0;
  }

  const original = originalRes?.data;
  const rectifies: RelatedInvoice | null =
    original?.id && original.lifecycle && original.status
      ? {
          id: original.id,
          number: original.number,
          lifecycle: original.lifecycle,
          status: original.status,
          issuedOn: original.issued_on,
          totalCents: original.total_cents ?? 0,
          reason: null,
        }
      : null;

  const emails = emailsRes.data ?? [];
  return {
    id: row.id,
    number: row.number,
    kind: row.kind,
    lifecycle: row.lifecycle,
    source: row.source,
    status: overview.status ?? row.lifecycle,
    issuedOn: row.issued_on,
    operationOn: row.operation_on,
    dueOn: row.due_on,
    language: row.language,
    paymentMethod: row.payment_method,
    notes: row.notes,
    irpfBps: row.irpf_bps,
    subtotalCents: row.subtotal_cents,
    vatCents: row.vat_cents,
    irpfCents: row.irpf_cents,
    totalCents: row.total_cents,
    paidCents: overview.paid_cents ?? 0,
    outstandingCents: overview.outstanding_cents ?? 0,
    rectifiedCents: overview.rectified_cents ?? 0,
    netTotalCents: overview.net_total_cents ?? row.total_cents,
    lastPaidOn: overview.last_paid_on ?? null,
    rectificationReason: row.rectification_reason,
    clientId: row.client_id,
    clientName: overview.client_name ?? "",
    issuerName: overview.issuer_name ?? "",
    seriesCode: overview.series_code ?? null,
    issuer: snapshot(row.issuer_snapshot, "issuer"),
    client: snapshot(row.client_snapshot, "client"),
    lines: lines.map((l) => ({
      id: l.id,
      description: l.description,
      quantity: l.quantity,
      unitPriceCents: l.unit_price_cents,
      discountBps: l.discount_bps,
      baseCents: l.base_cents,
      vatBps: l.vat_bps,
      vatRegime: l.vat_regime,
      vatCents: l.vat_cents,
      irpfCents: l.irpf_cents,
      legalNote: l.legal_note,
      billingType: l.billing_type,
      periodStart: l.period_start,
      periodEnd: l.period_end,
    })),
    payments: (paymentsRes.data ?? []).map((p) => ({
      id: p.id,
      amountCents: p.amount_cents,
      paidOn: p.paid_on,
      method: p.method,
      reference: p.reference,
    })),
    emails: emails.map((e) => ({
      id: e.id,
      template: e.template,
      status: e.status,
      to: e.to_emails,
      subject: e.subject,
      sentAt: e.sent_at,
      createdAt: e.created_at,
      error: e.error,
    })),
    rectifies,
    rectifications: (rectificationsRes.data ?? []).map((r) => ({
      id: r.id,
      number: r.number,
      lifecycle: r.lifecycle,
      // Una rectificativa no tiene más estado que su ciclo de vida (la vista la da por emitida).
      status: r.lifecycle,
      issuedOn: r.issued_on,
      totalCents: r.total_cents,
      reason: r.rectification_reason,
    })),
    linkedItemsCount,
    pendingReminders: emails.filter((e) => e.status === "pending_approval").length,
  };
}
