"use client";

import { useLocale, useTranslations } from "next-intl";
import type { ReactElement } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  type TooltipContentProps,
  XAxis,
  YAxis,
} from "recharts";
import { ChartCard, Legend } from "@/components/dashboard/chart-card";
import { AXIS_TEXT, GRID, MRR_LINE, SERIES, SURFACE } from "@/components/dashboard/colors";
import { compactMoney } from "@/components/dashboard/format";
import { useMounted } from "@/components/dashboard/use-mounted";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { MonthPoint, WeekPoint } from "@/domain/projects";
import { cn } from "@/lib/utils";
import { STANDING_TEXT } from "./badges";
import { useProjectFormat } from "./format";
import type { ProjectDetailData } from "./types";

const HEIGHT = 260;
const BUDGET = "var(--warning)";
const TARGET = "color-mix(in oklab, var(--foreground) 45%, transparent)";

/**
 * Resumen de un proyecto: horas por semana frente al presupuesto, lo facturado frente a lo que valen
 * las horas a la tarifa objetivo y la tarifa efectiva acumulada. Cada gráfica tiene su tabla.
 */
export function SummaryTab({ data }: { data: ProjectDetailData }) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <WeeklyChart weekly={data.weekly} budgetMinutes={data.project.budgetMinutes} className="xl:col-span-2" />
      <EconomicsChart monthly={data.monthly} targetCents={data.targetCents} hasContract={data.project.contractId !== null} shared={data.project.sharedContract} />
      <RateChart monthly={data.monthly} targetCents={data.targetCents} hasContract={data.project.contractId !== null} />
    </div>
  );
}

function ChartBox({ empty, emptyLabel, children }: { empty: boolean; emptyLabel: string; children: ReactElement }) {
  const mounted = useMounted();
  return (
    <div className="relative" style={{ height: HEIGHT }}>
      {empty && <p className="absolute inset-0 z-10 flex items-center justify-center text-sm text-muted-foreground">{emptyLabel}</p>}
      {mounted && (
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      )}
    </div>
  );
}

function TooltipBox({ title, rows }: { title: string; rows: { label: string; value: string; color?: string; dashed?: boolean }[] }) {
  return (
    <div className="min-w-48 rounded-lg border bg-popover/95 p-3 text-xs text-popover-foreground shadow-xl backdrop-blur-md">
      <p className="font-semibold capitalize">{title}</p>
      <ul className="mt-2 space-y-1.5">
        {rows.map((row) => (
          <li key={row.label} className="flex items-center gap-2">
            {row.color && <span aria-hidden className="size-2 shrink-0 rounded-[2px]" style={{ background: row.color }} />}
            <span className="text-muted-foreground">{row.label}</span>
            <span className="ml-auto font-semibold tabular">{row.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function WeeklyChart({ weekly, budgetMinutes, className }: { weekly: WeekPoint[]; budgetMinutes: number | null; className?: string }) {
  const t = useTranslations("projects.summary.weekly");
  const fmt = useProjectFormat();
  const points = weekly.map((w) => ({ ...w, hours: w.minutes / 60, cumulativeHours: w.cumulativeMinutes / 60 }));
  const budget = budgetMinutes !== null ? budgetMinutes / 60 : null;
  const empty = weekly.every((w) => w.cumulativeMinutes === 0);
  const maxY = Math.max(budget ?? 0, ...points.map((p) => p.cumulativeHours), 1);

  const tooltip = ({ active, payload }: Partial<TooltipContentProps>) => {
    const p = payload?.[0]?.payload as (typeof points)[number] | undefined;
    if (!active || !p) return null;
    return (
      <TooltipBox
        title={t("weekOf", { date: fmt.date(p.week) })}
        rows={[
          { label: t("legendWeek"), value: fmt.duration(p.minutes), color: SERIES.recurring },
          { label: t("legendCumulative"), value: fmt.duration(p.cumulativeMinutes), color: MRR_LINE },
          ...(budgetMinutes !== null ? [{ label: t("legendBudget"), value: fmt.duration(budgetMinutes), color: BUDGET }] : []),
        ]}
      />
    );
  };

  return (
    <ChartCard
      title={t("title")}
      description={t("description")}
      className={className}
      legend={
        <Legend
          items={[
            { key: "week", label: t("legendWeek"), color: SERIES.recurring, mark: "bar" },
            { key: "cumulative", label: t("legendCumulative"), color: MRR_LINE, mark: "line" },
            ...(budget !== null ? [{ key: "budget", label: t("legendBudget"), color: BUDGET, mark: "dashed" as const }] : []),
          ]}
        />
      }
      table={
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-8 text-xs text-muted-foreground">{t("columnWeek")}</TableHead>
              <TableHead className="h-8 text-right text-xs text-muted-foreground">{t("legendWeek")}</TableHead>
              <TableHead className="h-8 text-right text-xs text-muted-foreground">{t("legendCumulative")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...weekly].reverse().map((w) => (
              <TableRow key={w.week}>
                <TableCell>{fmt.date(w.week)}</TableCell>
                <TableCell className="text-right tabular">{fmt.duration(w.minutes)}</TableCell>
                <TableCell className="text-right tabular">{fmt.duration(w.cumulativeMinutes)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      }
    >
      <ChartBox empty={empty} emptyLabel={t("empty")}>
        <ComposedChart data={points} margin={{ top: 16, right: 12, bottom: 0, left: 0 }} barCategoryGap="28%" accessibilityLayer>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis
            dataKey="week"
            tickLine={false}
            axisLine={{ stroke: GRID }}
            tick={{ fill: AXIS_TEXT, fontSize: 11 }}
            tickMargin={8}
            minTickGap={16}
            tickFormatter={(week: string) => fmt.date(week, "short")}
          />
          <YAxis
            width={44}
            tickLine={false}
            axisLine={false}
            tick={{ fill: AXIS_TEXT, fontSize: 11 }}
            domain={[0, Math.ceil(maxY * 1.1)]}
            allowDecimals={false}
            tickFormatter={(hours: number) => `${hours} h`}
          />
          <Tooltip content={tooltip} cursor={{ fill: "color-mix(in oklab, var(--foreground) 5%, transparent)" }} isAnimationActive={false} />
          <Bar dataKey="hours" fill={SERIES.recurring} radius={[4, 4, 0, 0]} maxBarSize={22} animationDuration={500} />
          <Line
            dataKey="cumulativeHours"
            type="monotone"
            stroke={MRR_LINE}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: MRR_LINE, stroke: SURFACE, strokeWidth: 2 }}
            isAnimationActive={false}
          />
          {budget !== null && (
            <ReferenceLine
              y={budget}
              stroke={BUDGET}
              strokeDasharray="4 4"
              strokeWidth={1.5}
              label={{ value: t("budgetLabel", { hours: fmt.hours(budgetMinutes!) }), position: "insideTopLeft", fill: AXIS_TEXT, fontSize: 11 }}
            />
          )}
        </ComposedChart>
      </ChartBox>
    </ChartCard>
  );
}

function EconomicsChart({ monthly, targetCents, hasContract, shared }: { monthly: MonthPoint[]; targetCents: number; hasContract: boolean; shared: boolean }) {
  const t = useTranslations("projects.summary.economics");
  const fmt = useProjectFormat();
  const locale = useLocale();
  const money = { locale, currency: "EUR" };
  const empty = !hasContract || monthly.every((m) => m.cumulativeRevenueCents === 0 && m.cumulativeMinutes === 0);

  const tooltip = ({ active, payload }: Partial<TooltipContentProps>) => {
    const p = payload?.[0]?.payload as MonthPoint | undefined;
    if (!active || !p) return null;
    return (
      <TooltipBox
        title={fmt.monthLong(p.month)}
        rows={[
          { label: t("legendRevenue"), value: fmt.money(p.cumulativeRevenueCents), color: SERIES.recurring },
          { label: t("legendValue"), value: fmt.money(p.cumulativeTargetCents), color: TARGET },
          { label: t("monthRevenue"), value: fmt.money(p.revenueCents) },
          { label: t("monthHours"), value: fmt.duration(p.minutes) },
        ]}
      />
    );
  };

  return (
    <ChartCard
      title={t("title")}
      description={shared ? t("descriptionShared", { target: fmt.rate(targetCents) }) : t("description", { target: fmt.rate(targetCents) })}
      legend={
        <Legend
          items={[
            { key: "revenue", label: t("legendRevenue"), color: SERIES.recurring, mark: "line" },
            { key: "value", label: t("legendValue"), color: TARGET, mark: "dashed" },
          ]}
        />
      }
      table={<MonthlyTable monthly={monthly} />}
    >
      <ChartBox empty={empty} emptyLabel={hasContract ? t("empty") : t("noContract")}>
        <LineChart data={monthly} margin={{ top: 16, right: 12, bottom: 0, left: 0 }} accessibilityLayer>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis
            dataKey="month"
            tickLine={false}
            axisLine={{ stroke: GRID }}
            tick={{ fill: AXIS_TEXT, fontSize: 11 }}
            tickMargin={8}
            minTickGap={12}
            tickFormatter={(month: string) => fmt.month(month)}
          />
          <YAxis
            width={56}
            tickLine={false}
            axisLine={false}
            tick={{ fill: AXIS_TEXT, fontSize: 11 }}
            tickFormatter={(cents: number) => compactMoney(cents, money)}
            allowDecimals={false}
          />
          <Tooltip content={tooltip} isAnimationActive={false} />
          <Line dataKey="cumulativeTargetCents" type="monotone" stroke={TARGET} strokeWidth={2} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
          <Line
            dataKey="cumulativeRevenueCents"
            type="monotone"
            stroke={SERIES.recurring}
            strokeWidth={2.5}
            dot={false}
            activeDot={{ r: 4, fill: SERIES.recurring, stroke: SURFACE, strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ChartBox>
    </ChartCard>
  );
}

function RateChart({ monthly, targetCents, hasContract }: { monthly: MonthPoint[]; targetCents: number; hasContract: boolean }) {
  const t = useTranslations("projects.summary.rate");
  const fmt = useProjectFormat();
  const points = monthly.map((m) => ({ ...m, rate: m.cumulativeRateCents === null ? null : m.cumulativeRateCents / 100 }));
  const empty = !hasContract || points.every((p) => p.rate === null);
  const last = [...points].reverse().find((p) => p.rate !== null);
  const target = targetCents / 100;
  const maxY = Math.max(target, ...points.map((p) => p.rate ?? 0));

  const tooltip = ({ active, payload }: Partial<TooltipContentProps>) => {
    const p = payload?.[0]?.payload as (typeof points)[number] | undefined;
    if (!active || !p) return null;
    return (
      <TooltipBox
        title={fmt.monthLong(p.month)}
        rows={[
          { label: t("legendRate"), value: p.cumulativeRateCents === null ? "—" : fmt.rate(p.cumulativeRateCents), color: SERIES.recurring },
          { label: t("legendTarget"), value: fmt.rate(targetCents), color: TARGET },
        ]}
      />
    );
  };

  return (
    <ChartCard
      title={t("title")}
      description={
        last?.cumulativeRateCents != null ? (
          <span>
            {t("current")}{" "}
            <span className={cn("font-semibold", STANDING_TEXT[last.cumulativeRateCents >= targetCents ? "good" : "bad"])}>{fmt.rate(last.cumulativeRateCents)}</span>
            {" · "}
            {t("target", { rate: fmt.rate(targetCents) })}
          </span>
        ) : (
          t("description")
        )
      }
      legend={
        <Legend
          items={[
            { key: "rate", label: t("legendRate"), color: SERIES.recurring, mark: "line" },
            { key: "target", label: t("legendTarget"), color: TARGET, mark: "dashed" },
          ]}
        />
      }
      table={<MonthlyTable monthly={monthly} />}
    >
      <ChartBox empty={empty} emptyLabel={hasContract ? t("empty") : t("noContract")}>
        <LineChart data={points} margin={{ top: 16, right: 12, bottom: 0, left: 0 }} accessibilityLayer>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis
            dataKey="month"
            tickLine={false}
            axisLine={{ stroke: GRID }}
            tick={{ fill: AXIS_TEXT, fontSize: 11 }}
            tickMargin={8}
            minTickGap={12}
            tickFormatter={(month: string) => fmt.month(month)}
          />
          <YAxis
            width={48}
            tickLine={false}
            axisLine={false}
            tick={{ fill: AXIS_TEXT, fontSize: 11 }}
            domain={[0, Math.ceil((maxY * 1.15) / 10) * 10]}
            tickFormatter={(euros: number) => `${euros} €`}
          />
          <Tooltip content={tooltip} isAnimationActive={false} />
          <ReferenceLine y={target} stroke={TARGET} strokeDasharray="4 4" strokeWidth={1.5} />
          <Line
            dataKey="rate"
            type="monotone"
            stroke={SERIES.recurring}
            strokeWidth={2.5}
            connectNulls
            dot={false}
            activeDot={{ r: 4, fill: SERIES.recurring, stroke: SURFACE, strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ChartBox>
    </ChartCard>
  );
}

function MonthlyTable({ monthly }: { monthly: MonthPoint[] }) {
  const t = useTranslations("projects.summary.table");
  const fmt = useProjectFormat();
  const head = "h-8 text-xs text-muted-foreground";
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className={head}>{t("month")}</TableHead>
          <TableHead className={cn(head, "text-right")}>{t("revenue")}</TableHead>
          <TableHead className={cn(head, "text-right")}>{t("hours")}</TableHead>
          <TableHead className={cn(head, "text-right")}>{t("cumulativeRate")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {[...monthly].reverse().map((m) => (
          <TableRow key={m.month}>
            <TableCell className="capitalize">{fmt.monthLong(m.month)}</TableCell>
            <TableCell className="text-right tabular">{fmt.money(m.revenueCents)}</TableCell>
            <TableCell className="text-right tabular">{fmt.duration(m.minutes)}</TableCell>
            <TableCell className="text-right tabular">{m.cumulativeRateCents === null ? "—" : fmt.rate(m.cumulativeRateCents)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
