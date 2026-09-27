import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ExpensesList } from "@/components/finance/expenses-list";
import { nowInZone } from "@/lib/clock";
import { createClient } from "@/lib/supabase/server";
import { expenseMonths, getFinanceConfig, listExpenses } from "@/server/finance/queries";
import { countPendingRebills, listRebillGroups } from "@/server/finance/rebill";
import { getOrgContext, hasRole } from "@/server/session";
import { readExpenseFilters } from "../schema";

/** Filas que se pintan; si hay más, se pide afinar el filtro. */
const LIST_LIMIT = 400;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("finance");
  return { title: `${t("tabs.expenses")} · ${t("title")}` };
}

export default async function ExpensesPage(props: {
  params: Promise<{ org: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ org: slug }, searchParams] = await Promise.all([props.params, props.searchParams]);
  const { org, member } = await getOrgContext(slug);
  const filters = readExpenseFilters(searchParams);
  const supabase = await createClient();
  const canEdit = hasRole(member.role, "partner");

  const [list, months, config, rebills, rebillGroups] = await Promise.all([
    listExpenses(supabase, org.id, filters, LIST_LIMIT),
    expenseMonths(supabase, org.id),
    getFinanceConfig(org.id),
    countPendingRebills(supabase, org.id),
    // Con «Por repercutir», lo pendiente de cada cliente para añadirlo a su factura.
    filters.rebill === "pending" ? listRebillGroups(supabase, org.id) : null,
  ]);

  return (
    <ExpensesList
      slug={org.slug}
      rows={list.rows}
      truncated={list.truncated}
      summary={list.summary}
      filters={filters}
      months={months}
      config={config}
      canEdit={canEdit}
      today={nowInZone(org.timezone).date}
      rebillCount={rebills.count}
      rebillGroups={rebillGroups}
    />
  );
}
