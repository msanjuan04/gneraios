import { ArrowUpRight, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { Card, CardAction, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { changeRatio, REVENUE_CATEGORIES, revenueOf, revenueTotal, type RevenueCategory } from "@/domain/metrics";
import { cn } from "@/lib/utils";
import { SERIES, TRACK } from "./colors";
import { Delta, directionOf } from "./delta";
import { civilToDate, money, share, signedMoney, signedPercent } from "./format";
import { Sparkline } from "./sparkline";
import type { DashboardView } from "./types";

/*
 * Cifras de cabecera. Cada importe dice si es base sin IVA o total con IVA; lo puntual y lo
 * recurrente no se suman nunca sin su desglose. Las cifras grandes van con dígitos
 * proporcionales (las tabulares, solo en columnas).
 */

function Kpi({
  label,
  tag,
  href,
  linkLabel,
  className,
  children,
}: {
  label: string;
  tag?: string;
  href?: string;
  linkLabel?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card className={cn("@container gap-3", className)}>
      <CardHeader>
        <CardDescription className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-semibold tracking-wider uppercase">
          <span>{label}</span>
          {tag && (
            <span className="rounded-full border px-1.5 py-px text-[10px] font-semibold tracking-normal normal-case">{tag}</span>
          )}
        </CardDescription>
        {href && (
          <CardAction>
            <Link
              href={href}
              aria-label={linkLabel}
              className="-m-1 flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <ArrowUpRight className="size-4" />
            </Link>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col">{children}</CardContent>
    </Card>
  );
}

/** Cifra suelta y grande (dígitos proporcionales); se encoge en tarjetas estrechas. */
function Figure({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("text-3xl font-extrabold heading-tight [overflow-wrap:anywhere] @[18rem]:text-4xl", className)}>{children}</p>
  );
}

export async function KpiCards({ view }: { view: DashboardView }) {
  const t = await getTranslations("dashboard.kpi");
  const format = await getFormatter();
  const fmt = view.money;
  const month = (date: string, style: "long" | "short" = "long") =>
    format.dateTime(civilToDate(date), style === "long" ? { month: "long" } : { month: "short", year: "numeric" });
  const previousMonth = view.history.at(-2)?.month ?? view.today;
  const lastYearMonth = view.history.at(-13)?.month ?? view.today;
  const perMonth = (amount: string) =>
    t.rich("perMonth", {
      amount,
      unit: (chunks) => <span className="ml-0.5 text-[0.45em] font-bold tracking-normal text-muted-foreground">{chunks}</span>,
    });

  // MRR: hoy frente al cierre del mes anterior.
  const mrrDelta = view.mrr.cents - view.mrr.previousCents;
  const mrrRatio = changeRatio(view.mrr.cents, view.mrr.previousCents);

  // ARR frente al del mismo mes del año pasado.
  const arrRatio = view.arr.yearAgoCents === null ? null : changeRatio(view.arr.cents, view.arr.yearAgoCents);

  // Clientes activos frente al cierre del mes anterior.
  const clientsDelta = view.clients.activePrevious === null ? null : view.clients.active - view.clients.activePrevious;

  const r = view.receivables;
  const c = view.collection;
  const overdueShare = r.outstandingCents > 0 ? Math.min(1, Math.max(0, r.overdueCents / r.outstandingCents)) : 0;

  return (
    <section aria-label={t("label")} className="grid gap-3 sm:gap-4 md:grid-cols-2 xl:grid-cols-12">
      {/* MRR: la cifra que manda. */}
      <Card className="relative gap-3 overflow-hidden md:col-span-2 xl:col-span-6">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_100%_at_0%_0%,color-mix(in_oklab,var(--chart-1)_20%,transparent),transparent_60%)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-8 top-0 h-px bg-[linear-gradient(90deg,transparent,var(--chart-1),transparent)] opacity-70"
        />
        <CardHeader className="relative">
          <CardDescription className="flex items-center gap-2 text-[11px] font-semibold tracking-wider uppercase">
            <span>{t("mrr")}</span>
            <span className="rounded-full border px-1.5 py-px text-[10px] font-semibold tracking-normal normal-case">{t("base")}</span>
          </CardDescription>
          <CardAction>
            <Link
              href={`${view.basePath}/contracts`}
              aria-label={t("goContracts")}
              className="-m-1 flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <ArrowUpRight className="size-4" />
            </Link>
          </CardAction>
        </CardHeader>
        <CardContent className="relative">
          <p className="text-[2.75rem] leading-none font-extrabold heading-tight sm:text-6xl">{perMonth(money(view.mrr.cents, fmt))}</p>
          <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1">
            <Delta direction={directionOf(mrrDelta)}>
              {signedMoney(mrrDelta, fmt)}
              {mrrRatio !== null && mrrDelta !== 0 && ` · ${signedPercent(mrrRatio, fmt.locale)}`}
            </Delta>
            <span className="text-xs text-muted-foreground">
              {t(view.mrr.previousEstimated ? "vsCloseEstimated" : "vsClose", { month: month(previousMonth) })}
            </span>
          </div>
          <Sparkline
            className="mt-5"
            label={t("sparkline")}
            points={view.mrr.sparkline.map((p) => ({
              key: p.month,
              value: p.cents,
              estimated: p.estimated,
              title: `${month(p.month, "short")}: ${money(p.cents, fmt)}`,
            }))}
          />
          <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground">
            <span className="capitalize">{month(view.mrr.sparkline[0]?.month ?? view.today, "short")}</span>
            <span>{t("today")}</span>
          </div>
        </CardContent>
      </Card>

      <Kpi label={t("arr")} tag={t("base")} className="xl:col-span-3">
        <Figure>{money(view.arr.cents, fmt)}</Figure>
        <div className="mt-2">
          {arrRatio === null ? (
            <span className="text-xs text-muted-foreground">{t("arrYoyNone")}</span>
          ) : (
            <Delta direction={directionOf(arrRatio)}>{t("arrYoy", { delta: signedPercent(arrRatio, fmt.locale), month: month(lastYearMonth, "short") })}</Delta>
          )}
        </div>
        <p className="mt-auto pt-3 text-xs text-muted-foreground">{t("arrHint")}</p>
      </Kpi>

      <Kpi label={t("clients")} href={`${view.basePath}/clients`} linkLabel={t("goClients")} className="xl:col-span-3">
        <Figure>{format.number(view.clients.active)}</Figure>
        <div className="mt-2">
          {clientsDelta === null ? null : (
            <Delta direction={directionOf(clientsDelta)}>
              {t("clientsDelta", { delta: clientsDelta > 0 ? `+${clientsDelta}` : clientsDelta < 0 ? `−${-clientsDelta}` : "±0", month: month(previousMonth) })}
            </Delta>
          )}
        </div>
        <p className="mt-auto pt-3 text-xs text-muted-foreground">
          {t("clientsBreakdown", { paused: view.clients.paused, former: view.clients.former, leads: view.clients.leads })}
        </p>
      </Kpi>

      <RevenueKpi view={view} previousMonth={previousMonth} lastYearMonth={lastYearMonth} />

      <Kpi label={t("receivables")} tag={t("withVat")} href={`${view.basePath}/invoices`} linkLabel={t("goInvoices")} className="xl:col-span-3">
        <Figure>{money(r.outstandingCents, fmt)}</Figure>
        <p className="mt-1 text-xs text-muted-foreground">{t("openInvoices", { count: r.openCount })}</p>
        <div
          className="mt-3 h-1.5 overflow-hidden rounded-full"
          style={{ background: TRACK }}
          role="img"
          aria-label={t("overdueShare", { share: share(Math.round(overdueShare * 10_000), fmt.locale) })}
        >
          <div className="h-full rounded-full bg-destructive" style={{ width: `${overdueShare * 100}%` }} />
        </div>
        {r.overdueCount > 0 ? (
          <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-destructive">
            <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
            {t("overdue", { amount: money(r.overdueCents, fmt), count: r.overdueCount })}
          </p>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">{t("overdueNone")}</p>
        )}
        <p className="mt-auto pt-3 text-xs text-muted-foreground">
          {c.avgDaysToPay === null
            ? t("collectionNone")
            : t("collection", {
                days: format.number(c.avgDaysToPay, { maximumFractionDigits: 1 }),
                onTime: c.onTimeShare === null ? "—" : format.number(c.onTimeShare, { style: "percent", maximumFractionDigits: 0 }),
              })}
        </p>
      </Kpi>

      <Kpi label={t("pipeline")} tag={t("base")} href={`${view.basePath}/pipeline`} linkLabel={t("goPipeline")} className="xl:col-span-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="min-w-0">
            <p className="whitespace-nowrap text-xl font-extrabold heading-tight tabular @[18rem]:text-2xl @[24rem]:text-3xl">{money(view.pipeline.oneOffCents, fmt)}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{t("pipelineOneOff")}</p>
          </div>
          <div className="min-w-0">
            <p className="whitespace-nowrap text-xl font-extrabold heading-tight tabular @[18rem]:text-2xl @[24rem]:text-3xl">{perMonth(money(view.pipeline.mrrCents, fmt))}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{t("pipelineMrr")}</p>
          </div>
        </div>
        <p className="mt-auto pt-3 text-xs text-muted-foreground">{t("pipelineHint", { count: view.pipeline.openDeals })}</p>
      </Kpi>
    </section>
  );
}

/** Ingresos del mes en curso, siempre desglosados, frente al mes anterior y al mismo mes del año pasado. */
async function RevenueKpi({ view, previousMonth, lastYearMonth }: { view: DashboardView; previousMonth: string; lastYearMonth: string }) {
  const t = await getTranslations("dashboard.kpi");
  const format = await getFormatter();
  const fmt = view.money;
  const { current, previous, lastYear } = view.revenue;
  const total = revenueTotal(current);
  const positive = REVENUE_CATEGORIES.map((category) => Math.max(0, revenueOf(current, category)));
  const positiveTotal = positive.reduce((sum, cents) => sum + cents, 0);
  const label: Record<RevenueCategory, string> = { recurring: t("recurring"), usage: t("usage"), oneOff: t("oneOff") };

  const compare = (now: number, before: number) => {
    if (now === 0 && before === 0) return <span className="text-muted-foreground">—</span>;
    const ratio = changeRatio(now, before);
    if (ratio === null) return <Delta direction="up">{t("new")}</Delta>;
    return <Delta direction={directionOf(now - before)}>{signedPercent(ratio, fmt.locale)}</Delta>;
  };

  return (
    <Card className="@container gap-3 md:col-span-2 xl:col-span-6">
      <CardHeader>
        <CardDescription className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-semibold tracking-wider uppercase">
          <span>{t("revenue", { month: format.dateTime(civilToDate(current.month), { month: "long" }) })}</span>
          <span className="rounded-full border px-1.5 py-px text-[10px] font-semibold tracking-normal normal-case">{t("base")}</span>
          <span className="rounded-full bg-primary/10 px-1.5 py-px text-[10px] font-semibold tracking-normal text-primary normal-case">
            {t("inProgress")}
          </span>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4 @[34rem]:flex-row @[34rem]:items-start @[34rem]:gap-8">
        <div className="min-w-0 @[34rem]:w-2/5">
          <Figure>{money(total, fmt)}</Figure>
          <p className="mt-1 text-xs text-muted-foreground">{t("revenueTotal")}</p>
          {/* Reparto del mes: la barra enseña las proporciones; las cifras están al lado. */}
          <div className="mt-3 flex h-2 gap-0.5 overflow-hidden rounded-full" style={{ background: positiveTotal > 0 ? undefined : TRACK }} aria-hidden>
            {positiveTotal > 0 &&
              REVENUE_CATEGORIES.map((category, i) =>
                positive[i]! > 0 ? (
                  <div key={category} className="h-full first:rounded-l-full last:rounded-r-full" style={{ flexGrow: positive[i], background: SERIES[category] }} />
                ) : null,
              )}
          </div>
        </div>
        <table className="w-full min-w-0 text-sm @[34rem]:w-3/5">
          <caption className="sr-only">{t("revenueCaption")}</caption>
          <thead>
            <tr className="text-[11px] text-muted-foreground">
              <th scope="col" className="pb-1.5 text-left font-medium">
                <span className="sr-only">{t("category")}</span>
              </th>
              <th scope="col" className="pb-1.5 text-right font-medium">
                {t("thisMonth")}
              </th>
              <th scope="col" className="pb-1.5 text-right font-medium capitalize">
                {t("vsMonth", { month: format.dateTime(civilToDate(previousMonth), { month: "short" }) })}
              </th>
              <th scope="col" className="pb-1.5 text-right font-medium capitalize">
                {t("vsMonth", { month: format.dateTime(civilToDate(lastYearMonth), { month: "short", year: "2-digit" }) })}
              </th>
            </tr>
          </thead>
          <tbody>
            {REVENUE_CATEGORIES.map((category) => (
              <tr key={category} className="border-t border-border/60">
                <th scope="row" className="py-1.5 text-left font-medium">
                  <span className="flex items-center gap-2">
                    <span aria-hidden className="size-2.5 shrink-0 rounded-[3px]" style={{ background: SERIES[category] }} />
                    {label[category]}
                  </span>
                </th>
                <td className="py-1.5 text-right font-semibold tabular">{money(revenueOf(current, category), fmt)}</td>
                <td className="py-1.5 text-right">{compare(revenueOf(current, category), revenueOf(previous, category))}</td>
                <td className="py-1.5 text-right">{compare(revenueOf(current, category), revenueOf(lastYear, category))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
      <p className="px-4 text-xs text-muted-foreground">{t("revenueFootnote")}</p>
    </Card>
  );
}
