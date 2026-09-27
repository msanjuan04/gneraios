import "server-only";
import type { CreditorSummary } from "@/components/collections/types";
import { checkCreditor, type CreditorConfig, proposeSpanishCreditorId } from "@/domain/collections";
import type { Tables } from "@/lib/supabase/database.types";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

type IssuerRow = Pick<Tables<"issuers">, "id" | "legal_name" | "trade_name" | "tax_id" | "iban">;
type CreditorRow = Tables<"sepa_creditors">;

const ISSUER_COLUMNS = "id, legal_name, trade_name, tax_id, iban";

/**
 * Datos de acreedor de un emisor ya resueltos: lo guardado por el owner y, donde falta, lo del
 * emisor (razón social, IBAN) o la propuesta de ICS que sale de su NIF.
 */
export function toCreditorSummary(issuer: IssuerRow, row: CreditorRow | null): CreditorSummary {
  const config: CreditorConfig = {
    creditorId: row?.creditor_identifier ?? null,
    creditorIdConfirmed: Boolean(row?.creditor_identifier_confirmed_at),
    issuerTaxId: issuer.tax_id,
    name: row?.name ?? issuer.legal_name,
    iban: row?.iban ?? issuer.iban,
    bic: row?.bic ?? null,
  };
  const check = checkCreditor(config);
  return {
    issuerId: issuer.id,
    issuerName: issuer.trade_name ?? issuer.legal_name,
    issuerLegalName: issuer.legal_name,
    issuerTaxId: issuer.tax_id,
    issuerIban: issuer.iban,
    saved: row !== null,
    stored: {
      creditorId: row?.creditor_identifier ?? null,
      confirmedAt: row?.creditor_identifier_confirmed_at ?? null,
      name: row?.name ?? null,
      iban: row?.iban ?? null,
      bic: row?.bic ?? null,
    },
    proposedCreditorId: issuer.tax_id ? proposeSpanishCreditorId(issuer.tax_id) : null,
    config,
    creditorId: check.creditorId,
    source: check.source,
    issues: check.issues,
  };
}

/** Los emisores activos de la org (el principal primero) con sus datos de acreedor. */
export async function loadCreditors(supabase: Supabase, orgId: string): Promise<CreditorSummary[]> {
  const [issuers, creditors] = await Promise.all([
    supabase
      .from("issuers")
      .select(ISSUER_COLUMNS)
      .eq("org_id", orgId)
      .is("archived_at", null)
      .order("is_primary", { ascending: false })
      .order("legal_name"),
    supabase.from("sepa_creditors").select("*").eq("org_id", orgId),
  ]);
  if (issuers.error) throw issuers.error;
  if (creditors.error) throw creditors.error;
  const byIssuer = new Map(creditors.data.map((c) => [c.issuer_id, c]));
  return issuers.data.map((i) => toCreditorSummary(i, byIssuer.get(i.id) ?? null));
}

/** Los datos de acreedor de un emisor, o null si el emisor no es de la org. */
export async function loadCreditor(supabase: Supabase, orgId: string, issuerId: string): Promise<CreditorSummary | null> {
  const [issuer, creditor] = await Promise.all([
    supabase.from("issuers").select(ISSUER_COLUMNS).eq("org_id", orgId).eq("id", issuerId).maybeSingle(),
    supabase.from("sepa_creditors").select("*").eq("org_id", orgId).eq("issuer_id", issuerId).maybeSingle(),
  ]);
  if (issuer.error) throw issuer.error;
  if (creditor.error) throw creditor.error;
  return issuer.data ? toCreditorSummary(issuer.data, creditor.data) : null;
}
