"use client";

import { ChartLine, Table2 } from "lucide-react";
import { useTimeZone, useTranslations } from "next-intl";
import { type ReactNode, useMemo, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ReferenceLine, Tooltip, type TooltipContentProps, XAxis, YAxis } from "recharts";
import { SEO_ACCENT, SEO_ACCENT_WASH, SEO_GRID, SEO_TRACK } from "@/components/seo/chart-colors";
import { Button } from "@/components/ui/button";
import { type CheckBucket, HOUR_MS, uptimeRatio } from "@/domain/sites";
import type { SiteFormat } from "./format";

/*
 * La historia de 7 días de una web, por horas, en dos gráficas pequeñas alineadas (mismo eje de
 * fechas, cursor y tooltip sincronizados), nunca un doble eje:
 * - arriba, el tiempo de respuesta medio (una serie, en el azul de marca con un velo de área) y el
 *   umbral de «lenta» cuando la curva se le acerca;
 * - abajo, los fallos de cada hora: una columna por hora con datos, en una pista tenue, y encima, en
 *   color, la parte de comprobaciones que fallaron: ámbar si fue una parte y rojo (toda la columna)
 *   si fue toda la hora. La altura repite lo que dice el color, que en modo claro no basta con
 *   daltonismo (validado con la skill dataviz). Sin datos, nada.
 * Hay vista de tabla equivalente.
 */

const SYNC_ID = "site-history";
const AXIS_WIDTH = 56;
const WARNING = "var(--warning)";
const DOWN = "var(--destructive)";

type Point = {
  start: string;
  total: number;
  ok: number;
  avgMs: number | null;
  maxMs: number | null;
  /** Pila de la tira de fallos (0–1): bien + parcial + caída. */
  okShare: number;
  partialShare: number;
  downShare: number;
};

function toPoints(buckets: readonly CheckBucket[]): Point[] {
  return buckets.map((b) => {
    const failShare = b.total > 0 ? (b.total - b.ok) / b.total : 0;
    const allDown = b.total > 0 && b.ok === 0;
    return {
      start: b.start,
      total: b.total,
      ok: b.ok,
      avgMs: b.avgMs,
      maxMs: b.maxMs,
      okShare: b.total > 0 ? b.ok / b.total : 0,
      partialShare: allDown ? 0 : failShare,
      downShare: allDown ? 1 : 0,
    };
  });
}

function Key({ color, children, shape = "line" }: { color: string; children: ReactNode; shape?: "line" | "box" }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className={shape === "line" ? "h-0.5 w-3.5 rounded-full" : "size-2.5 rounded-[2px]"} style={{ background: color }} />
      {children}
    </span>
  );
}

function TooltipBody({ active, payload, fmt }: TooltipContentProps & { fmt: SiteFormat }) {
  const t = useTranslations("sites.chart");
  if (!active || !payload?.length) return null;
  const point = payload[0]!.payload as Point;
  const end = new Date(new Date(point.start).getTime() + HOUR_MS).toISOString();
  const ratio = uptimeRatio({ total: point.total, ok: point.ok });
  return (
    <div className="min-w-48 rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <p className="mb-1.5 font-semibold">{t("hourRange", { day: fmt.dateTime(point.start), end: fmt.time(end) })}</p>
      {point.total === 0 ? (
        <p className="text-muted-foreground">{t("noData")}</p>
      ) : (
        <>
          <p className="flex items-center justify-between gap-4">
            <Key color={SEO_ACCENT}>{t("avg")}</Key>
            <span className="text-sm font-semibold tabular">{point.avgMs === null ? "—" : fmt.ms(point.avgMs)}</span>
          </p>
          {point.maxMs !== null && (
            <p className="mt-0.5 flex items-center justify-between gap-4 text-muted-foreground">
              <span className="pl-5">{t("max")}</span>
              <span className="tabular">{fmt.ms(point.maxMs)}</span>
            </p>
          )}
          <p className="mt-1 flex items-center justify-between gap-4">
            <Key color={point.ok === point.total ? SEO_TRACK : point.ok === 0 ? DOWN : WARNING} shape="box">
              {t("checks", { ok: point.ok, total: point.total })}
            </Key>
            <span className="font-semibold tabular">{ratio === null ? "—" : fmt.uptime(ratio)}</span>
          </p>
        </>
      )}
    </div>
  );
}

function DataTable({ points, fmt }: { points: Point[]; fmt: SiteFormat }) {
  const t = useTranslations("sites.chart");
  const rows = points.filter((p) => p.total > 0).reverse();
  return (
    <div className="max-h-96 overflow-auto rounded-lg border">
      <table className="w-full text-sm">
        <caption className="sr-only">{t("tableCaption")}</caption>
        <thead className="sticky top-0 bg-card text-xs text-muted-foreground">
          <tr className="border-b">
            <th scope="col" className="px-3 py-2 text-left font-medium">{t("hour")}</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">{t("okChecks")}</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">{t("uptime")}</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">{t("avg")}</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">{t("max")}</th>
          </tr>
        </thead>
        <tbody className="tabular">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                {t("empty")}
              </td>
            </tr>
          ) : (
            rows.map((p) => {
              const ratio = uptimeRatio({ total: p.total, ok: p.ok });
              return (
                <tr key={p.start} className="border-b last:border-0">
                  <th scope="row" className="px-3 py-1.5 text-left font-normal whitespace-nowrap">{fmt.dateTime(p.start)}</th>
                  <td className="px-3 py-1.5 text-right">{t("checks", { ok: p.ok, total: p.total })}</td>
                  <td className={p.ok < p.total ? "px-3 py-1.5 text-right font-semibold text-destructive" : "px-3 py-1.5 text-right"}>
                    {ratio === null ? "—" : fmt.uptime(ratio)}
                  </td>
                  <td className="px-3 py-1.5 text-right">{p.avgMs === null ? "—" : fmt.ms(p.avgMs)}</td>
                  <td className="px-3 py-1.5 text-right text-muted-foreground">{p.maxMs === null ? "—" : fmt.ms(p.maxMs)}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Las horas en punto que empiezan un día (en la zona de la app): las marcas del eje. */
function dayTicks(points: readonly Point[], timeZone: string): string[] {
  const hour = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone });
  return points.filter((p) => hour.format(new Date(p.start)) === "00").map((p) => p.start);
}

export function SiteHistoryChart({ buckets, slowMs, fmt }: { buckets: readonly CheckBucket[]; slowMs: number; fmt: SiteFormat }) {
  const t = useTranslations("sites.chart");
  const timeZone = useTimeZone() ?? "Europe/Madrid";
  const [view, setView] = useState<"chart" | "table">("chart");
  const points = useMemo(() => toPoints(buckets), [buckets]);
  const ticks = useMemo(() => dayTicks(points, timeZone), [points, timeZone]);
  const maxMs = Math.max(0, ...points.map((p) => p.maxMs ?? p.avgMs ?? 0));
  // El umbral solo se dibuja si la curva se le acerca: si no, aplastaría la gráfica.
  const showThreshold = maxMs >= slowMs * 0.6;
  const hasData = points.some((p) => p.total > 0);
  const tick = { fill: "var(--muted-foreground)", fontSize: 11 };
  const dayLabel = (iso: string) => fmt.day(iso);

  return (
    <section className="rounded-2xl border bg-card text-sm">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
        <div className="min-w-0">
          <h3 className="font-bold">{t("title")}</h3>
          <p className="mt-1 text-muted-foreground">{t("description")}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setView(view === "chart" ? "table" : "chart")} aria-pressed={view === "table"}>
          {view === "chart" ? <Table2 data-icon="inline-start" /> : <ChartLine data-icon="inline-start" />}
          {view === "chart" ? t("showTable") : t("showChart")}
        </Button>
      </header>
      <div className="p-5">
        {!hasData ? (
          <p className="py-10 text-center text-muted-foreground">{t("empty")}</p>
        ) : view === "table" ? (
          <DataTable points={points} fmt={fmt} />
        ) : (
          <div className="space-y-3">
            <figure className="min-w-0">
              <figcaption className="mb-1 flex flex-wrap items-baseline gap-x-3 text-xs text-muted-foreground">
                <span className="text-sm font-semibold text-foreground">{t("latencyTitle")}</span>
                {showThreshold && <Key color={WARNING}>{t("slowLine", { value: fmt.ms(slowMs) })}</Key>}
              </figcaption>
              <AreaChart
                responsive
                width="100%"
                height={168}
                data={points}
                syncId={SYNC_ID}
                margin={{ top: 6, right: 6, bottom: 0, left: 0 }}
                accessibilityLayer
              >
                <CartesianGrid vertical={false} stroke={SEO_GRID} strokeWidth={1} />
                <XAxis dataKey="start" hide ticks={ticks} />
                <YAxis
                  width={AXIS_WIDTH}
                  tick={tick}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                  tickFormatter={(v: number) => fmt.ms(v)}
                  domain={[0, showThreshold ? Math.max(maxMs, slowMs) : "auto"]}
                  className="tabular"
                />
                <Tooltip
                  cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1 }}
                  content={(props) => <TooltipBody {...props} fmt={fmt} />}
                  isAnimationActive={false}
                />
                {showThreshold && <ReferenceLine y={slowMs} stroke={WARNING} strokeWidth={1} ifOverflow="extendDomain" />}
                <Area
                  dataKey="avgMs"
                  type="monotone"
                  stroke={SEO_ACCENT}
                  strokeWidth={2}
                  fill={SEO_ACCENT_WASH}
                  dot={false}
                  activeDot={{ r: 4, fill: SEO_ACCENT, stroke: "var(--card)", strokeWidth: 2 }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              </AreaChart>
            </figure>
            <figure className="min-w-0">
              <figcaption className="mb-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                <span className="text-sm font-semibold text-foreground">{t("failuresTitle")}</span>
                <Key color={SEO_TRACK} shape="box">
                  {t("legendOk")}
                </Key>
                <Key color={WARNING} shape="box">
                  {t("legendPartial")}
                </Key>
                <Key color={DOWN} shape="box">
                  {t("legendDown")}
                </Key>
              </figcaption>
              <BarChart
                responsive
                width="100%"
                height={72}
                data={points}
                syncId={SYNC_ID}
                margin={{ top: 2, right: 6, bottom: 0, left: 0 }}
                barCategoryGap={1}
                accessibilityLayer
              >
                <XAxis
                  dataKey="start"
                  ticks={ticks}
                  tickFormatter={dayLabel}
                  tick={tick}
                  tickLine={false}
                  axisLine={{ stroke: SEO_GRID }}
                  interval={0}
                  height={24}
                />
                <YAxis width={AXIS_WIDTH} domain={[0, 1]} tick={false} tickLine={false} axisLine={false} />
                <Tooltip cursor={{ fill: "var(--muted)" }} content={(props) => <TooltipBody {...props} fmt={fmt} />} isAnimationActive={false} />
                <Bar dataKey="okShare" stackId="failures" fill={SEO_TRACK} isAnimationActive={false} />
                <Bar dataKey="partialShare" stackId="failures" fill={WARNING} isAnimationActive={false} />
                <Bar dataKey="downShare" stackId="failures" fill={DOWN} isAnimationActive={false} />
              </BarChart>
            </figure>
          </div>
        )}
      </div>
    </section>
  );
}
