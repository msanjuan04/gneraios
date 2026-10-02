import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CompanyView } from "@/components/finance/company-view";
import { createClient } from "@/lib/supabase/server";
import { listOrgDocuments } from "@/server/company/documents";
import { loadCompanyProfile } from "@/server/company/profile";
import { getOrgContext, hasRole } from "@/server/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("finance");
  return { title: `${t("tabs.company")} · ${t("title")}` };
}

/** Sociedad: los datos de la SL (su emisor) y el expediente legal con cada documento y su estado. */
export default async function CompanyPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const { org, member } = await getOrgContext(slug);
  if (!hasRole(member.role, "partner")) return <CompanyView slug={org.slug} profile={null} documents={[]} members={[]} canEdit={false} canArchive={false} readOnly />;
  const supabase = await createClient();
  const [profile, documents, members] = await Promise.all([
    loadCompanyProfile(supabase, org.id),
    listOrgDocuments(supabase, org.id),
    supabase.from("members").select("id, full_name").eq("org_id", org.id).eq("is_active", true).order("full_name"),
  ]);
  if (members.error) throw members.error;
  return (
    <CompanyView
      slug={org.slug}
      profile={profile}
      documents={documents}
      members={(members.data ?? []).map((m) => ({ id: m.id, fullName: m.full_name }))}
      canEdit={hasRole(member.role, "partner")}
      canArchive={hasRole(member.role, "owner")}
    />
  );
}
