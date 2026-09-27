import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PartnersView } from "@/components/finance/partners-view";
import { nowInZone } from "@/lib/clock";
import { createClient } from "@/lib/supabase/server";
import { loadPartners } from "@/server/finance/queries";
import { getOrgContext, hasRole } from "@/server/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("finance");
  return { title: `${t("tabs.partners")} · ${t("title")}` };
}

/** Socios: participaciones (las cambia un owner) y su retribución por mes. */
export default async function PartnersPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const { org, member } = await getOrgContext(slug);
  const supabase = await createClient();
  const today = nowInZone(org.timezone).date;
  const data = await loadPartners(supabase, org.id, today);
  return <PartnersView slug={org.slug} data={data} canEdit={hasRole(member.role, "owner")} today={today} />;
}
