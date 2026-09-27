import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CategoriesEditor, type CategoryRow } from "@/components/finance/categories-editor";
import { ReadOnlyNotice } from "@/components/settings/settings-card";
import { VendorsSettingsLink } from "@/components/vendors/settings-link";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/server/billing/context";
import { getFinanceConfig } from "@/server/finance/queries";
import { getOrgContext, hasRole } from "@/server/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: `${t("tabs.expenses")} · ${t("title")}` };
}

/**
 * Ajustes → Gastos: las categorías de gasto (las edita un owner). Los proveedores y freelancers
 * tienen su propio apartado en Finanzas → Proveedores; aquí solo se enlaza.
 */
export default async function ExpenseSettingsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const { org, member } = await getOrgContext(slug);
  const canEdit = hasRole(member.role, "owner");
  const tCommon = await getTranslations("common");
  const supabase = await createClient();
  const [config, usage] = await Promise.all([
    getFinanceConfig(org.id),
    fetchAll(
      (a, b) => supabase.from("expenses_by_month").select("category_id, expenses_count").eq("org_id", org.id).order("month").order("category_id").range(a, b),
      "settings.expenses.usage",
    ),
  ]);
  const counts = new Map<string, number>();
  for (const row of usage) if (row.category_id) counts.set(row.category_id, (counts.get(row.category_id) ?? 0) + (row.expenses_count ?? 0));
  const categories: CategoryRow[] = config.categories.map((c) => ({ ...c, expenses: counts.get(c.id) ?? 0 }));

  return (
    <div>
      {!canEdit && <ReadOnlyNotice className="mb-4">{tCommon("ownerOnly")}</ReadOnlyNotice>}
      <CategoriesEditor slug={org.slug} categories={categories} canEdit={canEdit} />
      <VendorsSettingsLink href={`/${org.slug}/finance/vendors`} count={config.vendors.filter((v) => !v.archived).length} className="mt-6" />
    </div>
  );
}
