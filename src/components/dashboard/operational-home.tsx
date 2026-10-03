import Link from "next/link";
import { ArrowUpRight, CalendarDays, CircleAlert, WalletCards } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { ActionQueueCard } from "@/components/dashboard/action-queue-card";
import { Dashboard } from "@/components/dashboard/dashboard";
import { MonthlyBarsChart } from "@/components/dashboard/monthly-bars-chart";
import { TeamTodayCard } from "@/components/dashboard/team-today-card";
import { MyTasksCard } from "@/components/projects/my-tasks-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { money } from "@/components/dashboard/format";
import type { ActionQueueItem } from "@/server/metrics/action-queue";
import type { MonthlyBar } from "@/server/metrics/monthly-bars";
import type { TeamMemberToday } from "@/server/projects/team-today";
import type { MyTasksCardData } from "@/components/projects/types";
import type { DashboardView } from "@/components/dashboard/types";
import type { ForecastMonth } from "@/domain/billing/forecast";
import type { UpcomingDeliverable } from "@/server/projects/queries";

/**
 * La portada: lo justo para saber cómo va el mes y qué toca hoy.
 *
 *   1. Tres cifras: cobrado, por cobrar y lo urgente de hoy.
 *   2. Facturación y gastos del mes, con los cinco anteriores para tener contexto.
 *   3. Las entregas comprometidas.
 *   4. Mis tareas y las del equipo, para saber quién lleva qué.
 *   5. Lo que hay que atender (cola de acciones).
 *
 * El análisis largo (histórico, MRR, concentración, previsión) vive al final, plegado: está cuando
 * se busca y no estorba cuando no.
 */
export async function OperationalHome({
  name,
  today,
  basePath,
  locale,
  currency,
  receivedCents,
  dueCents,
  bars,
  queue,
  tasks,
  team,
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
  bars: MonthlyBar[];
  queue: ActionQueueItem[];
  tasks: MyTasksCardData;
  team: TeamMemberToday[];
  deliverables: UpcomingDeliverable[];
  urgentDeliverableCount: number;
  canEdit: boolean;
  dashboard: DashboardView;
  forecast: ForecastMonth[];
}) {
  const t = await getTranslations("dashboard");
  const monthFormat = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" });
  const month = monthFormat.format(new Date(`${today.slice(0, 7)}-01T12:00:00Z`));
  const moneyFormat = { locale, currency };
  const day = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" });

  return (
    <div className="space-y-7">
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
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2 font-semibold">
              <WalletCards aria-hidden className="size-4 text-primary" />
              {t("operational.received")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold tabular-nums">{money(receivedCents, moneyFormat)}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t("operational.receivedHint")}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2 font-semibold">
              <CalendarDays aria-hidden className="size-4 text-muted-foreground" />
              {t("operational.due")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold tabular-nums">{money(dueCents, moneyFormat)}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t("operational.dueHint")}</p>
          </CardContent>
        </Card>
        <Card className={tasks.counts.overdue + tasks.counts.today > 0 ? "border-warning/40" : ""}>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2 font-semibold">
              <CircleAlert aria-hidden className="size-4 text-warning" />
              {t("operational.urgentToday")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="#upcoming-deliverables" className="text-3xl font-bold tabular-nums hover:text-primary">
              {tasks.counts.overdue + tasks.counts.today + urgentDeliverableCount}
            </Link>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("operational.urgentHint", { overdue: tasks.counts.overdue, today: tasks.counts.today })} ·{" "}
              {t("operational.urgentDeliverables", { count: urgentDeliverableCount })}
            </p>
          </CardContent>
        </Card>
      </section>

      {/* Cómo va el dinero este mes: lo que entra y lo que sale, con los meses anteriores al lado. */}
      <section aria-label={t("monthly.label")} className="grid gap-4 lg:grid-cols-2">
        <MonthlyBarsChart kind="invoiced" bars={bars} format={moneyFormat} />
        <MonthlyBarsChart kind="expenses" bars={bars} format={moneyFormat} />
      </section>

      <Card id="upcoming-deliverables">
        <CardHeader className="flex flex-row items-start justify-between gap-3 border-b">
          <div>
            <CardTitle>{t("operational.deliverablesTitle")}</CardTitle>
            <CardDescription>{t("operational.deliverablesHint")}</CardDescription>
          </div>
          <Link href={`${basePath}/projects`} className="shrink-0 text-sm font-semibold text-primary hover:underline">
            {t("operational.projects")} <ArrowUpRight aria-hidden className="inline size-4" />
          </Link>
        </CardHeader>
        <CardContent className="p-0">
          {deliverables.length ? (
            <ul className="divide-y">
              {deliverables.map((item) => (
                <li key={item.id}>
                  <Link
                    href={`${basePath}/projects/${item.projectId}`}
                    className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3 hover:bg-muted/50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{item.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">{[item.clientName, item.projectName].filter(Boolean).join(" · ")}</span>
                    </span>
                    <span className={item.dueOn < today ? "text-sm font-semibold text-destructive" : "text-sm font-medium tabular-nums text-muted-foreground"}>
                      {day.format(new Date(`${item.dueOn}T12:00:00Z`))}
                      {item.dueOn < today ? ` · ${t("operational.overdue")}` : ""}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">{t("operational.noDeliverables")}</p>
          )}
        </CardContent>
      </Card>

      {/* Lo mío y lo de todos: qué me toca hoy y cómo va cada uno. */}
      <section aria-label={t("operational.tasksLabel")} className="grid gap-4 lg:grid-cols-2">
        <MyTasksCard slug={basePath.slice(1)} basePath={basePath} data={tasks} canEdit={canEdit} />
        <TeamTodayCard team={team} basePath={basePath} />
      </section>

      <ActionQueueCard items={queue} money={moneyFormat} />

      <details className="rounded-xl border bg-card px-5 py-4">
        <summary className="cursor-pointer list-none font-semibold marker:hidden">
          {t("operational.analyticsDetail")}
          <span className="ml-2 text-sm font-normal text-muted-foreground">{t("operational.analyticsHint")}</span>
        </summary>
        <div className="mt-6 border-t pt-6">
          <Dashboard view={dashboard} forecast={forecast} />
        </div>
      </details>
    </div>
  );
}
