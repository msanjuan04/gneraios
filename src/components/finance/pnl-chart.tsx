"use client";

import { useFormatter, useTranslations } from "next-intl";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  type TooltipContentProps,
  XAxis,
  YAxis,
} from "recharts";
import { ChartCard, Legend } from "@/components/dashboard/chart-card";
import { civilToDate, compactMoney, money, share } from "@/components/dashboard/format";
import { useMounted } from "@/components/dashboard/use-mounted";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { MonthPnl } from "@/domain/finance";
import { cn } from "@/lib/utils";
import { AXIS_TEXT, EXPENSES, GRID, MARGIN, REVENUE, SURFACE } from "./colors";
import type { MoneyFormat } from "./types";

/*
 * Últimos 12 meses: ingresos (base de lo facturado) y costes (gastos del mes) en barras, lado a
 * lado, y el margen en línea, en el mismo eje de euros. Los meses sin ningún gasto registrado se
 * marcan: su margen no dice nada de los costes.
 */

const CHART_HEIGHT = 300;

function useMonthLabel() {
  const format = useFormatter();
  return {
    short: (month: string, withYear = false) =>
      format.dateTime(civilToDate(month), withYear ? { month: "short", year: "2-digit" } : { month: "short" }),
    long: (month: string) => format.dateTime(civilToDate(month), { month: "long", year: "numeric" }),
  };
}

function ChartTooltip({ active, payload, money: fmt }: Partial<TooltipContentProps> & { money: MoneyFormat }) {
  const t = useTranslations("finance.overview.pnl");
  const label = useMonthLabel();
  const datum = payload?.[0]?.payload as MonthPnl | undefined;
  if (!active || !datum) return null;
  return (
    <div className="min-w-56 rounded-lg border bg-popover/95 p-3 text-xs text-popover-foreground shadow-xl backdrop-blur-md">
      <p className="font-semibold capitalize">{label.long(datum.month)}</p>
      <ul className="mt-2 space-y-1.5">
        <li className="flex items-center gap-2">
          <span aria-hidden className="size-2 shrink-0 rounded-[2px]" style={{ background: REVENUE }} />
          <span className="text-muted-foreground">{t("revenue")}</span>
          <span className="ml-auto font-semibold tabular">{money(datum.revenueCents, fmt)}</span>
        </li>
        <li className="flex items-center gap-2">
          <span aria-hidden className="size-2 shrink-0 rounded-[2px]" style={{ background: EXPENSES }} />
          <span className="text-muted-foreground">{t("expenses")}</span>
          <span className="ml-auto font-semibold tabular">{money(datum.expensesCents, fmt)}</span>
        </li>
      </ul>
      <p className="mt-2 flex items-center justify-between border-t pt-2">
        <span className="text-muted-foreground">{t("margin")}</span>
        <span className={cn("font-bold tabular", datum.marginCents < 0 && "text-destructive")}>
          {money(datum.marginCents, fmt)}
          {datum.marginBps !== null && <span className="ml-1 font-medium text-muted-foreground">({share(datum.marginBps, fmt.locale)})</span>}
        </span>
      </p>
      {!datum.hasExpenses && <p className="mt-1.5 text-muted-foreground">{t("noExpenses")}</p>}
    </div>
  );
}

function PnlTable({ data, money: fmt }: { data: readonly MonthPnl[]; money: MoneyFormat }) {
  const t = useTranslations("finance.overview.pnl");
  const label = useMonthLabel();
  const head = "h-8 text-xs text-muted-foreground";
  return (
    <Table>
      <TableCaption className="sr-only">{t("tableCaption")}</TableCaption>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className={head}>{t("month")}</TableHead>
          <TableHead className={cn(head, "text-right")}>{t("revenue")}</TableHead>
          <TableHead className={cn(head, "text-right")}>{t("expenses")}</TableHead>
          <TableHead className={cn(head, "text-right")}>{t("fixed")}</TableHead>
          <TableHead className={cn(head, "text-right")}>{t("margin")}</TableHead>
          <TableHead className={cn(head, "text-right")}>{t("marginShare")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {[...data].reverse().map((row) => (
          <TableRow key={row.month}>
            <TableCell className="capitalize">
              {label.long(row.month)}
              {!row.hasExpenses && <span className="ml-1 text-muted-foreground">*</span>}
            </TableCell>
            <TableCell className="text-right tabular">{money(row.revenueCents, fmt)}</TableCell>
            <TableCell className="text-right tabular">{money(row.expensesCents, fmt)}</TableCell>
            <TableCell className="text-right text-muted-foreground tabular">{money(row.fixedCents, fmt)}</TableCell>
            <TableCell className={cn("text-right font-semibold tabular", row.marginCents < 0 && "text-destructive")}>
              {money(row.marginCents, fmt)}
            </TableCell>
            <TableCell className="text-right text-muted-foreground tabular">
              {row.marginBps === null ? "—" : share(row.marginBps, fmt.locale)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function PnlChart({ months, money: fmt, className }: { months: readonly MonthPnl[]; money: MoneyFormat; className?: string }) {
  const t = useTranslations("finance.overview.pnl");
  const label = useMonthLabel();
  const mounted = useMounted();
  const empty = months.every((m) => m.revenueCents === 0 && m.expensesCents === 0);
  const withoutExpenses = months.some((m) => !m.hasExpenses && m.revenueCents !== 0);
  const hasNegative = months.some((m) => m.marginCents < 0);

  return (
    <ChartCard
      title={t("title")}
      description={t("description")}
      className={className}
      legend={
        <Legend
          items={[
            { key: "revenue", label: t("revenue"), color: REVENUE, mark: "bar" },
            { key: "expenses", label: t("expenses"), color: EXPENSES, mark: "bar" },
            { key: "margin", label: t("margin"), color: MARGIN, mark: "line" },
          ]}
        />
      }
      table={<PnlTable data={months} money={fmt} />}
    >
      <div className="relative" style={{ height: CHART_HEIGHT }}>
        {empty && <p className="absolute inset-0 z-10 flex items-center justify-center text-sm text-muted-foreground">{t("empty")}</p>}
        {mounted && (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={[...months]} margin={{ top: 16, right: 12, bottom: 0, left: 0 }} barCategoryGap="24%" barGap={3} accessibilityLayer>
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis
                dataKey="month"
                tickLine={false}
                axisLine={{ stroke: GRID }}
                tick={{ fill: AXIS_TEXT, fontSize: 11 }}
                tickMargin={8}
                minTickGap={10}
                interval="preserveStartEnd"
                tickFormatter={(month: string, index: number) => label.short(month, index === 0 || month.slice(5, 7) === "01")}
              />
              <YAxis
                width={56}
                tickLine={false}
                axisLine={false}
                tick={{ fill: AXIS_TEXT, fontSize: 11 }}
                tickFormatter={(cents: number) => compactMoney(cents, fmt)}
                domain={[(min: number) => Math.min(0, min), "auto"]}
                allowDecimals={false}
              />
              {hasNegative && <ReferenceLine y={0} stroke={AXIS_TEXT} strokeOpacity={0.6} />}
              <Tooltip
                content={<ChartTooltip money={fmt} />}
                cursor={{ fill: "color-mix(in oklab, var(--foreground) 5%, transparent)" }}
                isAnimationActive={false}
              />
              <Bar dataKey="revenueCents" name={t("revenue")} fill={REVENUE} radius={[4, 4, 0, 0]} maxBarSize={18} animationDuration={600} />
              <Bar dataKey="expensesCents" name={t("expenses")} fill={EXPENSES} radius={[4, 4, 0, 0]} maxBarSize={18} animationDuration={600} />
              <Line
                dataKey="marginCents"
                type="monotone"
                stroke={SURFACE}
                strokeWidth={6}
                strokeLinecap="round"
                dot={false}
                activeDot={false}
                isAnimationActive={false}
                legendType="none"
                tooltipType="none"
              />
              <Line
                dataKey="marginCents"
                name={t("margin")}
                type="monotone"
                stroke={MARGIN}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                dot={{ r: 2.5, fill: MARGIN, stroke: SURFACE, strokeWidth: 1.5 }}
                activeDot={{ r: 4, fill: MARGIN, stroke: SURFACE, strokeWidth: 2 }}
                isAnimationActive={false}
                tooltipType="none"
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
      {withoutExpenses && <p className="text-xs text-muted-foreground">{t("noExpensesNote")}</p>}
    </ChartCard>
  );
}
