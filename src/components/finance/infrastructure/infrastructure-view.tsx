"use client";

import { BellRing, Plus, Server } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";
import { useFinanceFormat } from "@/components/finance/format";
import { Button } from "@/components/ui/button";
import type { RenewalSettings } from "@/domain/finance/renewals";
import { BreakdownChart } from "./breakdown-chart";
import { HostingCard } from "./hosting-card";
import { RenewalsTable } from "./renewals-table";
import { RenewalSettingsSheet } from "./settings-sheet";
import { InfrastructureSummary } from "./summary";
import type { InfrastructureViewData } from "./types";

/**
 * Finanzas → Infraestructura: lo que cuestan de verdad los servidores, las bases de datos, los
 * dominios y el software de las webs. Las cinco cifras, el reparto por proveedor y por categoría,
 * las renovaciones que se acercan y lo que cuesta cada web alojada (y a cada cliente).
 */
export function InfrastructureView({ data }: { data: InfrastructureViewData }) {
  const t = useTranslations("infrastructure");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const subscriptionsHref = `${data.basePath}/finance/subscriptions`;
  const { report } = data;

  const toolbar = (
    <div className="flex items-center gap-2">
      {data.canConfigure && (
        <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
          <BellRing data-icon="inline-start" />
          {t("toolbar.settings")}
        </Button>
      )}
      <Button asChild size="sm">
        <Link href={`${subscriptionsHref}?new=1`}>
          <Plus data-icon="inline-start" />
          {t("toolbar.add")}
        </Link>
      </Button>
    </div>
  );

  return (
    <div className="space-y-6">
      {report.empty ? (
        <EmptyState toolbar={toolbar} addHref={`${subscriptionsHref}?new=1`} />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-2xl text-sm text-muted-foreground">{t("intro")}</p>
            {toolbar}
          </div>
          <InfrastructureSummary report={report} settings={data.settings} />
          <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
            <BreakdownChart
              title={t("chart.byVendor")}
              description={t("chart.description")}
              rows={report.byVendor}
              noneLabel={t("chart.noVendor")}
            />
            <BreakdownChart
              title={t("chart.byCategory")}
              description={t("chart.description")}
              rows={report.byCategory}
              noneLabel={t("chart.noCategory")}
            />
          </div>
          {/* min-w-0: la tabla se desplaza dentro de su tarjeta en lugar de ensanchar la rejilla. */}
          <div className="grid items-start gap-4 xl:grid-cols-3">
            <RenewalsTable
              className="min-w-0 xl:col-span-2"
              rows={report.subscriptions}
              settings={data.settings}
              subscriptionsHref={subscriptionsHref}
            />
            <HostingCard className="min-w-0" hosting={report.hosting} basePath={data.basePath} />
          </div>
          <Notes settings={data.settings} />
        </>
      )}
      {data.canConfigure && <RenewalSettingsSheet slug={data.slug} settings={data.settings} open={settingsOpen} onOpenChange={setSettingsOpen} />}
    </div>
  );
}

/** Qué entra y cómo se calcula cada cifra, dicho en la propia pantalla. */
function Notes({ settings }: { settings: RenewalSettings }) {
  const t = useTranslations("infrastructure.notes");
  const { money } = useFinanceFormat();
  return (
    <details className="group rounded-2xl border bg-card/60 px-5 py-3 text-sm">
      <summary className="cursor-pointer font-semibold outline-none select-none focus-visible:underline">{t("title")}</summary>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-muted-foreground">
        <li>{t("scope")}</li>
        <li>{t("monthly")}</li>
        <li>{t("spent")}</li>
        <li>{t("hosting")}</li>
        <li>{t("renewals", { days: settings.warningDays, amount: money(settings.monthlyMinCents) })}</li>
      </ul>
    </details>
  );
}

function EmptyState({ toolbar, addHref }: { toolbar: ReactNode; addHref: string }) {
  const t = useTranslations("infrastructure.empty");
  return (
    <div className="space-y-4">
      <div className="flex justify-end">{toolbar}</div>
      <div className="rounded-3xl border bg-card/50 px-8 py-14 text-center md:py-16">
        <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-brand-gradient text-white shadow-[0_10px_40px_rgb(46_128_255/0.35)]">
          <Server className="size-5" />
        </div>
        <h3 className="mt-5 text-2xl font-extrabold heading-tight">{t("title")}</h3>
        <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">{t("body")}</p>
        <Button asChild className="mt-6">
          <Link href={addHref}>
            <Plus data-icon="inline-start" />
            {t("cta")}
          </Link>
        </Button>
        <p className="mx-auto mt-4 max-w-md text-xs text-muted-foreground">{t("hint")}</p>
      </div>
    </div>
  );
}
