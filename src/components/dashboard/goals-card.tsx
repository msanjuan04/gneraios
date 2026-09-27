import { ArrowRight, Target } from "lucide-react";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import type { GoalStatus, MrrGoalProgress, RevenueGoalProgress } from "@/domain/metrics/goals";
import { cn } from "@/lib/utils";
import { civilToDate, money } from "./format";
import type { MoneyFormat } from "./types";

const STATUS_TONE: Record<GoalStatus, string> = {
  reached: "bg-success/10 text-success",
  on_track: "bg-success/10 text-success",
  behind: "bg-warning/10 text-warning",
  missed: "bg-destructive/10 text-destructive",
};

const pct = (bps: number) => Math.max(0, Math.min(100, bps / 100));

async function StatusChip({ status }: { status: GoalStatus }) {
  const t = await getTranslations("dashboard.goals.status");
  return <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", STATUS_TONE[status])}>{t(status)}</span>;
}

async function MrrTile({ p, fmt }: { p: MrrGoalProgress; fmt: MoneyFormat }) {
  const t = await getTranslations("dashboard.goals");
  const format = await getFormatter();
  const by = format.dateTime(civilToDate(p.by), { day: "numeric", month: "short", year: "numeric" });
  return (
    <div className="flex flex-col gap-3 rounded-2xl border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
          {t("mrrTitle", { target: money(p.targetCents, fmt), date: by })}
        </p>
        <StatusChip status={p.status} />
      </div>
      <p className="flex items-baseline gap-2">
        <span className="text-3xl font-extrabold tabular">{money(p.currentCents, fmt)}</span>
        <span className="text-sm font-semibold text-muted-foreground tabular">{format.number(pct(p.progressBps) / 100, { style: "percent" })}</span>
      </p>
      <div className="h-2 overflow-hidden rounded-full bg-muted" role="img" aria-label={t("progressLabel", { percent: Math.round(pct(p.progressBps)) })}>
        <div className="h-full rounded-full bg-brand-gradient" style={{ width: `${pct(p.progressBps)}%` }} />
      </div>
      <p className="text-xs text-muted-foreground">
        {p.status === "reached"
          ? t("mrrReached")
          : p.neededPerMonthCents !== null
            ? t("mrrNeeded", { gap: money(p.targetCents - p.currentCents, fmt), perMonth: money(p.neededPerMonthCents, fmt), months: p.monthsLeft })
            : t("mrrMissed", { gap: money(p.targetCents - p.currentCents, fmt) })}{" "}
        {p.status !== "reached" &&
          (p.projectedMonth
            ? t("mrrPace", {
                pace: money(p.paceCents, fmt),
                month: format.dateTime(civilToDate(p.projectedMonth), { month: "long", year: "numeric" }),
              })
            : t("mrrNoPace"))}
      </p>
    </div>
  );
}

async function RevenueTile({ p, fmt }: { p: RevenueGoalProgress; fmt: MoneyFormat }) {
  const t = await getTranslations("dashboard.goals");
  const signedWidth = Math.max(0, pct(p.projectedBps) - pct(p.progressBps));
  return (
    <div className="flex flex-col gap-3 rounded-2xl border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
          {t("revenueTitle", { year: p.year, target: money(p.targetCents, fmt) })}
        </p>
        <StatusChip status={p.status} />
      </div>
      <p className="flex items-baseline gap-2">
        <span className="text-3xl font-extrabold tabular">{money(p.invoicedCents, fmt)}</span>
        <span className="text-sm text-muted-foreground">{t("invoicedSoFar")}</span>
      </p>
      <div className="flex h-2 overflow-hidden rounded-full bg-muted" role="img" aria-label={t("revenueBarLabel", { invoiced: Math.round(pct(p.progressBps)), projected: Math.round(pct(p.projectedBps)) })}>
        <div className="h-full bg-brand-gradient" style={{ width: `${pct(p.progressBps)}%` }} />
        <div className="h-full bg-primary/35" style={{ width: `${signedWidth}%` }} />
      </div>
      <p className="text-xs text-muted-foreground">
        {t("revenueDetail", { signed: money(p.signedCents, fmt), projected: money(p.projectedCents, fmt) })}{" "}
        {p.gapCents > 0 ? (
          <span className="font-semibold text-foreground">{t("revenueGap", { gap: money(p.gapCents, fmt) })}</span>
        ) : (
          <span className="font-semibold text-success">{t("revenueCovered")}</span>
        )}
      </p>
    </div>
  );
}

/**
 * Objetivos de los socios (Ajustes → General): MRR a una fecha y facturación del año, con lo que
 * falta y si el ritmo actual llega. Sin objetivos, a un owner le propone marcarlos.
 */
export async function GoalsCard({
  mrr,
  revenue,
  money: fmt,
  settingsHref,
  canEdit,
}: {
  mrr: MrrGoalProgress | null;
  revenue: RevenueGoalProgress | null;
  money: MoneyFormat;
  settingsHref: string;
  canEdit: boolean;
}) {
  const t = await getTranslations("dashboard.goals");
  if (!mrr && !revenue) {
    if (!canEdit) return null;
    return (
      <Link
        href={settingsHref}
        className="flex items-center gap-3 rounded-2xl border border-dashed px-5 py-4 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
      >
        <Target className="size-4 shrink-0 text-primary" />
        <span className="min-w-0 flex-1">{t("empty")}</span>
        <ArrowRight className="size-4 shrink-0" />
      </Link>
    );
  }
  return (
    <section aria-label={t("label")} className={cn("grid gap-4", mrr && revenue && "md:grid-cols-2")}>
      {mrr && <MrrTile p={mrr} fmt={fmt} />}
      {revenue && <RevenueTile p={revenue} fmt={fmt} />}
    </section>
  );
}
