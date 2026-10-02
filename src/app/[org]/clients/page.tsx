import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { readOrgSettings } from "@/app/[org]/settings/schema";
import { ClientsList } from "@/components/clients/clients-list";
import type { ClientListItem } from "@/components/clients/types";
import { createClient } from "@/lib/supabase/server";
import { loadClientsHealth } from "@/server/clients/health";
import { getCrmConfig } from "@/server/crm/config";
import { fetchAll } from "@/server/billing/context";
import { getOrgContext, hasRole } from "@/server/session";
import { resolveNames } from "./names";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("nav"))("clients") };
}

export default async function ClientsPage({ params }: PageProps<"/[org]/clients">) {
  const { org: slug } = await params;
  const { org, member } = await getOrgContext(slug);
  const supabase = await createClient();

  // Todos, también los archivados: son pocos y así el filtro no va al servidor.
  const [config, overview, health, invoiceRows, receiptRows] = await Promise.all([
    getCrmConfig(org.id),
    supabase
      .from("clients_overview")
      .select(
        "id, display_name, legal_name, tax_id, city, sector, owner_member_id, owner_initials, status, manual_status, acquisition_source_id, deals_count, last_activity_at, archived_at, billed_net_cents",
      )
      .eq("org_id", org.id),
    loadClientsHealth(supabase, org),
    fetchAll(
      (from, to) => supabase.from("invoices_overview").select("client_id, total_cents, rectified_cents, paid_cents, outstanding_cents").eq("org_id", org.id).eq("lifecycle", "issued").eq("kind", "ordinary").order("id").range(from, to),
      "clients.list.invoiceBalances",
    ),
    // Cobros sin factura (lo pagado antes de facturar desde aquí): cuentan como cobrado del cliente.
    fetchAll(
      (from, to) => supabase.from("client_receipts").select("client_id, amount_cents").eq("org_id", org.id).order("id").range(from, to),
      "clients.list.receipts",
    ),
  ]);
  if (overview.error) throw overview.error;

  const rows = overview.data.flatMap((row) => (row.id && row.display_name ? [{ ...row, id: row.id, name: row.display_name }] : []));
  const balances = new Map<string, { billed: number; collected: number; outstanding: number }>();
  const balanceOf = (clientId: string) => {
    const balance = balances.get(clientId) ?? { billed: 0, collected: 0, outstanding: 0 };
    balances.set(clientId, balance);
    return balance;
  };
  for (const invoice of invoiceRows) {
    if (!invoice.client_id) continue;
    const balance = balanceOf(invoice.client_id);
    balance.billed += (invoice.total_cents ?? 0) + (invoice.rectified_cents ?? 0);
    balance.collected += invoice.paid_cents ?? 0;
    balance.outstanding += invoice.outstanding_cents ?? 0;
  }
  for (const receipt of receiptRows) balanceOf(receipt.client_id).collected += receipt.amount_cents;
  const names = await resolveNames(supabase, org.id, config, {
    memberIds: rows.map((r) => r.owner_member_id),
    sourceIds: rows.map((r) => r.acquisition_source_id),
  });

  const clients: ClientListItem[] = rows
    .map((row) => ({
      id: row.id,
      displayName: row.name,
      legalName: row.legal_name,
      taxId: row.tax_id,
      status: row.status ?? "lead",
      manualStatus: row.manual_status ?? null,
      owner: names.member(row.owner_member_id, row.owner_initials),
      city: row.city,
      sector: row.sector,
      dealsCount: row.deals_count ?? 0,
      billedCents: balances.get(row.id)?.billed ?? 0,
      collectedCents: balances.get(row.id)?.collected ?? 0,
      outstandingCents: balances.get(row.id)?.outstanding ?? 0,
      lastActivityAt: row.last_activity_at,
      sourceName: names.source(row.acquisition_source_id),
      archived: row.archived_at !== null,
      health: health.get(row.id) ?? { level: "good" as const, signals: [] },
    }))
    // Por nombre; si se enseñan los archivados, van al final.
    .sort(
      (a, b) =>
        Number(a.archived) - Number(b.archived) || a.displayName.localeCompare(b.displayName, "es", { sensitivity: "base" }),
    );

  return (
    <ClientsList
      basePath={`/${org.slug}`}
      slug={org.slug}
      clients={clients}
      members={config.members}
      canEdit={hasRole(member.role, "partner")}
      currentMemberId={member.id}
      defaultPaymentTerms={readOrgSettings(org.settings).payment_terms_days}
      currency={org.currency}
    />
  );
}
