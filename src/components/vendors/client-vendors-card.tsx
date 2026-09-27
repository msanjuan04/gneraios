"use client";

import { ArrowRight, Truck } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { SettingsCard } from "@/components/settings/settings-card";
import { cn } from "@/lib/utils";
import { useVendorFormat } from "./format";
import type { ClientVendorsData } from "./types";
import { VendorKindIcon } from "./vendor-kind";

/**
 * «Proveedores y freelancers» en la ficha del cliente: quién ha trabajado para él (los proveedores
 * con gastos asignados a este cliente) y lo que ha costado este año y en total, con el enlace a la
 * ficha de cada proveedor y a sus gastos en Finanzas.
 *
 * Uso (servidor): `const vendors = await getClientVendorCosts(org, client.id)`
 * (src/server/vendors/queries.ts) y `<ClientVendorsCard basePath={`/${org.slug}`} clientId={client.id} data={vendors} />`.
 */
export function ClientVendorsCard({
  basePath,
  clientId,
  data,
  actions,
  className,
}: {
  basePath: string;
  clientId: string;
  data: ClientVendorsData;
  /** En la cabecera (y en el aviso vacío): p. ej. «Registrar gasto» para los socios. */
  actions?: ReactNode;
  className?: string;
}) {
  const t = useTranslations("vendors.client");
  const fmt = useVendorFormat();
  const expensesHref = `${basePath}/finance/expenses?client=${clientId}`;

  if (data.vendors.length === 0) {
    return (
      <section className={cn("flex items-center gap-3 rounded-2xl border border-dashed px-4 py-3 text-sm text-muted-foreground", className)}>
        <Truck aria-hidden className="size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{t("title")}</p>
          <p className="text-xs">{t("empty")}</p>
        </div>
        {actions}
      </section>
    );
  }

  return (
    <SettingsCard
      title={t("title")}
      description={t("description", { count: data.vendors.length, amount: fmt.money(data.totals.costCents) })}
      actions={actions}
      className={className}
      bodyClassName="p-0"
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-4 border-b px-5 py-1.5 text-[11px] font-semibold text-muted-foreground">
        <span className="sr-only">{t("vendor")}</span>
        <span className="col-start-2 text-right">{t("year", { year: String(data.year) })}</span>
        <span className="text-right">{t("total")}</span>
      </div>
      <ul className="divide-y">
        {data.vendors.map((vendor) => (
          <li key={vendor.vendorId}>
            <Link
              href={`${basePath}/finance/vendors/${vendor.vendorId}`}
              className="group grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-4 px-5 py-2.5 transition-colors outline-none hover:bg-muted/40 focus-visible:bg-muted/40"
            >
              <span className="flex min-w-0 items-center gap-2">
                <VendorKindIcon kind={vendor.kind} />
                <span className="min-w-0">
                  <span className={cn("block truncate font-semibold group-hover:text-primary", vendor.archived && "text-muted-foreground")}>{vendor.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {t("expenses", { count: vendor.expensesCount })}
                    {vendor.lastExpenseOn && ` · ${t("last", { date: fmt.dateShort(vendor.lastExpenseOn) })}`}
                  </span>
                </span>
              </span>
              <span className={cn("text-right font-semibold tabular", vendor.yearCostCents === 0 && "font-normal text-muted-foreground/60")}>
                {vendor.yearCostCents === 0 ? "—" : fmt.money(vendor.yearCostCents)}
              </span>
              <span className="text-right text-muted-foreground tabular">{fmt.money(vendor.costCents)}</span>
            </Link>
          </li>
        ))}
      </ul>
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t px-5 py-2.5">
        <Link href={expensesHref} className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
          {t("allExpenses")}
          <ArrowRight aria-hidden className="size-3.5" />
        </Link>
        {data.totals.yearCostCents !== 0 && (
          <span className="text-xs text-muted-foreground tabular">{t("yearTotal", { amount: fmt.money(data.totals.yearCostCents), year: String(data.year) })}</span>
        )}
      </footer>
    </SettingsCard>
  );
}
