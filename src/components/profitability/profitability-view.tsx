"use client";

import { Scale, SlidersHorizontal, Users } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useState, useTransition } from "react";
import { SettingsCard } from "@/components/settings/settings-card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ClientsTable } from "./clients-table";
import { useProfitabilityFormat } from "./format";
import { MarginChart } from "./margin-chart";
import { PeriodSelector } from "./period-selector";
import { ProfitabilitySettingsSheet } from "./settings-sheet";
import { SummaryStrip } from "./summary-strip";
import type { ProfitabilityViewData } from "./types";

/**
 * Finanzas → Rentabilidad: qué clientes y proyectos dejan dinero. Periodo en la URL (se mantiene la
 * página anterior, atenuada, mientras llega la nueva), las seis cifras del periodo, el margen por
 * cliente y la tabla con cada cliente desplegable en sus proyectos.
 */
export function ProfitabilityView({ data }: { data: ProfitabilityViewData }) {
  const t = useTranslations("profitability");
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const navigate = (href: string) => startTransition(() => router.push(href, { scroll: false }));
  const teamHref = `${data.basePath}/settings/team#costs`;

  const toolbar = (
    <div className="flex items-center gap-2">
      <Button asChild variant="ghost" size="sm">
        <Link href={teamHref}>
          <Users data-icon="inline-start" />
          {t("toolbar.teamCosts")}
        </Link>
      </Button>
      {data.canEdit && (
        <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
          <SlidersHorizontal data-icon="inline-start" />
          {t("toolbar.settings")}
        </Button>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      {data.costsConfigured ? (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <PeriodSelector period={data.period} today={data.today} pathname={pathname} navigate={navigate} />
            </div>
            {toolbar}
          </div>
          <div aria-busy={pending || undefined} className={cn("space-y-6 transition-opacity duration-200", pending && "opacity-60")}>
            <SummaryStrip
              totals={data.report.totals}
              costs={data.report.costs}
              collection={data.report.collection}
              clients={data.report.clients.length}
              settings={data.settings}
            />
            <DefaultCostNote data={data} />
            {data.report.clients.length > 0 && <MarginChart clients={data.report.clients} />}
            <SettingsCard title={t("table.title")} description={t("table.description")} bodyClassName="p-0">
              <ClientsTable report={data.report} settings={data.settings} basePath={data.basePath} focusClientId={data.focusClientId} />
            </SettingsCard>
            <Notes />
          </div>
        </>
      ) : (
        <EmptyState canEdit={data.canEdit} teamHref={teamHref} toolbar={toolbar} />
      )}
      {data.canEdit && (
        <ProfitabilitySettingsSheet slug={data.slug} settings={data.settings} open={settingsOpen} onOpenChange={setSettingsOpen} />
      )}
    </div>
  );
}

/** Cuántas horas se han valorado con el coste de la org (personas sin coste propio ese día). */
function DefaultCostNote({ data }: { data: ProfitabilityViewData }) {
  const t = useTranslations("profitability.notes");
  const fmt = useProfitabilityFormat();
  if (data.report.defaultCostMinutes === 0) return null;
  return (
    <p className="rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
      {t("defaultCost", { hours: fmt.hours(data.report.defaultCostMinutes), amount: fmt.money(data.settings.defaultHourlyCostCents) })}
    </p>
  );
}

/** La regla de atribución y de coste, dicha en la propia pantalla. */
function Notes() {
  const t = useTranslations("profitability.notes");
  return (
    <details className="group rounded-2xl border bg-card/60 px-5 py-3 text-sm">
      <summary className="cursor-pointer font-semibold outline-none select-none focus-visible:underline">{t("title")}</summary>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-muted-foreground">
        <li>{t("revenue")}</li>
        <li>{t("allocation")}</li>
        <li>{t("receipts")}</li>
        <li>{t("cost")}</li>
        <li>{t("expenses")}</li>
        <li>{t("hosting")}</li>
        <li>{t("rebill")}</li>
        <li>{t("collection")}</li>
        <li>{t("lifetime")}</li>
      </ul>
    </details>
  );
}

function EmptyState({ canEdit, teamHref, toolbar }: { canEdit: boolean; teamHref: string; toolbar: ReactNode }) {
  const t = useTranslations("profitability.empty");
  return (
    <div className="space-y-4">
      <div className="flex justify-end">{toolbar}</div>
      <div className="rounded-3xl border bg-card/50 px-8 py-14 text-center md:py-16">
        <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-brand-gradient text-white shadow-[0_10px_40px_rgb(46_128_255/0.35)]">
          <Scale className="size-5" />
        </div>
        <h3 className="mt-5 text-2xl font-extrabold heading-tight">{t("title")}</h3>
        <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">{t("body")}</p>
        {canEdit ? (
          <Button asChild className="mt-6">
            <Link href={teamHref}>
              <Users data-icon="inline-start" />
              {t("cta")}
            </Link>
          </Button>
        ) : (
          <p className="mt-6 text-xs text-muted-foreground">{t("readOnly")}</p>
        )}
      </div>
    </div>
  );
}
