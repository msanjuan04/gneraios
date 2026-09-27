import "server-only";
import type { ClientImportContext } from "@/domain/dataio/clients-import";
import type { InvoiceImportContext } from "@/domain/dataio/invoices-import";
import { nowInZone } from "@/lib/clock";
import type { Tables } from "@/lib/supabase/database.types";
import { type Db, DbError, fetchAll, orgSettings } from "@/server/billing/context";

/**
 * Lo que la simulación necesita saber de la org. Se lee con la sesión del socio: RLS decide qué
 * ve, y solo ve su org. Una fila por petición de PostgREST como mucho 1.000: se pagina.
 */

export async function loadClientImportContext(db: Db, orgId: string, defaultOwnerId: string | null): Promise<ClientImportContext> {
  const [clients, contacts, sources, members] = await Promise.all([
    fetchAll(
      (from, to) =>
        db
          .from("clients")
          .select(
            "id, display_name, legal_name, tax_id, external_id, archived_at, address_line, postal_code, city, province, country_code, sector, website, notes, payment_terms_days, imported_source_id, owner_member_id",
          )
          .eq("org_id", orgId)
          .order("id")
          .range(from, to),
      "dataio.clients",
    ),
    fetchAll(
      (from, to) =>
        db
          .from("contacts")
          .select("client_id, full_name, email, is_primary, is_billing")
          .eq("org_id", orgId)
          .is("archived_at", null)
          .order("id")
          .range(from, to),
      "dataio.contacts",
    ),
    db.from("acquisition_sources").select("id, name").eq("org_id", orgId).is("archived_at", null),
    db.from("members").select("id, full_name, initials").eq("org_id", orgId).eq("is_active", true),
  ]);
  if (sources.error) throw new DbError(sources.error, "dataio.sources");
  if (members.error) throw new DbError(members.error, "dataio.members");
  return {
    clients: clients.map((c) => ({
      id: c.id,
      displayName: c.display_name,
      legalName: c.legal_name,
      taxId: c.tax_id,
      externalId: c.external_id,
      archived: c.archived_at !== null,
      addressLine: c.address_line,
      postalCode: c.postal_code,
      city: c.city,
      province: c.province,
      countryCode: c.country_code,
      sector: c.sector,
      website: c.website,
      notes: c.notes,
      paymentTermsDays: c.payment_terms_days,
      importedSourceId: c.imported_source_id,
      ownerMemberId: c.owner_member_id,
    })),
    contacts: contacts.map((c) => ({
      clientId: c.client_id,
      fullName: c.full_name,
      email: c.email,
      isPrimary: c.is_primary,
      isBilling: c.is_billing,
    })),
    sources: sources.data,
    members: members.data.map((m) => ({ id: m.id, fullName: m.full_name, initials: m.initials })),
    defaultOwnerId,
  };
}

export type InvoiceContextExtras = {
  /** Nombre visible de cada serie ("F · Marc Sanjuan") para los contadores y los huecos. */
  seriesLabels: Map<string, string>;
};

export async function loadInvoiceImportContext(
  db: Db,
  org: Pick<Tables<"orgs">, "id" | "timezone" | "settings">,
): Promise<InvoiceImportContext & InvoiceContextExtras> {
  const orgId = org.id;
  const [issuers, series, counters, rates, clients, invoices] = await Promise.all([
    db
      .from("issuers")
      .select("id, kind, legal_name, trade_name, tax_id, active_from, active_until, archived_at, is_primary")
      .eq("org_id", orgId),
    db.from("invoice_series").select("id, issuer_id, code, kind, format, reset_yearly, is_default, archived_at").eq("org_id", orgId),
    db.rpc("series_counters", { p_org: orgId }),
    db.from("tax_rates").select("id, kind, rate_bps, regime, legal_note, is_default, archived_at").eq("org_id", orgId),
    fetchAll(
      (from, to) =>
        db
          .from("clients")
          .select("id, display_name, legal_name, tax_id, archived_at, payment_terms_days")
          .eq("org_id", orgId)
          .order("id")
          .range(from, to),
      "dataio.clients",
    ),
    fetchAll(
      (from, to) =>
        db
          .from("invoices")
          .select("id, issuer_id, series_id, client_id, number, fiscal_year, sequence, issued_on, source, external_id, kind, total_cents")
          .eq("org_id", orgId)
          .not("number", "is", null)
          .not("issued_on", "is", null)
          .order("id")
          .range(from, to),
      "dataio.invoices",
    ),
  ]);
  if (issuers.error) throw new DbError(issuers.error, "dataio.issuers");
  if (series.error) throw new DbError(series.error, "dataio.series");
  if (counters.error) throw new DbError(counters.error, "dataio.counters");
  if (rates.error) throw new DbError(rates.error, "dataio.taxRates");

  const issuerName = new Map(issuers.data.map((i) => [i.id, i.trade_name ?? i.legal_name]));
  return {
    today: nowInZone(org.timezone).date,
    orgPaymentTermsDays: orgSettings(org).paymentTermsDays,
    issuers: issuers.data.map((i) => ({
      id: i.id,
      kind: i.kind,
      name: i.trade_name ?? i.legal_name,
      taxId: i.tax_id,
      activeFrom: i.active_from,
      activeUntil: i.active_until,
      archived: i.archived_at !== null,
      isPrimary: i.is_primary,
    })),
    series: series.data.map((s) => ({
      id: s.id,
      issuerId: s.issuer_id,
      code: s.code,
      kind: s.kind,
      format: s.format,
      resetYearly: s.reset_yearly,
      isDefault: s.is_default,
      archived: s.archived_at !== null,
    })),
    counters: (counters.data ?? []).map((c) => ({ seriesId: c.series_id, year: c.year, lastNumber: c.last_number })),
    taxRates: rates.data.map((t) => ({
      id: t.id,
      kind: t.kind,
      rateBps: t.rate_bps,
      regime: t.regime,
      legalNote: t.legal_note,
      isDefault: t.is_default,
      archived: t.archived_at !== null,
    })),
    clients: clients.map((c) => ({
      id: c.id,
      displayName: c.display_name,
      legalName: c.legal_name,
      taxId: c.tax_id,
      archived: c.archived_at !== null,
      paymentTermsDays: c.payment_terms_days,
    })),
    invoices: invoices.flatMap((i) =>
      i.number && i.issued_on
        ? [
            {
              id: i.id,
              issuerId: i.issuer_id,
              seriesId: i.series_id,
              clientId: i.client_id,
              number: i.number,
              fiscalYear: i.fiscal_year,
              sequence: i.sequence,
              issuedOn: i.issued_on,
              source: i.source,
              externalId: i.external_id,
              kind: i.kind,
              totalCents: i.total_cents,
            },
          ]
        : [],
    ),
    seriesLabels: new Map(series.data.map((s) => [s.id, `${s.code} · ${issuerName.get(s.issuer_id) ?? ""}`.trim()])),
  };
}
