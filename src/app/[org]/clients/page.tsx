import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { readOrgSettings } from "@/app/[org]/settings/schema";
import { ClientsList } from "@/components/clients/clients-list";
import type { ClientListItem } from "@/components/clients/types";
import { createClient } from "@/lib/supabase/server";
import { getCrmConfig } from "@/server/crm/config";
import { getOrgContext, hasRole } from "@/server/session";
import { requestTime, resolveNames } from "./names";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("nav"))("clients") };
}

export default async function ClientsPage({ params }: PageProps<"/[org]/clients">) {
  const { org: slug } = await params;
  const { org, member } = await getOrgContext(slug);
  const supabase = await createClient();

  // Todos, también los archivados: son pocos y así el filtro no va al servidor.
  const [config, overview] = await Promise.all([
    getCrmConfig(org.id),
    supabase
      .from("clients_overview")
      .select(
        "id, display_name, legal_name, tax_id, city, sector, owner_member_id, owner_initials, status, acquisition_source_id, deals_count, last_activity_at, archived_at",
      )
      .eq("org_id", org.id),
  ]);
  if (overview.error) throw overview.error;

  const rows = overview.data.flatMap((row) => (row.id && row.display_name ? [{ ...row, id: row.id, name: row.display_name }] : []));
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
      owner: names.member(row.owner_member_id, row.owner_initials),
      city: row.city,
      sector: row.sector,
      dealsCount: row.deals_count ?? 0,
      lastActivityAt: row.last_activity_at,
      sourceName: names.source(row.acquisition_source_id),
      archived: row.archived_at !== null,
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
      now={requestTime()}
    />
  );
}
