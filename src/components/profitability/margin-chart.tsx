"use client";

import { useTranslations } from "next-intl";
import {
  Bar,
  BarChart,
  type BarShapeProps,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  type TooltipContentProps,
  XAxis,
  YAxis,
} from "recharts";
import { ChartCard, Legend } from "@/components/dashboard/chart-card";
import { AXIS_TEXT, GRID } from "@/components/dashboard/colors";
import { useMounted } from "@/components/dashboard/use-mounted";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { type ClientRow, marginChartClients } from "@/domain/profitability";
import { cn } from "@/lib/utils";
import { useProfitabilityFormat } from "./format";

/*
 * Margen por cliente: barras horizontales desde el cero, una sola serie con su signo (divergente):
 * lo que gana en el azul de marca y lo que pierde en el rojo de estado, a cada lado de la línea del
 * cero, así que el signo se lee también por la dirección. Las barras no pasan de 16 px, con el
 * extremo de datos redondeado (4 px) y el de la base recto. Tooltip por barra y vista de tabla.
 */

/** El nombre de cada cliente en una sola línea (recortado con «…» si no cabe), nunca partido en dos. */
function NameTick({ x, y, payload, names }: { x?: number | string; y?: number | string; payload?: { value?: unknown }; names: ReadonlyMap<string, string> }) {
  const name = names.get(String(payload?.value ?? "")) ?? "";
  const text = name.length > 22 ? `${name.slice(0, 21)}…` : name;
  return (
    <text x={Number(x ?? 0)} y={Number(y ?? 0)} dy={4} textAnchor="end" fill={AXIS_TEXT} fontSize={12}>
      <title>{name}</title>
      {text}
    </text>
  );
}

const POSITIVE = "var(--chart-1)";
const NEGATIVE = "var(--destructive)";
/** Clientes que caben: los de mayor margen en valor absoluto; el resto está en la tabla. */
const LIMIT = 12;
const ROW_HEIGHT = 30;
const AXIS_BAND = 32;
const RADIUS = 4;

type Datum = { id: string; name: string; marginCents: number; marginBps: number | null; revenueCents: number; costCents: number };

/** La barra con el extremo de datos redondeado, sea cual sea el signo (el de la base, recto). */
function MarginBar(props: BarShapeProps) {
  const { x, y, width, height } = props;
  const datum = props.payload as Datum | undefined;
  if (!datum || !Number.isFinite(width) || !Number.isFinite(height) || width === 0 || height <= 0) return null;
  const left = width < 0 ? x + width : x;
  const right = left + Math.abs(width);
  const bottom = y + height;
  const r = Math.min(RADIUS, Math.abs(width), height / 2);
  const d =
    datum.marginCents >= 0
      ? `M${left},${y} H${right - r} A${r},${r} 0 0 1 ${right},${y + r} V${bottom - r} A${r},${r} 0 0 1 ${right - r},${bottom} H${left} Z`
      : `M${right},${y} H${left + r} A${r},${r} 0 0 0 ${left},${y + r} V${bottom - r} A${r},${r} 0 0 0 ${left + r},${bottom} H${right} Z`;
  return <path d={d} fill={datum.marginCents >= 0 ? POSITIVE : NEGATIVE} />;
}

function ChartTooltip({ active, payload }: Partial<TooltipContentProps>) {
  const t = useTranslations("profitability.table");
  const fmt = useProfitabilityFormat();
  const datum = payload?.[0]?.payload as Datum | undefined;
  if (!active || !datum) return null;
  return (
    <div className="min-w-52 rounded-lg border bg-popover/95 p-3 text-xs text-popover-foreground shadow-xl backdrop-blur-md">
      <p className="font-semibold">{datum.name}</p>
      <dl className="mt-2 space-y-1">
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">{t("revenue")}</dt>
          <dd className="font-semibold tabular">{fmt.money(datum.revenueCents)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">{t("cost")}</dt>
          <dd className="font-semibold tabular">{fmt.money(datum.costCents)}</dd>
        </div>
      </dl>
      <p className="mt-2 flex items-center justify-between gap-4 border-t pt-2">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <span aria-hidden className="size-2 rounded-[2px]" style={{ background: datum.marginCents >= 0 ? POSITIVE : NEGATIVE }} />
          {t("margin")}
        </span>
        <span className={cn("font-bold tabular", datum.marginCents < 0 && "text-destructive")}>
          {fmt.money(datum.marginCents)}
          {datum.marginBps !== null && <span className="ml-1 font-medium text-muted-foreground">({fmt.percent(datum.marginBps)})</span>}
        </span>
      </p>
    </div>
  );
}

function MarginTable({ data }: { data: readonly Datum[] }) {
  const t = useTranslations("profitability");
  const fmt = useProfitabilityFormat();
  const head = "h-8 text-xs text-muted-foreground";
  return (
    <Table>
      <TableCaption className="sr-only">{t("chart.tableCaption")}</TableCaption>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className={head}>{t("table.client")}</TableHead>
          <TableHead className={cn(head, "text-right")}>{t("table.revenue")}</TableHead>
          <TableHead className={cn(head, "text-right")}>{t("table.cost")}</TableHead>
          <TableHead className={cn(head, "text-right")}>{t("table.margin")}</TableHead>
          <TableHead className={cn(head, "text-right")}>{t("table.marginShare")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((d) => (
          <TableRow key={d.id}>
            <TableCell className="max-w-56 truncate">{d.name}</TableCell>
            <TableCell className="text-right tabular">{fmt.money(d.revenueCents)}</TableCell>
            <TableCell className="text-right tabular">{fmt.money(d.costCents)}</TableCell>
            <TableCell className={cn("text-right font-semibold tabular", d.marginCents < 0 && "text-destructive")}>{fmt.money(d.marginCents)}</TableCell>
            <TableCell className="text-right text-muted-foreground tabular">{d.marginBps === null ? "—" : fmt.percent(d.marginBps)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function MarginChart({ clients, className }: { clients: readonly ClientRow[]; className?: string }) {
  const t = useTranslations("profitability");
  const fmt = useProfitabilityFormat();
  const mounted = useMounted();
  const { rows, hidden } = marginChartClients(clients, LIMIT);
  const data: Datum[] = rows.map((c) => ({
    id: c.clientId,
    name: c.name ?? t("table.unknownClient"),
    marginCents: c.marginCents,
    marginBps: c.marginBps,
    revenueCents: c.revenueCents,
    costCents: c.costCents,
  }));
  const names = new Map(data.map((d) => [d.id, d.name]));
  const hasNegative = data.some((d) => d.marginCents < 0);
  const hasPositive = data.some((d) => d.marginCents >= 0);
  const height = data.length * ROW_HEIGHT + AXIS_BAND;

  return (
    <ChartCard
      title={t("chart.title")}
      description={t("chart.description")}
      className={className}
      legend={
        hasNegative && hasPositive ? (
          <Legend
            items={[
              { key: "positive", label: t("chart.positive"), color: POSITIVE, mark: "bar" },
              { key: "negative", label: t("chart.negative"), color: NEGATIVE, mark: "bar" },
            ]}
          />
        ) : undefined
      }
      table={<MarginTable data={data} />}
    >
      <div style={{ height }}>
        {mounted && (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 0 }} barCategoryGap="30%" accessibilityLayer>
              <CartesianGrid horizontal={false} stroke={GRID} />
              <XAxis
                type="number"
                tickLine={false}
                axisLine={{ stroke: GRID }}
                tick={{ fill: AXIS_TEXT, fontSize: 11 }}
                tickFormatter={(cents: number) => fmt.compact(cents)}
                domain={[(min: number) => Math.min(0, min), (max: number) => Math.max(0, max)]}
                allowDecimals={false}
              />
              <YAxis
                type="category"
                dataKey="id"
                width={148}
                tickLine={false}
                axisLine={false}
                tick={(props) => <NameTick x={props.x} y={props.y} payload={props.payload} names={names} />}
              />
              <ReferenceLine x={0} stroke={AXIS_TEXT} strokeOpacity={0.6} />
              <Tooltip
                content={<ChartTooltip />}
                cursor={{ fill: "color-mix(in oklab, var(--foreground) 5%, transparent)" }}
                isAnimationActive={false}
              />
              <Bar dataKey="marginCents" name={t("table.margin")} maxBarSize={16} shape={MarginBar} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
      {hidden > 0 && <p className="text-xs text-muted-foreground">{t("chart.hidden", { count: hidden })}</p>}
    </ChartCard>
  );
}
