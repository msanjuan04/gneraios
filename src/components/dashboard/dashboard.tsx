import Link from "next/link";
import { ForecastCard } from "@/components/billing/forecast-card";
import type { ForecastMonth } from "@/domain/billing/forecast";
import { getFormatter, getTranslations } from "next-intl/server";
import { cn } from "@/lib/utils";
import { civilToDate } from "./format";
import { HealthCard } from "./health-card";
import { HistorySection } from "./history-section";
import { KpiCards } from "./kpi-cards";
import { OverdueCard, RenewalsCard } from "./lists";
import { PipelineStages } from "./pipeline-stages";
import { TopClients } from "./top-clients";
import type { DashboardView } from "./types";

/**
 * El cockpit de dirección: cifras de cabecera, la historia de 24 meses con el puente de MRR,
 * de quién depende la facturación, lo que renueva y lo que no se ha cobrado, el pipeline y la
 * salud del sistema. Todo sale de src/domain/metrics (definiciones versionadas).
 */
export async function Dashboard({ view, forecast }: { view: DashboardView; forecast: ForecastMonth[] }) {
  const t = await getTranslations("dashboard");
  const tShell = await getTranslations("shell");
  const format = await getFormatter();
  const greeting = view.hour < 14 ? "greetingMorning" : view.hour < 21 ? "greetingAfternoon" : "greetingEvening";
  const cron = view.health.cron;

  return (
    <div className="mx-auto max-w-[88rem] space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-4xl font-extrabold heading-tight md:text-5xl">{tShell(greeting, { name: view.firstName })}</h2>
          <p className="mt-2 text-muted-foreground">
            {t("headline", { date: format.dateTime(civilToDate(view.today), { weekday: "long", day: "numeric", month: "long" }) })}
          </p>
        </div>
        <Link
          href={`${view.basePath}/invoices`}
          className="inline-flex items-center gap-2 rounded-full border bg-card/60 px-3 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur transition-colors hover:text-foreground"
        >
          <span
            aria-hidden
            className={cn(
              "size-2 rounded-full",
              cron.state === "ok" ? "bg-success shadow-[0_0_8px_var(--success)]" : "bg-warning shadow-[0_0_8px_var(--warning)]",
            )}
          />
          {cron.state === "ok"
            ? t("cronPillOk", { hours: cron.hoursSinceSuccess ?? 0 })
            : cron.state === "stale"
              ? t("cronPillStale")
              : t("cronPillNever")}
        </Link>
      </header>

      <KpiCards view={view} />

      <HistorySection history={view.history} movements={view.movements} money={view.money} />

      {/* Lo que el cron va a facturar con los contratos firmados (mismo calendario que factura). */}
      <ForecastCard months={forecast} />

      <section aria-label={t("listsLabel")} className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <TopClients
          data={{ lastYear: view.topClients.lastYear, allTime: view.topClients.allTime }}
          thresholdBps={view.topClients.thresholdBps}
          basePath={view.basePath}
          money={view.money}
          className="lg:col-span-2 xl:col-span-1"
        />
        <RenewalsCard view={view} />
        <OverdueCard view={view} />
      </section>

      <section aria-label={t("operationsLabel")} className="grid gap-4 lg:grid-cols-2">
        <PipelineStages view={view} />
        <HealthCard view={view} />
      </section>
    </div>
  );
}
