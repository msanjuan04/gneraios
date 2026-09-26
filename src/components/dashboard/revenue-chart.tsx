"use client";

import { useFormatter, useTranslations } from "next-intl";
import {
  Bar,
  BarStack,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  type TooltipContentProps,
  XAxis,
  YAxis,
} from "recharts";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { revenueTotal } from "@/domain/metrics";
import { cn } from "@/lib/utils";
import { ChartCard, Legend } from "./chart-card";
import { AXIS_TEXT, GRID, MRR_LINE, SERIES, SURFACE } from "./colors";
import { civilToDate, compactMoney, money } from "./format";
import type { HistoryPoint, MoneyFormat } from "./types";
import { useMounted } from "./use-mounted";

/*
 * Histórico: barras apiladas recurrente / uso / one-off (lo facturado cada mes, base sin IVA)
 * y la línea de MRR al cierre de cada mes, en el mismo eje de euros (una sola escala: las dos
 * son euros al mes). Los meses sin foto mensual se reconstruyen con las líneas de hoy y su
 * tramo de MRR va punteado; el mes en curso termina en un punto hueco con su cifra.
 */

type Datum = HistoryPoint & {
  /** MRR en los tramos entre meses con foto (y el mes en curso); null fuera. */
  mrrSolid: number | null;
  /** MRR en los tramos estimados (reconstruidos), incluidos sus extremos para enlazar. */
  mrrDashed: number | null;
};

const CHART_HEIGHT = 300;

const isSolid = (p: HistoryPoint) => !p.mrrEstimated;

function withSegments(points: readonly HistoryPoint[]): Datum[] {
  return points.map((point, i) => {
    const prev = points[i - 1];
    const next = points[i + 1];
    // Un tramo es continuo si sus dos extremos lo son; si no, va punteado.
    const solidSegment = (a?: HistoryPoint, b?: HistoryPoint) => Boolean(a && b && isSolid(a) && isSolid(b));
    const touchesSolid = solidSegment(prev, point) || solidSegment(point, next);
    const touchesDashed = (prev !== undefined && !solidSegment(prev, point)) || (next !== undefined && !solidSegment(point, next));
    const alone = prev === undefined && next === undefined;
    return {
      ...point,
      mrrSolid: touchesSolid || (alone && isSolid(point)) ? point.mrrCents : null,
      mrrDashed: touchesDashed || (alone && !isSolid(point)) ? point.mrrCents : null,
    };
  });
}

function useMonthLabel() {
  const format = useFormatter();
  return {
    short: (month: string, withYear = false) =>
      format.dateTime(civilToDate(month), withYear ? { month: "short", year: "2-digit" } : { month: "short" }),
    long: (month: string) => format.dateTime(civilToDate(month), { month: "long", year: "numeric" }),
  };
}

function ChartTooltip({ active, payload, money: fmt }: Partial<TooltipContentProps> & { money: MoneyFormat }) {
  const t = useTranslations("dashboard.chart");
  const label = useMonthLabel();
  const datum = payload?.[0]?.payload as Datum | undefined;
  if (!active || !datum) return null;
  const rows = [
    { key: "recurring", label: t("recurring"), cents: datum.recurringCents, color: SERIES.recurring },
    { key: "usage", label: t("usage"), cents: datum.usageCents, color: SERIES.usage },
    { key: "oneOff", label: t("oneOff"), cents: datum.oneOffCents, color: SERIES.oneOff },
  ];
  const state =
    datum.mrrSource === "current" ? t("stateCurrent") : datum.mrrEstimated ? t("stateEstimated") : t("stateSnapshot");
  return (
    <div className="min-w-56 rounded-lg border bg-popover/95 p-3 text-xs text-popover-foreground shadow-xl backdrop-blur-md">
      <p className="flex items-baseline justify-between gap-3">
        <span className="font-semibold capitalize">{label.long(datum.month)}</span>
        <span className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">{state}</span>
      </p>
      <div className="mt-2.5 flex items-center gap-2">
        <svg aria-hidden width="12" height="4" className="shrink-0 overflow-visible">
          <line
            x1="0"
            y1="2"
            x2="12"
            y2="2"
            stroke={MRR_LINE}
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={datum.mrrEstimated ? "3 3" : undefined}
          />
        </svg>
        <span className="text-muted-foreground">{t("mrr")}</span>
        <span className="ml-auto text-sm font-bold tabular">{money(datum.mrrCents, fmt)}</span>
      </div>
      <div className="my-2 h-px bg-border" />
      <ul className="space-y-1.5">
        {rows.map((row) => (
          <li key={row.key} className="flex items-center gap-2">
            <span aria-hidden className="size-2 shrink-0 rounded-[2px]" style={{ background: row.color }} />
            <span className="text-muted-foreground">{row.label}</span>
            <span className={cn("ml-auto font-semibold tabular", row.cents === 0 && "text-muted-foreground")}>
              {money(row.cents, fmt)}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 flex items-center justify-between border-t pt-2 text-muted-foreground">
        <span>{t("invoicedTotal")}</span>
        <span className="font-semibold text-foreground tabular">{money(revenueTotal(datum), fmt)}</span>
      </p>
    </div>
  );
}

function HistoryTable({ data, money: fmt }: { data: readonly HistoryPoint[]; money: MoneyFormat }) {
  const t = useTranslations("dashboard.chart");
  const label = useMonthLabel();
  const head = "h-8 text-xs text-muted-foreground";
  return (
    <Table>
      <TableCaption className="sr-only">{t("tableCaption")}</TableCaption>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className={head}>{t("month")}</TableHead>
          <TableHead className={cn(head, "text-right")}>{t("recurring")}</TableHead>
          <TableHead className={cn(head, "text-right")}>{t("usage")}</TableHead>
          <TableHead className={cn(head, "text-right")}>{t("oneOff")}</TableHead>
          <TableHead className={cn(head, "text-right")}>{t("invoicedTotal")}</TableHead>
          <TableHead className={cn(head, "text-right")}>{t("mrr")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {[...data].reverse().map((row) => (
          <TableRow key={row.month}>
            <TableCell className="capitalize">{label.long(row.month)}</TableCell>
            <TableCell className="text-right tabular">{money(row.recurringCents, fmt)}</TableCell>
            <TableCell className="text-right tabular">{money(row.usageCents, fmt)}</TableCell>
            <TableCell className="text-right tabular">{money(row.oneOffCents, fmt)}</TableCell>
            <TableCell className="text-right font-semibold tabular">{money(revenueTotal(row), fmt)}</TableCell>
            <TableCell className="text-right tabular">
              {money(row.mrrCents, fmt)}
              {row.mrrEstimated && <span className="ml-1 text-muted-foreground">*</span>}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function RevenueChart({
  data,
  money: fmt,
  className,
}: {
  data: readonly HistoryPoint[];
  money: MoneyFormat;
  className?: string;
}) {
  const t = useTranslations("dashboard.chart");
  const label = useMonthLabel();
  const mounted = useMounted();
  const points = withSegments(data);
  const last = points.at(-1);
  const hasEstimated = points.some((p) => p.mrrEstimated);
  const empty = points.every((p) => p.mrrCents === 0 && revenueTotal(p) === 0);

  const legend = (
    <Legend
      items={[
        { key: "recurring", label: t("recurring"), color: SERIES.recurring, mark: "bar" },
        { key: "usage", label: t("usage"), color: SERIES.usage, mark: "bar" },
        { key: "oneOff", label: t("oneOff"), color: SERIES.oneOff, mark: "bar" },
        { key: "mrr", label: t("mrrLegend"), color: MRR_LINE, mark: "line" },
        ...(hasEstimated ? [{ key: "estimated", label: t("mrrEstimated"), color: MRR_LINE, mark: "dashed" as const }] : []),
      ]}
    />
  );

  return (
    <ChartCard
      title={t("title")}
      description={t("description")}
      legend={legend}
      table={<HistoryTable data={data} money={fmt} />}
      className={className}
    >
      <div className="relative" style={{ height: CHART_HEIGHT }}>
        {empty && (
          <p className="absolute inset-0 z-10 flex items-center justify-center text-sm text-muted-foreground">{t("empty")}</p>
        )}
        {mounted && (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={points}
              margin={{ top: 16, right: 12, bottom: 0, left: 0 }}
              stackOffset="sign"
              barCategoryGap="28%"
              accessibilityLayer
            >
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
              <Tooltip
                content={<ChartTooltip money={fmt} />}
                cursor={{ fill: "color-mix(in oklab, var(--foreground) 5%, transparent)" }}
                isAnimationActive={false}
              />
              <BarStack radius={[4, 4, 0, 0]}>
                <Bar dataKey="recurringCents" name={t("recurring")} fill={SERIES.recurring} stroke={SURFACE} strokeWidth={2} maxBarSize={22} animationDuration={600} />
                <Bar dataKey="usageCents" name={t("usage")} fill={SERIES.usage} stroke={SURFACE} strokeWidth={2} maxBarSize={22} animationDuration={600} />
                <Bar dataKey="oneOffCents" name={t("oneOff")} fill={SERIES.oneOff} stroke={SURFACE} strokeWidth={2} maxBarSize={22} animationDuration={600} />
              </BarStack>
              {/* Halo del color de la tarjeta bajo la línea: se lee al cruzar las barras. */}
              {(["mrrSolid", "mrrDashed"] as const).map((key) => (
                <Line
                  key={`halo-${key}`}
                  dataKey={key}
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
              ))}
              <Line
                dataKey="mrrDashed"
                name={t("mrrEstimated")}
                type="monotone"
                stroke={MRR_LINE}
                strokeOpacity={0.7}
                strokeWidth={2}
                strokeDasharray="4 4"
                strokeLinecap="round"
                dot={false}
                activeDot={{ r: 4, fill: MRR_LINE, stroke: SURFACE, strokeWidth: 2 }}
                isAnimationActive={false}
                tooltipType="none"
              />
              <Line
                dataKey="mrrSolid"
                name={t("mrr")}
                type="monotone"
                stroke={MRR_LINE}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                dot={false}
                activeDot={{ r: 4, fill: MRR_LINE, stroke: SURFACE, strokeWidth: 2 }}
                isAnimationActive={false}
                tooltipType="none"
              />
              {last && last.mrrCents > 0 && (
                <ReferenceDot
                  x={last.month}
                  y={last.mrrCents}
                  r={5}
                  fill={SURFACE}
                  stroke={MRR_LINE}
                  strokeWidth={2}
                  label={{
                    value: money(last.mrrCents, fmt),
                    position: "top",
                    offset: 10,
                    fill: "var(--foreground)",
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
      {hasEstimated && <p className="text-xs text-muted-foreground">{t("estimatedNote")}</p>}
    </ChartCard>
  );
}
