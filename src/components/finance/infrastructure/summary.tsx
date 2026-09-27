"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { useFinanceFormat } from "@/components/finance/format";
import type { InfrastructureReport } from "@/domain/finance/infrastructure";
import type { RenewalSettings } from "@/domain/finance/renewals";
import { cn } from "@/lib/utils";

function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint: ReactNode; tone?: "warning" }) {
  return (
    <div className="min-w-0 rounded-2xl border bg-card px-4 py-3.5">
      <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{label}</p>
      <p className={cn("mt-1 truncate text-2xl font-bold heading-tight", tone === "warning" && "text-warning")}>{value}</p>
      <p className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

/**
 * Las cinco cifras de la infraestructura: lo que cuesta al mes y al año lo que está en marcha, lo
 * gastado de verdad en 12 meses, lo que cuesta cada web alojada y cuántas renovaciones se acercan.
 */
export function InfrastructureSummary({ report, settings }: { report: InfrastructureReport; settings: RenewalSettings }) {
  const t = useTranslations("infrastructure.summary");
  const { money } = useFinanceFormat();
  const { hosting } = report;
  return (
    <section aria-label={t("label")} className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
      <Stat label={t("monthly")} value={money(report.totals.monthlyCents)} hint={t("monthlyHint", { count: report.totals.running })} />
      <Stat label={t("yearly")} value={money(report.totals.yearlyCents)} hint={t("yearlyHint")} />
      <Stat label={t("spent")} value={money(report.spent12m.cents)} hint={t("spentHint", { count: report.spent12m.count })} />
      <Stat
        label={t("perSite")}
        value={hosting.perSiteCents === null ? "—" : t("perSiteValue", { amount: money(hosting.perSiteCents) })}
        hint={t("perSiteHint", { count: hosting.sites })}
      />
      <Stat
        label={t("dueSoon")}
        value={report.dueSoon}
        hint={t("dueSoonHint", { days: settings.warningDays })}
        tone={report.dueSoon > 0 ? "warning" : undefined}
      />
    </section>
  );
}
