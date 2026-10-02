import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { FinanceTabs } from "@/components/finance/finance-tabs";
import { PageHeader } from "@/components/page-header";

/**
 * Finanzas: la foto (resumen), la rentabilidad, los gastos, las suscripciones, los proveedores y
 * freelancers, la infraestructura, la caja, el banco y los socios.
 */
export default async function FinanceLayout({ children, params }: { children: ReactNode; params: Promise<{ org: string }> }) {
  const { org } = await params;
  const t = await getTranslations("finance");
  const base = `/${org}/finance`;
  return (
    <div className="mx-auto max-w-[88rem]">
      <PageHeader title={t("title")} description={t("description")} />
      <FinanceTabs
        label={t("tabs.label")}
        tabs={[
          { href: base, label: t("tabs.overview"), exact: true },
          { href: `${base}/profitability`, label: (await getTranslations("profitability"))("tab") },
          { href: `${base}/expenses`, label: t("tabs.expenses") },
          { href: `${base}/subscriptions`, label: t("tabs.subscriptions") },
          { href: `${base}/vendors`, label: (await getTranslations("vendors"))("tab") },
          { href: `${base}/infrastructure`, label: (await getTranslations("infrastructure"))("tab") },
          { href: `${base}/cash`, label: t("tabs.cash") },
          { href: `${base}/bank`, label: (await getTranslations("banking"))("tab") },
          { href: `${base}/partners`, label: t("tabs.partners") },
          { href: `${base}/company`, label: t("tabs.company") },
        ]}
      />
      {children}
    </div>
  );
}
