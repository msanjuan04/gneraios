import "server-only";
import { cache } from "react";
import { centsToMoneyInput } from "@/app/[org]/contracts/schema";
import {
  lineFormDefaults,
  newLineDefaults,
  planFormDefaults,
  presetPlan,
  type QuoteFormInput,
  readStoredPlan,
} from "@/app/[org]/quotes/schema";
import { quoteValidityDays } from "@/app/[org]/quotes/summary";
import { readOrgSettings } from "@/app/[org]/settings/schema";
import type {
  AppLocale,
  QuoteEditorData,
  QuoteEmailItem,
  QuoteFormOptions,
  QuoteListItem,
} from "@/components/quotes/types";
import type { Tables } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/server/billing/context";

/**
 * Lecturas de presupuestos. Todo pasa por RLS (cualquier miembro lee); las cifras del listado
 * salen de la vista quotes_overview (sumas de las bases guardadas, por tipo y sin mezclar).
 */

type Supabase = Awaited<ReturnType<typeof createClient>>;
type OrgRef = Pick<Tables<"orgs">, "id" | "settings">;

const issuerLabel = (i: { legal_name: string; trade_name: string | null }) => i.trade_name || i.legal_name;

/** Todos los presupuestos de la org, del más reciente al más antiguo. */
export async function listQuotes(supabase: Supabase, orgId: string): Promise<QuoteListItem[]> {
  const rows = await fetchAll(
    (from, to) =>
      supabase
        .from("quotes_overview")
        .select(
          "id, number, title, client_id, client_name, deal_title, state, issued_on, valid_until, created_at, one_off_cents, monthly_cents, yearly_cents, usage_lines_count, lines_count, contract_id",
        )
        .eq("org_id", orgId)
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, to),
    "quotes.list",
  );
  return rows.flatMap((row): QuoteListItem[] =>
    row.id && row.client_id && row.state && row.title
      ? [
          {
            id: row.id,
            number: row.number,
            title: row.title,
            clientId: row.client_id,
            clientName: row.client_name ?? "",
            dealTitle: row.deal_title,
            state: row.state,
            issuedOn: row.issued_on,
            validUntil: row.valid_until,
            createdAt: row.created_at ?? "",
            oneOffCents: row.one_off_cents ?? 0,
            monthlyCents: row.monthly_cents ?? 0,
            yearlyCents: row.yearly_cents ?? 0,
            usageCount: row.usage_lines_count ?? 0,
            linesCount: row.lines_count ?? 0,
            contractId: row.contract_id,
          },
        ]
      : [],
  );
}

/** Clientes, emisores, IVA y deals para el editor, con los valores por defecto de la org. */
export const getQuoteFormOptions = cache(async (org: OrgRef): Promise<QuoteFormOptions> => {
  const supabase = await createClient();
  const [clients, issuers, rates, deals] = await Promise.all([
    supabase
      .from("clients")
      .select("id, display_name, preferred_language")
      .eq("org_id", org.id)
      .is("archived_at", null)
      .order("display_name"),
    supabase
      .from("issuers")
      .select("id, legal_name, trade_name, kind, is_primary, active_from")
      .eq("org_id", org.id)
      .is("archived_at", null)
      .order("is_primary", { ascending: false })
      .order("legal_name"),
    supabase
      .from("tax_rates")
      .select("id, name, rate_bps, regime, legal_note, is_default, archived_at")
      .eq("org_id", org.id)
      .eq("kind", "vat")
      .order("position")
      .order("name"),
    supabase
      .from("deals")
      .select("id, title, client_id")
      .eq("org_id", org.id)
      .is("archived_at", null)
      .order("updated_at", { ascending: false })
      .limit(1000),
  ]);
  for (const r of [clients, issuers, rates, deals]) if (r.error) throw r.error;

  const issuerOptions = (issuers.data ?? []).map((i) => ({
    id: i.id,
    name: issuerLabel(i),
    isPrimary: i.is_primary,
    pendingConstitution: i.kind === "company" && i.active_from === null,
  }));
  const vatRates = (rates.data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    rateBps: r.rate_bps,
    regime: r.regime ?? "general",
    legalNote: r.legal_note,
    isDefault: r.is_default,
    archived: r.archived_at !== null,
  }));
  const active = vatRates.filter((r) => !r.archived);
  return {
    clients: (clients.data ?? []).map((c) => ({ id: c.id, name: c.display_name, language: c.preferred_language })),
    issuers: issuerOptions,
    vatRates,
    deals: (deals.data ?? []).map((d) => ({ id: d.id, title: d.title, clientId: d.client_id })),
    // Por defecto, el emisor principal que ya puede facturar.
    defaultIssuerId:
      (issuerOptions.find((i) => i.isPrimary && !i.pendingConstitution) ?? issuerOptions.find((i) => !i.pendingConstitution) ?? issuerOptions[0])
        ?.id ?? null,
    defaultVatRateId: (active.find((r) => r.isDefault) ?? active[0])?.id ?? null,
    validityDays: quoteValidityDays(org.settings),
    billingDay: readOrgSettings(org.settings).billing_day,
  };
});

/**
 * Presupuesto nuevo. Desde un deal (?deal=): su cliente, su título y sus importes estimados
 * como primeras líneas (lo puntual y la cuota mensual, por separado). Desde un cliente (?client=):
 * ese cliente y su idioma.
 */
export async function getNewQuoteDefaults(
  supabase: Supabase,
  orgId: string,
  options: QuoteFormOptions,
  params: { clientId: string | null; dealId: string | null },
  newId: () => string,
): Promise<QuoteFormInput> {
  let deal: Pick<Tables<"deals">, "id" | "title" | "client_id" | "est_one_off_cents" | "est_mrr_cents"> | null = null;
  if (params.dealId) {
    const { data, error } = await supabase
      .from("deals")
      .select("id, title, client_id, est_one_off_cents, est_mrr_cents")
      .eq("org_id", orgId)
      .eq("id", params.dealId)
      .maybeSingle();
    if (error) throw error;
    deal = data;
  }
  const clientId = deal?.client_id ?? params.clientId ?? "";
  const client = options.clients.find((c) => c.id === clientId) ?? null;
  const language: AppLocale = client?.language ?? "es";

  const lines: QuoteFormInput["lines"] = [];
  if (deal && deal.est_one_off_cents > 0) {
    lines.push({
      ...newLineDefaults("one_off", newId(), options.defaultVatRateId),
      description: deal.title,
      unit_price: centsToMoneyInput(deal.est_one_off_cents),
    });
  }
  if (deal && deal.est_mrr_cents > 0) {
    lines.push({
      ...newLineDefaults("monthly", newId(), options.defaultVatRateId),
      description: deal.title,
      unit_price: centsToMoneyInput(deal.est_mrr_cents),
    });
  }

  return {
    client_id: client?.id ?? "",
    new_client_name: "",
    deal_id: deal && client ? deal.id : "",
    issuer_id: options.defaultIssuerId ?? "",
    title: deal?.title ?? "",
    issued_on: "",
    valid_until: "",
    language,
    notes: "",
    lines,
    plan: lines.some((l) => l.billing_type === "one_off") ? presetPlan("full", language) : [],
  };
}

/** Título de un presupuesto de la org (para el título de la pestaña); null si no existe. */
export async function getQuoteHeading(supabase: Supabase, orgId: string, quoteId: string) {
  const { data, error } = await supabase.from("quotes").select("title, number").eq("org_id", orgId).eq("id", quoteId).maybeSingle();
  if (error) throw error;
  return data;
}

/** Todo lo que necesita el editor de un presupuesto guardado; null si no existe (o la RLS no lo deja ver). */
export async function getQuoteEditorData(
  supabase: Supabase,
  org: OrgRef,
  quoteId: string,
  canAct: boolean,
): Promise<QuoteEditorData | null> {
  const { data: quote, error } = await supabase.from("quotes").select("*").eq("org_id", org.id).eq("id", quoteId).maybeSingle();
  if (error) throw error;
  if (!quote) return null;

  const [overview, lines, contract, emails, options] = await Promise.all([
    supabase.from("quotes_overview").select("state").eq("id", quote.id).single(),
    supabase.from("quote_lines").select("*").eq("quote_id", quote.id).order("position").order("created_at"),
    quote.contract_id ? supabase.from("contracts").select("id, title").eq("id", quote.contract_id).maybeSingle() : null,
    supabase
      .from("outbound_emails")
      .select("id, status, to_emails, subject, sent_at, created_at")
      .eq("quote_id", quote.id)
      .order("created_at", { ascending: false })
      .limit(20),
    getQuoteFormOptions(org),
  ]);
  for (const r of [overview, lines, contract, emails]) if (r?.error) throw r.error;

  // Lo que ya usa el presupuesto aparece aunque hoy esté archivado.
  const extra = await Promise.all([
    options.clients.some((c) => c.id === quote.client_id)
      ? null
      : supabase.from("clients").select("id, display_name, preferred_language").eq("id", quote.client_id).maybeSingle(),
    options.issuers.some((i) => i.id === quote.issuer_id)
      ? null
      : supabase.from("issuers").select("id, legal_name, trade_name").eq("id", quote.issuer_id).maybeSingle(),
    !quote.deal_id || options.deals.some((d) => d.id === quote.deal_id)
      ? null
      : supabase.from("deals").select("id, title, client_id").eq("id", quote.deal_id).maybeSingle(),
  ]);
  const [extraClient, extraIssuer, extraDeal] = extra.map((r) => r?.data ?? null) as [
    { id: string; display_name: string; preferred_language: AppLocale } | null,
    { id: string; legal_name: string; trade_name: string | null } | null,
    { id: string; title: string; client_id: string } | null,
  ];
  const withExtras: QuoteFormOptions = {
    ...options,
    clients: extraClient
      ? [...options.clients, { id: extraClient.id, name: extraClient.display_name, language: extraClient.preferred_language }]
      : options.clients,
    issuers: extraIssuer
      ? [...options.issuers, { id: extraIssuer.id, name: issuerLabel(extraIssuer), isPrimary: false, pendingConstitution: false }]
      : options.issuers,
    deals: extraDeal ? [...options.deals, { id: extraDeal.id, title: extraDeal.title, clientId: extraDeal.client_id }] : options.deals,
  };

  const emailItems: QuoteEmailItem[] = (emails.data ?? []).map((e) => ({
    id: e.id,
    status: e.status,
    to: e.to_emails,
    subject: e.subject,
    sentAt: e.sent_at,
    createdAt: e.created_at,
  }));

  return {
    mode: "edit",
    quoteId: quote.id,
    updatedAt: quote.updated_at,
    number: quote.number,
    status: quote.status,
    state: overview.data?.state ?? quote.status,
    editable: canAct && (quote.status === "draft" || quote.status === "sent"),
    canAct,
    defaults: {
      client_id: quote.client_id,
      new_client_name: "",
      deal_id: quote.deal_id ?? "",
      issuer_id: quote.issuer_id,
      title: quote.title,
      issued_on: quote.issued_on ?? "",
      valid_until: quote.valid_until ?? "",
      language: quote.language,
      notes: quote.notes ?? "",
      lines: (lines.data ?? []).map((l) =>
        lineFormDefaults({
          id: l.id,
          billingType: l.billing_type,
          description: l.description,
          quantity: l.quantity,
          unitPriceCents: l.unit_price_cents,
          discountBps: l.discount_bps,
          taxRateId: l.tax_rate_id,
          irpfApplies: l.irpf_applies,
          startsOn: l.starts_on,
          endsOn: l.ends_on,
          billingDay: l.billing_day,
        }),
      ),
      plan: planFormDefaults(readStoredPlan(quote.payment_plan)),
    },
    issuedOn: quote.issued_on,
    validUntil: quote.valid_until,
    acceptedAt: quote.accepted_at,
    rejectedAt: quote.rejected_at,
    rejectionReason: quote.rejection_reason,
    contract: contract?.data ? { id: contract.data.id, title: contract.data.title } : null,
    emails: emailItems,
    options: withExtras,
  };
}
