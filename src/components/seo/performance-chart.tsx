"use client";

import { Table2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, Tooltip, type TooltipContentProps, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip as UiTooltip, TooltipContent as UiTooltipContent, TooltipTrigger as UiTooltipTrigger } from "@/components/ui/tooltip";
import type { ChartPoint } from "@/domain/seo";
import { cn } from "@/lib/utils";
import { SEO_ACCENT, SEO_ACCENT_WASH, SEO_GRID, SEO_MUTED } from "./chart-colors";
import { formatCount, formatDay, formatPercent } from "./format";

/*
 * La gráfica principal: clics e impresiones por día como dos gráficas pequeñas alineadas (mismo
 * eje de fechas, cursor y tooltip sincronizados), nunca un doble eje, que inventaría una
 * correlación. El periodo actual va en el azul de marca con un velo de área; el de comparación,
 * en gris y sin relleno. Hay vista de tabla equivalente.
 */

type Metric = "clicks" | "impressions";
const COMPARE_KEY: Record<Metric, "compareClicks" | "compareImpressions"> = { clicks: "compareClicks", impressions: "compareImpressions" };
const SYNC_ID = "seo-performance";

function Key({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className="h-0.5 w-3.5 rounded-full" style={{ background: color }} />
      {children}
    </span>
  );
}

function ChartTooltipBody({ active, payload, metric }: TooltipContentProps & { metric: Metric }) {
  const t = useTranslations("seo.chart");
  const format = useFormatter();
  if (!active || !payload?.length) return null;
  const point = payload[0]!.payload as ChartPoint;
  const current = point[metric];
  const previous = point[COMPARE_KEY[metric]];
  const ctr = point.impressions > 0 ? point.clicks / point.impressions : null;
  return (
    <div className="min-w-44 rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <p className="mb-1.5 font-semibold">{formatDay(format, point.date, true)}</p>
      <p className="flex items-center justify-between gap-4">
        <Key color={SEO_ACCENT}>{t(metric)}</Key>
        <span className="text-sm font-semibold tabular">{formatCount(format, current)}</span>
      </p>
      {metric === "clicks" && ctr !== null && (
        <p className="mt-0.5 flex items-center justify-between gap-4 text-muted-foreground">
          <span className="pl-5">{t("ctr")}</span>
          <span className="tabular">{formatPercent(format, ctr, 1)}</span>
        </p>
      )}
      {previous !== null && point.compareDate && (
        <p className="mt-1 flex items-center justify-between gap-4 text-muted-foreground">
          <Key color={SEO_MUTED}>{formatDay(format, point.compareDate, true)}</Key>
          <span className="font-semibold tabular">{formatCount(format, previous)}</span>
        </p>
      )}
    </div>
  );
}

function Panel({ metric, points, comparable, showAxis }: { metric: Metric; points: ChartPoint[]; comparable: boolean; showAxis: boolean }) {
  const t = useTranslations("seo.chart");
  const format = useFormatter();
  const total = points.reduce((sum, p) => sum + p[metric], 0);
  const compareTotal = comparable ? points.reduce((sum, p) => sum + (p[COMPARE_KEY[metric]] ?? 0), 0) : null;
  const tick = { fill: "var(--muted-foreground)", fontSize: 11 };

  return (
    <figure className="min-w-0">
      <figcaption className="mb-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm">
        <span className="font-semibold">{t(metric)}</span>
        <Key color={SEO_ACCENT}>
          <span className="font-semibold tabular">{formatCount(format, total)}</span>
        </Key>
        {compareTotal !== null && (
          <span className="text-xs text-muted-foreground">
            <Key color={SEO_MUTED}>
              <span className="tabular">{t("compareTotal", { value: formatCount(format, compareTotal) })}</span>
            </Key>
          </span>
        )}
      </figcaption>
      <ComposedChart
        responsive
        width="100%"
        height={showAxis ? 168 : 144}
        data={points}
        syncId={SYNC_ID}
        margin={{ top: 6, right: 6, bottom: 0, left: 0 }}
        accessibilityLayer
      >
        <CartesianGrid vertical={false} stroke={SEO_GRID} strokeWidth={1} />
        <XAxis
          dataKey="date"
          hide={!showAxis}
          tickFormatter={(date: string) => formatDay(format, date)}
          tick={tick}
          tickLine={false}
          axisLine={{ stroke: SEO_GRID }}
          minTickGap={28}
          interval="preserveStartEnd"
          height={24}
        />
        <YAxis
          width={48}
          tick={tick}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
          tickFormatter={(v: number) => formatCount(format, v, v >= 10_000)}
          className="tabular"
        />
        <Tooltip
          cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1 }}
          content={(props) => <ChartTooltipBody {...props} metric={metric} />}
          isAnimationActive={false}
        />
        {comparable && (
          <Line
            dataKey={COMPARE_KEY[metric]}
            type="monotone"
            stroke={SEO_MUTED}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: SEO_MUTED, stroke: "var(--card)", strokeWidth: 2 }}
            isAnimationActive={false}
          />
        )}
        <Area
          dataKey={metric}
          type="monotone"
          stroke={SEO_ACCENT}
          strokeWidth={2}
          fill={SEO_ACCENT_WASH}
          dot={false}
          activeDot={{ r: 4, fill: SEO_ACCENT, stroke: "var(--card)", strokeWidth: 2 }}
          isAnimationActive={false}
        />
      </ComposedChart>
    </figure>
  );
}

function DataTable({ points, comparable }: { points: ChartPoint[]; comparable: boolean }) {
  const t = useTranslations("seo.chart");
  const format = useFormatter();
  return (
    <div className="max-h-96 overflow-auto rounded-lg border">
      <table className="w-full text-sm">
        <caption className="sr-only">{t("tableCaption")}</caption>
        <thead className="sticky top-0 bg-card text-xs text-muted-foreground">
          <tr className="border-b">
            <th scope="col" className="px-3 py-2 text-left font-medium">{t("day")}</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">{t("clicks")}</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">{t("impressions")}</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">{t("ctr")}</th>
            {comparable && <th scope="col" className="px-3 py-2 text-right font-medium">{t("compareClicks")}</th>}
            {comparable && <th scope="col" className="px-3 py-2 text-right font-medium">{t("compareImpressions")}</th>}
          </tr>
        </thead>
        <tbody className="tabular">
          {[...points].reverse().map((p) => (
            <tr key={p.date} className="border-b last:border-0">
              <th scope="row" className="px-3 py-1.5 text-left font-normal whitespace-nowrap">{formatDay(format, p.date, true)}</th>
              <td className="px-3 py-1.5 text-right">{formatCount(format, p.clicks)}</td>
              <td className="px-3 py-1.5 text-right">{formatCount(format, p.impressions)}</td>
              <td className="px-3 py-1.5 text-right">{p.impressions > 0 ? formatPercent(format, p.clicks / p.impressions, 1) : "—"}</td>
              {comparable && <td className="px-3 py-1.5 text-right text-muted-foreground">{p.compareClicks === null ? "—" : formatCount(format, p.compareClicks)}</td>}
              {comparable && (
                <td className="px-3 py-1.5 text-right text-muted-foreground">
                  {p.compareImpressions === null ? "—" : formatCount(format, p.compareImpressions)}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PerformanceChart({
  points,
  comparable,
  rangeLabel,
  compareLabel,
  className,
}: {
  points: ChartPoint[];
  comparable: boolean;
  rangeLabel: string;
  compareLabel: string | null;
  className?: string;
}) {
  const t = useTranslations("seo.chart");
  const [asTable, setAsTable] = useState(false);

  return (
    <Card className={cn("gap-4", className)}>
      <CardHeader>
        <CardTitle className="font-semibold">
          <h2>{t("title")}</h2>
        </CardTitle>
        <CardDescription className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <Key color={SEO_ACCENT}>{rangeLabel}</Key>
          {comparable && compareLabel && <Key color={SEO_MUTED}>{compareLabel}</Key>}
        </CardDescription>
        <CardAction>
          <UiTooltip>
            <UiTooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("showTable")}
                aria-pressed={asTable}
                onClick={() => setAsTable((v) => !v)}
                className="text-muted-foreground aria-pressed:bg-muted aria-pressed:text-foreground"
              >
                <Table2 />
              </Button>
            </UiTooltipTrigger>
            <UiTooltipContent>{t("showTable")}</UiTooltipContent>
          </UiTooltip>
        </CardAction>
      </CardHeader>
      <CardContent>
        {points.length === 0 ? (
          <div className="flex min-h-40 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
            {t("empty")}
          </div>
        ) : asTable ? (
          <DataTable points={points} comparable={comparable} />
        ) : (
          <div className="space-y-4">
            <Panel metric="clicks" points={points} comparable={comparable} showAxis={false} />
            <Panel metric="impressions" points={points} comparable={comparable} showAxis />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
