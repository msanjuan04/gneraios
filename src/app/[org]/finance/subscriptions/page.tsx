import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SubscriptionsList } from "@/components/finance/subscriptions-list";
import { nowInZone } from "@/lib/clock";
import { createClient } from "@/lib/supabase/server";
import { getFinanceConfig, listSubscriptions } from "@/server/finance/queries";
import { getOrgContext, hasRole } from "@/server/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("finance");
  return { title: `${t("tabs.subscriptions")} · ${t("title")}` };
}

export default async function SubscriptionsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const { org, member } = await getOrgContext(slug);
  const supabase = await createClient();
  const today = nowInZone(org.timezone).date;
  const config = await getFinanceConfig(org.id);
  const rows = await listSubscriptions(supabase, org.id, today, config);
  return (
    <SubscriptionsList
      slug={org.slug}
      rows={rows}
      config={config}
      canEdit={hasRole(member.role, "partner")}
      today={today}
    />
  );
}
