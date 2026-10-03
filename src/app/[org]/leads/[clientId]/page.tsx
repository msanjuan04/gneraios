import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { LeadDetailView } from "@/components/crm/lead-detail";
import { isClient } from "@/domain/crm";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/server/action-utils";
import { loadLead } from "@/server/crm/lead";
import { getOrgContext, hasRole } from "@/server/session";

type Props = { params: Promise<{ org: string; clientId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { org: slug, clientId } = await params;
  const t = await getTranslations("nav");
  if (!idSchema.safeParse(clientId).success) return { title: t("leads") };
  const { org } = await getOrgContext(slug);
  const supabase = await createClient();
  const { data } = await supabase.from("clients").select("display_name").eq("org_id", org.id).eq("id", clientId).maybeSingle();
  return { title: data ? `${data.display_name} · ${t("leads")}` : t("leads") };
}

/**
 * Ficha de un lead: la conversación, con quién se habla y lo que se le ha propuesto. En cuanto deja
 * de ser lead (firma un contrato o alguien lo marca como cliente), esta ruta lleva a su ficha completa.
 */
export default async function LeadPage({ params }: Props) {
  const { org: slug, clientId } = await params;
  if (!idSchema.safeParse(clientId).success) notFound();
  const { org, member } = await getOrgContext(slug);
  const supabase = await createClient();
  const { data: row } = await supabase
    .from("clients_overview")
    .select("status, manual_status")
    .eq("org_id", org.id)
    .eq("id", clientId)
    .maybeSingle();
  if (!row) notFound();
  if (isClient({ status: row.status ?? null, manualStatus: row.manual_status ?? null })) redirect(`/${org.slug}/clients/${clientId}`);

  const lead = await loadLead(org.id, clientId);
  if (!lead) notFound();
  return <LeadDetailView lead={lead} basePath={`/${org.slug}`} canEdit={hasRole(member.role, "partner")} />;
}
