// Sin `import "server-only"`: lo usa también el test de guardado. Solo se importa desde el servidor.
import type { ImportSetup } from "@/domain/invoice-import/match";
import { nowInZone } from "@/lib/clock";
import type { Tables } from "@/lib/supabase/database.types";
import { type Db, DbError, fetchAll, orgSettings } from "@/server/billing/context";

type Org = Pick<Tables<"orgs">, "id" | "timezone" | "settings">;

/**
 * Lo que el panel de importar necesita de la org: emisores, series de facturas ordinarias, tipos
 * de IVA e IRPF, clientes y mandatos SEPA activos. Se lee con la sesión del socio (RLS). Con
 * `clientIds`, solo esos clientes (al guardar no hace falta la lista entera).
 */
export async function loadImportSetup(db: Db, org: Org, opts: { clientIds?: readonly string[] } = {}): Promise<ImportSetup> {
  const orgId = org.id;
  const clientsQuery = (from: number, to: number) => {
    let query = db
      .from("clients")
      .select("id, display_name, legal_name, tax_id, payment_terms_days")
      .eq("org_id", orgId)
      .is("archived_at", null)
      .order("display_name")
      .order("id")
      .range(from, to);
    if (opts.clientIds) query = query.in("id", [...opts.clientIds]);
    return query;
  };
  const [issuers, series, rates, clients, mandates] = await Promise.all([
    db
      .from("issuers")
      .select("id, kind, legal_name, trade_name, tax_id, active_from, active_until, archived_at, is_primary, default_irpf_bps")
      .eq("org_id", orgId)
      .order("is_primary", { ascending: false })
      .order("legal_name"),
    db
      .from("invoice_series")
      .select("id, issuer_id, code, name, format, reset_yearly, is_default, archived_at")
      .eq("org_id", orgId)
      .eq("kind", "ordinary")
      .order("code"),
    db
      .from("tax_rates")
      .select("id, kind, name, rate_bps, regime, legal_note, is_default, position")
      .eq("org_id", orgId)
      .is("archived_at", null)
      .order("kind")
      .order("position")
      .order("rate_bps", { ascending: false }),
    opts.clientIds && opts.clientIds.length === 0 ? Promise.resolve([]) : fetchAll(clientsQuery, "invoiceImport.clients"),
    db.from("client_mandates").select("client_id, issuer_id").eq("org_id", orgId).is("revoked_at", null),
  ]);
  if (issuers.error) throw new DbError(issuers.error, "invoiceImport.issuers");
  if (series.error) throw new DbError(series.error, "invoiceImport.series");
  if (rates.error) throw new DbError(rates.error, "invoiceImport.taxRates");
  if (mandates.error) throw new DbError(mandates.error, "invoiceImport.mandates");

  const taxRate = (r: (typeof rates.data)[number]) => ({
    id: r.id,
    name: r.name,
    rateBps: r.rate_bps,
    regime: r.regime,
    legalNote: r.legal_note,
    isDefault: r.is_default,
  });
  return {
    today: nowInZone(org.timezone).date,
    orgPaymentTermsDays: orgSettings(org).paymentTermsDays,
    issuers: issuers.data.map((i) => ({
      id: i.id,
      name: i.trade_name ?? i.legal_name,
      legalName: i.legal_name,
      taxId: i.tax_id,
      kind: i.kind,
      activeFrom: i.active_from,
      activeUntil: i.active_until,
      archived: i.archived_at !== null,
      isPrimary: i.is_primary,
      defaultIrpfBps: i.default_irpf_bps,
    })),
    series: series.data.map((s) => ({
      id: s.id,
      issuerId: s.issuer_id,
      code: s.code,
      name: s.name,
      format: s.format,
      resetYearly: s.reset_yearly,
      isDefault: s.is_default,
      archived: s.archived_at !== null,
    })),
    vatRates: rates.data.filter((r) => r.kind === "vat").map(taxRate),
    irpfRates: rates.data.filter((r) => r.kind === "irpf").map(taxRate),
    clients: clients.map((c) => ({
      id: c.id,
      name: c.display_name,
      legalName: c.legal_name,
      taxId: c.tax_id,
      paymentTermsDays: c.payment_terms_days,
    })),
    mandates: mandates.data.map((m) => ({ clientId: m.client_id, issuerId: m.issuer_id })),
  };
}

/** Los emisores de la org (para saber quién emitió cada PDF y buscar si ya está importada). */
export async function loadIssuers(db: Db, orgId: string): Promise<ImportSetup["issuers"]> {
  const { data, error } = await db
    .from("issuers")
    .select("id, kind, legal_name, trade_name, tax_id, active_from, active_until, archived_at, is_primary, default_irpf_bps")
    .eq("org_id", orgId);
  if (error) throw new DbError(error, "invoiceImport.issuers");
  return data.map((i) => ({
    id: i.id,
    name: i.trade_name ?? i.legal_name,
    legalName: i.legal_name,
    taxId: i.tax_id,
    kind: i.kind,
    activeFrom: i.active_from,
    activeUntil: i.active_until,
    archived: i.archived_at !== null,
    isPrimary: i.is_primary,
    defaultIrpfBps: i.default_irpf_bps,
  }));
}
