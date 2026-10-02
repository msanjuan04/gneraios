import Link from "next/link";
import { ArrowUpRight, CalendarDays, CircleAlert, WalletCards } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { ActionQueueCard } from "@/components/dashboard/action-queue-card";
import { Dashboard } from "@/components/dashboard/dashboard";
import { UpcomingWeekCard } from "@/components/calendar/upcoming-week-card";
import { MyTasksCard } from "@/components/projects/my-tasks-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { money } from "@/components/dashboard/format";
import type { ActionQueueItem } from "@/server/metrics/action-queue";
import type { UpcomingWeek } from "@/server/calendar/upcoming";
import type { MyTasksCardData } from "@/components/projects/types";
import type { DashboardView } from "@/components/dashboard/types";
import type { ForecastMonth } from "@/domain/billing/forecast";
import type { UpcomingDeliverable } from "@/server/projects/queries";

export async function OperationalHome({
  name,
  today,
  basePath,
  locale,
  currency,
  receivedCents,
  dueCents,
  upcoming,
  queue,
  tasks,
  deliverables,
  urgentDeliverableCount,
  canEdit,
  dashboard,
  forecast,
}: {
  name: string;
  today: string;
  basePath: string;
  locale: string;
  currency: string;
  receivedCents: number;
  dueCents: number;
  upcoming: UpcomingWeek;
  queue: ActionQueueItem[];
  tasks: MyTasksCardData;
  deliverables: UpcomingDeliverable[];
  urgentDeliverableCount: number;
  canEdit: boolean;
  dashboard: DashboardView;
  forecast: ForecastMonth[];
}) {
  const t = await getTranslations("dashboard");
  const month = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${today.slice(0, 7)}-01T12:00:00Z`));
  return (
    <div className="mx-auto max-w-[88rem] space-y-7">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-4xl font-extrabold heading-tight md:text-5xl">{t("operational.greeting", { name })}</h2>
          <p className="mt-2 text-muted-foreground">{t("operational.subtitle", { month })}</p>
        </div>
        <Link href={`${basePath}/projects`} className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
          {t("operational.projects")} <ArrowUpRight aria-hidden className="size-4" />
        </Link>
      </header>

      <section aria-label={t("operational.cashLabel")} className="grid gap-4 md:grid-cols-3">
        <Card className="border-primary/20 bg-primary/[0.035]">
          <CardHeader className="pb-2"><CardDescription className="flex items-center gap-2 font-semibold"><WalletCards aria-hidden className="size-4 text-primary" />{t("operational.received")}</CardDescription></CardHeader>
          <CardContent><p className="text-3xl font-bold tabular-nums">{money(receivedCents, { locale, currency })}</p><p className="mt-1 text-xs text-muted-foreground">{t("operational.receivedHint")}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription className="flex items-center gap-2 font-semibold"><CalendarDays aria-hidden className="size-4 text-muted-foreground" />{t("operational.due")}</CardDescription></CardHeader>
          <CardContent><p className="text-3xl font-bold tabular-nums">{money(dueCents, { locale, currency })}</p><p className="mt-1 text-xs text-muted-foreground">{t("operational.dueHint")}</p></CardContent>
        </Card>
        <Card className={tasks.counts.overdue + tasks.counts.today > 0 ? "border-warning/40" : ""}>
          <CardHeader className="pb-2"><CardDescription className="flex items-center gap-2 font-semibold"><CircleAlert aria-hidden className="size-4 text-warning" />{t("operational.urgentToday")}</CardDescription></CardHeader>
          <CardContent>
            <Link href="#upcoming-deliverables" className="text-3xl font-bold tabular-nums hover:text-primary">{tasks.counts.overdue + tasks.counts.today + urgentDeliverableCount}</Link>
            <p className="mt-1 text-xs text-muted-foreground">{t("operational.urgentHint", { overdue: tasks.counts.overdue, today: tasks.counts.today })} · {t("operational.urgentDeliverables", { count: urgentDeliverableCount })}</p>
          </CardContent>
        </Card>
      </section>

      <Card id="upcoming-deliverables">
        <CardHeader className="flex flex-row items-start justify-between gap-3 border-b">
          <div><CardTitle>{t("operational.deliverablesTitle")}</CardTitle><CardDescription>{t("operational.deliverablesHint")}</CardDescription></div>
          <Link href={`${basePath}/projects`} className="shrink-0 text-sm font-semibold text-primary hover:underline">{t("operational.projects")} <ArrowUpRight aria-hidden className="inline size-4" /></Link>
        </CardHeader>
        <CardContent className="p-0">
          {deliverables.length ? <ul className="divide-y">{deliverables.map((item) => <li key={item.id}>
            <Link href={`${basePath}/projects/${item.projectId}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3 hover:bg-muted/50">
              <span className="min-w-0"><span className="block truncate font-semibold">{item.title}</span><span className="block truncate text-xs text-muted-foreground">{[item.clientName, item.projectName].filter(Boolean).join(" · ")}</span></span>
              <span className={item.dueOn < today ? "text-sm font-semibold text-destructive" : "text-sm font-medium tabular-nums text-muted-foreground"}>{new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${item.dueOn}T12:00:00Z`))}{item.dueOn < today ? ` · ${t("operational.overdue")}` : ""}</span>
            </Link>
          </li>)}</ul> : <p className="px-5 py-8 text-center text-sm text-muted-foreground">{t("operational.noDeliverables")}</p>}
        </CardContent>
      </Card>

      <section className="grid gap-4 xl:grid-cols-3">
        <UpcomingWeekCard data={upcoming} className="xl:col-span-2" />
        <MyTasksCard slug={basePath.slice(1)} basePath={basePath} data={tasks} canEdit={canEdit} />
      </section>

      <section aria-label={t("operational.actionsLabel")} className="grid gap-4 lg:grid-cols-2">
        <ActionQueueCard items={queue} money={{ locale, currency }} />
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><CircleAlert aria-hidden className="size-5 text-primary" />{t("operational.crmTitle")}</CardTitle><CardDescription>{t("operational.crmDescription")}</CardDescription></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Link className="rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted" href={`${basePath}/pipeline`}>{t("operational.openPipeline")}</Link>
            <Link className="rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted" href={`${basePath}/clients`}>{t("operational.openClients")}</Link>
            <Link className="rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted" href={`${basePath}/quotes`}>{t("operational.openQuotes")}</Link>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">{t("operational.pipelineForecast")}</CardTitle><CardDescription>{t("operational.pipelineForecastHint", { count: dashboard.pipeline.openDeals })}</CardDescription></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("operational.weightedOneOff")}</p><p className="mt-1 text-2xl font-bold tabular-nums">{money(dashboard.pipeline.oneOffCents, { locale, currency })}</p></div>
          <div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("operational.weightedMonthly")}</p><p className="mt-1 text-2xl font-bold tabular-nums">{money(dashboard.pipeline.mrrCents, { locale, currency })}<span className="ml-1 text-sm font-medium text-muted-foreground">/ {t("operational.month")}</span></p></div>
          <p className="text-xs text-muted-foreground sm:col-span-2">{t("operational.pipelineDisclaimer")}</p>
        </CardContent>
      </Card>

      <section className="space-y-4">
        <div><h3 className="text-lg font-semibold">{t("operational.analyticsTitle")}</h3><p className="text-sm text-muted-foreground">{t("operational.analyticsHint")}</p></div>
        <div className="flex flex-wrap gap-2">
          <a href="#full-analytics" className="rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted">{t("operational.analytics.analytics")}</a>
          {[["finance", "finance"], ["clients", "clients"]].map(([label, path]) => <Link key={path} href={`${basePath}/${path}`} className="rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted">{t(`operational.analytics.${label}`)}</Link>)}
        </div>
        <details id="full-analytics" className="rounded-xl border bg-card px-5 py-4">
          <summary className="cursor-pointer list-none font-semibold marker:hidden">{t("operational.analyticsDetail")}</summary>
          <div className="mt-6 border-t pt-6"><Dashboard view={dashboard} forecast={forecast} /></div>
        </details>
      </section>
    </div>
  );
}
