"use client";

import { useFormatter, useTranslations } from "next-intl";
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, type TooltipContentProps, XAxis, YAxis } from "recharts";
import { ChartCard } from "@/components/dashboard/chart-card";
import { AXIS_TEXT, GRID } from "@/components/dashboard/colors";
import { useMounted } from "@/components/dashboard/use-mounted";
import { useFinanceFormat } from "@/components/finance/format";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { type InfraBreakdownRow, topWithOthers } from "@/domain/finance/infrastructure";
import { cn } from "@/lib/utils";

/*
 * Coste mensual por proveedor o por categoría: barras horizontales desde el cero, una sola serie
 * (el azul de marca, --chart-1: el mismo color para todas, porque las categorías no tienen orden),
 * sin leyenda (el título dice lo que se pinta). Barras de 16 px como mucho, con el extremo de datos
 * redondeado (4 px) y el de la base recto, la cifra en la punta, tooltip por barra y vista de tabla.
 * Más de LIMIT filas: el resto se suma en «Otros».
 */

const BAR = "var(--chart-1)";
const LIMIT = 6;
const ROW_HEIGHT = 30;
const AXIS_BAND = 28;
/** Ancho del eje de nombres y lo que cabe en una línea (12 px): el nombre entero, en su título y en la tabla. */
const LABEL_WIDTH = 150;
const LABEL_CHARS = 22;

type Datum = { key: string; label: string; monthlyCents: number; count: number };

/** El nombre de cada barra en una sola línea (recortado con «…» si no cabe), nunca partido en dos. */
function NameTick({ x, y, payload, labels }: { x?: number | string; y?: number | string; payload?: { value?: unknown }; labels: ReadonlyMap<string, string> }) {
  const label = labels.get(String(payload?.value ?? "")) ?? "";
  const text = label.length > LABEL_CHARS ? `${label.slice(0, LABEL_CHARS - 1)}…` : label;
  return (
    <text x={Number(x ?? 0)} y={Number(y ?? 0)} dy={4} textAnchor="end" fill={AXIS_TEXT} fontSize={12}>
      <title>{label}</title>
      {text}
    </text>
  );
}

function ChartTooltip({ active, payload }: Partial<TooltipContentProps>) {
  const t = useTranslations("infrastructure.chart");
  const { money } = useFinanceFormat();
  const datum = payload?.[0]?.payload as Datum | undefined;
  if (!active || !datum) return null;
  return (
    <div className="min-w-44 rounded-lg border bg-popover/95 p-3 text-xs text-popover-foreground shadow-xl backdrop-blur-md">
      <p className="font-semibold">{datum.label}</p>
      <p className="mt-1.5 flex items-center justify-between gap-4">
        <span className="text-muted-foreground">{t("subscriptions", { count: datum.count })}</span>
        <span className="font-bold tabular">{t("perMonth", { amount: money(datum.monthlyCents) })}</span>
      </p>
    </div>
  );
}

function BreakdownTable({ data, caption }: { data: readonly Datum[]; caption: string }) {
  const t = useTranslations("infrastructure.chart");
  const { money } = useFinanceFormat();
  const head = "h-8 text-xs text-muted-foreground";
  return (
    <Table>
      <TableCaption className="sr-only">{caption}</TableCaption>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className={head}>{t("name")}</TableHead>
          <TableHead className={cn(head, "text-right")}>{t("count")}</TableHead>
          <TableHead className={cn(head, "text-right")}>{t("monthly")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((d) => (
          <TableRow key={d.key}>
            <TableCell className="max-w-56 truncate">{d.label}</TableCell>
            <TableCell className="text-right text-muted-foreground tabular">{d.count}</TableCell>
            <TableCell className="text-right font-semibold tabular">{money(d.monthlyCents)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function BreakdownChart({
  title,
  description,
  rows,
  noneLabel,
  className,
}: {
  title: string;
  description: string;
  rows: readonly InfraBreakdownRow[];
  /** El nombre de la fila sin id (sin proveedor). */
  noneLabel: string;
  className?: string;
}) {
  const t = useTranslations("infrastructure.chart");
  const format = useFormatter();
  const mounted = useMounted();
  const compact = (cents: number) => format.number(cents / 100, { style: "currency", currency: "EUR", notation: "compact", maximumFractionDigits: 1 });
  const { rows: top, others } = topWithOthers(rows, LIMIT);
  const data: Datum[] = [
    ...top.map((r) => ({ key: r.id ?? "__none", label: r.name ?? noneLabel, monthlyCents: r.monthlyCents, count: r.count })),
    ...(others ? [{ key: "__others", label: t("others"), monthlyCents: others.monthlyCents, count: others.count }] : []),
  ];
  const labels = new Map(data.map((d) => [d.key, d.label]));
  const height = data.length * ROW_HEIGHT + AXIS_BAND;

  return (
    <ChartCard title={title} description={description} className={className} table={<BreakdownTable data={data} caption={title} />}>
      {data.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <div style={{ height }}>
          {mounted && (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} layout="vertical" margin={{ top: 0, right: 56, bottom: 0, left: 0 }} barCategoryGap="30%" accessibilityLayer>
                <CartesianGrid horizontal={false} stroke={GRID} />
                <XAxis
                  type="number"
                  tickLine={false}
                  axisLine={{ stroke: GRID }}
                  tick={{ fill: AXIS_TEXT, fontSize: 11 }}
                  tickFormatter={(cents: number) => compact(cents)}
                  domain={[0, "auto"]}
                  allowDecimals={false}
                />
                <YAxis
                  type="category"
                  dataKey="key"
                  width={LABEL_WIDTH}
                  tickLine={false}
                  axisLine={false}
                  tick={(props) => <NameTick x={props.x} y={props.y} payload={props.payload} labels={labels} />}
                />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: "color-mix(in oklab, var(--foreground) 5%, transparent)" }} isAnimationActive={false} />
                <Bar dataKey="monthlyCents" name={title} fill={BAR} radius={[0, 4, 4, 0]} maxBarSize={16} isAnimationActive={false}>
                  <LabelList
                    dataKey="monthlyCents"
                    position="right"
                    offset={6}
                    fill={AXIS_TEXT}
                    fontSize={11}
                    formatter={(value) => (typeof value === "number" ? compact(value) : value)}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      )}
    </ChartCard>
  );
}
