import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { BankView } from "@/components/banking/bank-view";
import { nowInZone } from "@/lib/clock";
import { createClient } from "@/lib/supabase/server";
import { loadBankPage, readBankFilters } from "@/server/banking/queries";
import { getFinanceConfig } from "@/server/finance/queries";
import { getOrgContext, hasRole } from "@/server/session";

export async function generateMetadata(): Promise<Metadata> {
  const [t, tFinance] = await Promise.all([getTranslations("banking"), getTranslations("finance")]);
  return { title: `${t("tab")} · ${tFinance("title")}` };
}

/** Banco: extractos importados, movimientos con su propuesta y conciliación con un clic. */
export default async function BankPage(props: {
  params: Promise<{ org: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ org: slug }, searchParams] = await Promise.all([props.params, props.searchParams]);
  const { org, member } = await getOrgContext(slug);
  const filters = readBankFilters(searchParams);
  const today = nowInZone(org.timezone).date;
  const supabase = await createClient();
  const [data, config] = await Promise.all([loadBankPage(supabase, org.id, filters, today), getFinanceConfig(org.id)]);
  return (
    <BankView
      slug={org.slug}
      data={data}
      config={config}
      filters={{ ...filters, account: data.account?.id ?? "" }}
      canEdit={hasRole(member.role, "partner")}
      today={today}
    />
  );
}
