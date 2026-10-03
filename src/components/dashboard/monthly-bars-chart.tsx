"use client";

import { useFormatter, useTranslations } from "next-intl";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, type TooltipContentProps, XAxis, YAxis } from "recharts";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { MonthlyBar } from "@/server/metrics/monthly-bars";
import { ChartCard } from "./chart-card";
import { AXIS_TEXT, GRID } from "./colors";
import { civilToDate, compactMoney, money } from "./format";
import type { MoneyFormat } from "./types";
import { useMounted } from "./use-mounted";

/*
 * Los dos gráficos del dashboard: lo facturado y lo gastado, mes a mes. Barras simples, la misma
 * forma en los dos para poder compararlos de un vistazo; el mes en curso va más claro porque
 * todavía no ha terminado y su barra va a seguir creciendo.
 */

const CHART_HEIGHT = 190;

type Datum = { month: string; label: string; value: number; current: boolean };

function BarTooltip({ active, payload, format: moneyFormat, inProgress }: Partial<TooltipContentProps> & { format: MoneyFormat; inProgress: string }) {
  const formatter = useFormatter();
  const point = active ? (payload?.[0]?.payload as Datum | undefined) : undefined;
  if (!point) return null;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-sm shadow-md">
      <p className="font-semibold">{formatter.dateTime(civilToDate(point.month), { month: "long", year: "numeric" })}</p>
      <p className="tabular-nums">{money(point.value, moneyFormat)}</p>
      {point.current && <p className="mt-0.5 text-xs text-muted-foreground">{inProgress}</p>}
    </div>
  );
}

export function MonthlyBarsChart({
  kind,
  bars,
  format: moneyFormat,
  className,
}: {
  kind: "invoiced" | "expenses";
  bars: MonthlyBar[];
  format: MoneyFormat;
  className?: string;
}) {
  const t = useTranslations("dashboard.monthly");
  const formatter = useFormatter();
  const mounted = useMounted();
  const valueOf = (bar: MonthlyBar) => (kind === "invoiced" ? bar.invoicedCents : bar.expensesCents);
  const color = kind === "invoiced" ? "var(--chart-1)" : "var(--chart-2)";

  const data = bars.map((bar, index) => ({
    month: bar.month,
    label: formatter.dateTime(civilToDate(bar.month), { month: "short" }),
    value: valueOf(bar),
    current: index === bars.length - 1,
  }));
  const current = data.at(-1);
  const previous = data.at(-2);
  // Lo que llevamos este mes frente al anterior completo: el contexto que falta en una cifra suelta.
  const delta = current && previous && previous.value > 0 ? Math.round(((current.value - previous.value) / previous.value) * 100) : null;

  return (
    <ChartCard
      title={t(`${kind}.title`)}
      description={
        current ? (
          <>
            <span className="text-2xl font-bold tabular-nums text-foreground">{money(current.value, moneyFormat)}</span>{" "}
            <span>{t(`${kind}.hint`)}</span>
            {delta !== null && <> · {t(delta >= 0 ? "vsPreviousUp" : "vsPreviousDown", { percent: Math.abs(delta) })}</>}
          </>
        ) : undefined
      }
      className={className}
      table={
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("month")}</TableHead>
              <TableHead className="text-right">{t(`${kind}.title`)}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((row) => (
              <TableRow key={row.month}>
                <TableCell>{formatter.dateTime(civilToDate(row.month), { month: "long", year: "numeric" })}</TableCell>
                <TableCell className="text-right tabular-nums">{money(row.value, moneyFormat)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      }
    >
      <div style={{ height: CHART_HEIGHT }}>
        {mounted && (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 4 }} barCategoryGap="28%">
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: AXIS_TEXT, fontSize: 12 }} />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={54}
                tick={{ fill: AXIS_TEXT, fontSize: 12 }}
                tickFormatter={(value: number) => compactMoney(value, moneyFormat)}
              />
              <Tooltip
                cursor={{ fill: "color-mix(in oklab, var(--foreground) 5%, transparent)" }}
                isAnimationActive={false}
                content={<BarTooltip format={moneyFormat} inProgress={t("inProgress")} />}
              />
              <Bar dataKey="value" radius={[6, 6, 0, 0]} isAnimationActive={false}>
                {data.map((row) => (
                  <Cell key={row.month} fill={color} fillOpacity={row.current ? 0.45 : 1} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </ChartCard>
  );
}
