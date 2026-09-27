import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CashManager } from "@/components/finance/cash-manager";
import { nowInZone } from "@/lib/clock";
import { createClient } from "@/lib/supabase/server";
import { getFinanceConfig, listCashAccounts } from "@/server/finance/queries";
import { getOrgContext, hasRole } from "@/server/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("finance");
  return { title: `${t("tabs.cash")} · ${t("title")}` };
}

export default async function CashPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const { org, member } = await getOrgContext(slug);
  const supabase = await createClient();
  const [accounts, config] = await Promise.all([listCashAccounts(supabase, org.id), getFinanceConfig(org.id)]);
  return (
    <CashManager
      slug={org.slug}
      accounts={accounts}
      issuers={config.issuers}
      canEdit={hasRole(member.role, "partner")}
      today={nowInZone(org.timezone).date}
    />
  );
}
