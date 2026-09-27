"use client";

import { useFormatter, useTranslations } from "next-intl";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  type TooltipContentProps,
  XAxis,
  YAxis,
} from "recharts";
import { ChartCard, Legend } from "@/components/dashboard/chart-card";
import { civilToDate, compactMoney, money, signedMoney } from "@/components/dashboard/format";
import { useMounted } from "@/components/dashboard/use-mounted";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CASH_FLOW_KINDS, type CashFlow, type CashFlowKind, type CashForecast } from "@/domain/finance";
import { cn } from "@/lib/utils";
import { AXIS_TEXT, BALANCE, GRID, NEGATIVE, SURFACE } from "./colors";
import { useQuarterLabel } from "./format";
import type { MoneyFormat } from "./types";

/*
 * Previsión de caja a N días: el saldo de cada día (área azul; por debajo de cero, la línea roja
 * de referencia) y el desglose de lo que entra y sale, con los impuestos del trimestre en su
 * plazo. La tabla da el saldo semana a semana y cada flujo con su fecha.
 */

const CHART_HEIGHT = 240;

type Datum = { on: string; balanceCents: number; inflowCents: number; outflowCents: number; flows: CashFlow[] };

function useDay() {
  const format = useFormatter();
  return {
    short: (date: string) => format.dateTime(civilToDate(date), { day: "numeric", month: "short" }),
    long: (date: string) => format.dateTime(civilToDate(date), { weekday: "short", day: "numeric", month: "long" }),
  };
}

function useFlowLabel() {
  const t = useTranslations("finance.overview.forecast");
  const quarter = useQuarterLabel();
  return (flow: CashFlow) =>
    flow.kind === "vat" || flow.kind === "withholding" ? t(`taxLabel.${flow.kind}`, { quarter: quarter(flow.label) }) : flow.label || t(`kinds.${flow.kind}`);
}

function ForecastTooltip({ active, payload, money: fmt }: Partial<TooltipContentProps> & { money: MoneyFormat }) {
  const day = useDay();
  const label = useFlowLabel();
  const t = useTranslations("finance.overview.forecast");
  const datum = payload?.[0]?.payload as Datum | undefined;
  if (!active || !datum) return null;
  return (
    <div className="max-w-72 min-w-56 rounded-lg border bg-popover/95 p-3 text-xs text-popover-foreground shadow-xl backdrop-blur-md">
      <p className="flex items-baseline justify-between gap-3">
        <span className="font-semibold capitalize">{day.long(datum.on)}</span>
        <span className={cn("text-sm font-bold tabular", datum.balanceCents < 0 && "text-destructive")}>{money(datum.balanceCents, fmt)}</span>
      </p>
      {datum.flows.length > 0 ? (
        <ul className="mt-2 space-y-1 border-t pt-2">
          {datum.flows.slice(0, 6).map((flow, i) => (
            <li key={`${flow.kind}-${flow.refId}-${i}`} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{label(flow)}</span>
              <span className={cn("font-semibold tabular", flow.cents < 0 ? "text-foreground" : "text-success")}>{signedMoney(flow.cents, fmt)}</span>
            </li>
          ))}
          {datum.flows.length > 6 && <li className="text-muted-foreground">{t("more", { count: datum.flows.length - 6 })}</li>}
        </ul>
      ) : (
        <p className="mt-1 text-muted-foreground">{t("noFlows")}</p>
      )}
    </div>
  );
}

function FlowsTable({ forecast, money: fmt }: { forecast: CashForecast; money: MoneyFormat }) {
  const t = useTranslations("finance.overview.forecast");
  const day = useDay();
  const label = useFlowLabel();
  const head = "h-8 text-xs text-muted-foreground";
  // Saldo después de cada flujo, en el orden de la tabla.
  const balances = forecast.flows.reduce<number[]>((acc, flow) => [...acc, (acc.at(-1) ?? forecast.startCents) + flow.cents], []);
  return (
    <Table>
      <TableCaption className="sr-only">{t("tableCaption")}</TableCaption>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className={head}>{t("date")}</TableHead>
          <TableHead className={head}>{t("concept")}</TableHead>
          <TableHead className={cn(head, "text-right")}>{t("amount")}</TableHead>
          <TableHead className={cn(head, "text-right")}>{t("balance")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell className="text-muted-foreground">{day.short(forecast.from)}</TableCell>
          <TableCell className="text-muted-foreground">{t("start")}</TableCell>
          <TableCell />
          <TableCell className="text-right font-semibold tabular">{money(forecast.startCents, fmt)}</TableCell>
        </TableRow>
        {forecast.flows.map((flow, i) => {
          const balance = balances[i]!;
          return (
            <TableRow key={`${flow.kind}-${flow.refId}-${i}`}>
              <TableCell className="text-muted-foreground tabular">{day.short(flow.on)}</TableCell>
              <TableCell className="max-w-64">
                <span className="block truncate">{label(flow)}</span>
                <span className="block text-[11px] text-muted-foreground">
                  {t(`kinds.${flow.kind}`)}
                  {flow.overdue && ` · ${t("overdue")}`}
                </span>
              </TableCell>
              <TableCell className={cn("text-right tabular", flow.cents > 0 && "text-success")}>{signedMoney(flow.cents, fmt)}</TableCell>
              <TableCell className={cn("text-right tabular", balance < 0 && "text-destructive")}>{money(balance, fmt)}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/** Desglose con signo: de la caja de hoy a la del final del periodo. */
function Breakdown({ forecast, money: fmt }: { forecast: CashForecast; money: MoneyFormat }) {
  const t = useTranslations("finance.overview.forecast");
  const rows = CASH_FLOW_KINDS.filter((kind) => forecast.byKind[kind] !== 0);
  const overdueIn = forecast.flows.filter((f) => f.overdue && f.cents > 0).reduce((sum, f) => sum + f.cents, 0);
  return (
    <dl className="grid gap-1.5 text-sm">
      <div className="flex items-baseline justify-between gap-3">
        <dt className="text-muted-foreground">{t("start")}</dt>
        <dd className="font-semibold tabular">{money(forecast.startCents, fmt)}</dd>
      </div>
      {rows.map((kind: CashFlowKind) => (
        <div key={kind} className="flex items-baseline justify-between gap-3">
          <dt className="text-muted-foreground">
            {t(`kinds.${kind}`)}
            {kind === "receivable" && overdueIn > 0 && (
              <span className="ml-1 text-xs text-warning">{t("overdueIncluded", { amount: money(overdueIn, fmt) })}</span>
            )}
          </dt>
          <dd className={cn("tabular", forecast.byKind[kind] > 0 && "text-success")}>{signedMoney(forecast.byKind[kind], fmt)}</dd>
        </div>
      ))}
      <div className="mt-1 flex items-baseline justify-between gap-3 border-t pt-2">
        <dt className="font-semibold">{t("end", { days: forecast.days })}</dt>
        <dd className={cn("text-base font-bold tabular", forecast.endCents < 0 && "text-destructive")}>{money(forecast.endCents, fmt)}</dd>
      </div>
    </dl>
  );
}

export function ForecastCard({ forecast, money: fmt, className }: { forecast: CashForecast; money: MoneyFormat; className?: string }) {
  const t = useTranslations("finance.overview.forecast");
  const day = useDay();
  const mounted = useMounted();
  const flowsByDay = new Map<string, CashFlow[]>();
  for (const flow of forecast.flows) flowsByDay.set(flow.on, [...(flowsByDay.get(flow.on) ?? []), flow]);
  const data: Datum[] = forecast.points.map((p) => ({ ...p, flows: flowsByDay.get(p.on) ?? [] }));
  const goesNegative = forecast.minCents < 0;

  return (
    <ChartCard
      title={t("title", { days: forecast.days })}
      description={t("description")}
      className={className}
      legend={
        <Legend
          items={[
            { key: "balance", label: t("balanceLegend"), color: BALANCE, mark: "line" },
            ...(goesNegative ? [{ key: "zero", label: t("zeroLegend"), color: NEGATIVE, mark: "dashed" as const }] : []),
          ]}
        />
      }
      table={<FlowsTable forecast={forecast} money={fmt} />}
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <div style={{ height: CHART_HEIGHT }}>
          {mounted && (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data} margin={{ top: 12, right: 8, bottom: 0, left: 0 }} accessibilityLayer>
                <defs>
                  <linearGradient id="finance-balance-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={BALANCE} stopOpacity={0.28} />
                    <stop offset="100%" stopColor={BALANCE} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke={GRID} />
                <XAxis
                  dataKey="on"
                  tickLine={false}
                  axisLine={{ stroke: GRID }}
                  tick={{ fill: AXIS_TEXT, fontSize: 11 }}
                  tickMargin={8}
                  minTickGap={24}
                  tickFormatter={(date: string) => day.short(date)}
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
                {goesNegative && <ReferenceLine y={0} stroke={NEGATIVE} strokeDasharray="4 4" />}
                <Tooltip content={<ForecastTooltip money={fmt} />} cursor={{ stroke: AXIS_TEXT, strokeOpacity: 0.4 }} isAnimationActive={false} />
                <Area
                  dataKey="balanceCents"
                  name={t("balanceLegend")}
                  type="stepAfter"
                  stroke={BALANCE}
                  strokeWidth={2}
                  fill="url(#finance-balance-fill)"
                  activeDot={{ r: 4, fill: BALANCE, stroke: SURFACE, strokeWidth: 2 }}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="flex flex-col gap-4">
          <Breakdown forecast={forecast} money={fmt} />
          <p className={cn("rounded-lg border px-3 py-2 text-xs", goesNegative ? "border-destructive/30 bg-destructive/10 text-destructive" : "text-muted-foreground")}>
            {goesNegative && forecast.negativeOn
              ? t("negative", { date: day.long(forecast.negativeOn), amount: money(forecast.minCents, fmt) })
              : t("min", { date: day.long(forecast.minOn), amount: money(forecast.minCents, fmt) })}
          </p>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{t("footnote")}</p>
    </ChartCard>
  );
}
