"use client";

import { ArrowUpRight, Download, History } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { type ReactNode, useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, type TooltipContentProps, XAxis, YAxis } from "recharts";
import { centsToInput } from "@/app/[org]/invoices/schema";
import { ChartCard, Legend } from "@/components/dashboard/chart-card";
import { AXIS_TEXT, GRID, MOVEMENT, SERIES, SURFACE } from "@/components/dashboard/colors";
import { compactMoney } from "@/components/dashboard/format";
import { useMounted } from "@/components/dashboard/use-mounted";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toCsv } from "@/domain/dataio/csv";
import { HISTORY_GRANULARITIES, type HistoryFigures, type HistoryGranularity, type HistoryRow, revenueOf } from "@/domain/invoicing/history";
import { cn } from "@/lib/utils";
import { useInvoiceFormat } from "./format";
import { InvoicesNav } from "./invoices-nav";

const ALL = "all";
const CHART_HEIGHT = 300;

type Props = {
  basePath: string;
  outboxCount: number;
  granularity: HistoryGranularity;
  rows: HistoryRow[];
  totals: HistoryFigures;
  client: { id: string; name: string } | null;
  clients: { id: string; name: string; archived: boolean }[];
  /** Socio mirando un cliente: se enseñan sus gastos y el margen directo. */
  showCosts: boolean;
};

const COLORS = { billed: SERIES.recurring, collected: SERIES.oneOff, expenses: MOVEMENT.contraction } as const;

/** "2026", "T3 2026" o "septiembre de 2026" (y la versión corta para el eje). */
function usePeriodLabel(granularity: HistoryGranularity) {
  const t = useTranslations("invoices.history");
  const format = useFormatter();
  return (row: Pick<HistoryRow, "key" | "start">, short = false) => {
    if (granularity === "year") return row.key;
    const year = row.key.slice(0, 4);
    if (granularity === "quarter") return t(short ? "quarterShort" : "quarter", { quarter: row.key.slice(6), year: short ? year.slice(2) : year });
    return format.dateTime(new Date(`${row.start}T12:00:00Z`), short ? { month: "short", year: "2-digit", timeZone: "UTC" } : { month: "long", year: "numeric", timeZone: "UTC" });
  };
}

/** Porcentaje entero de una parte sobre un total ("85 %"); sin total, nada. */
function usePercent() {
  const locale = useLocale();
  return (part: number, whole: number) =>
    whole === 0 ? null : new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(part / whole);
}

/**
 * Histórico de facturación: lo facturado (base sin IVA), lo cobrado y lo pendiente por año,
 * trimestre o mes, de toda la org o de un cliente, con sus gastos directos para ver cuánto ha
 * pagado frente a lo que cuesta. Las cifras vienen de `buildHistory` (src/domain/invoicing/history).
 */
export function InvoiceHistory({ basePath, outboxCount, granularity, rows, totals, client, clients, showCosts }: Props) {
  const t = useTranslations("invoices.history");
  const router = useRouter();
  const { money } = useInvoiceFormat();
  const locale = useLocale();
  const label = usePeriodLabel(granularity);
  const percent = usePercent();
  const costs = showCosts && client !== null;
  const withIrpf = rows.some((r) => r.irpfCents !== 0);
  const withReceipts = rows.some((r) => r.receiptsCents !== 0);

  const href = (next: { g?: HistoryGranularity; client?: string | null }) => {
    const params = new URLSearchParams();
    params.set("g", next.g ?? granularity);
    const clientId = next.client === undefined ? client?.id : next.client;
    if (clientId) params.set("client", clientId);
    return `${basePath}/invoices/history?${params.toString()}`;
  };

  const best = useMemo(() => rows.reduce<HistoryRow | null>((top, r) => (revenueOf(r) > (top ? revenueOf(top) : 0) ? r : top), null), [rows]);
  const newestFirst = useMemo(() => [...rows].reverse(), [rows]);

  const columns: { key: string; label: string; value: (f: HistoryFigures) => number; show: boolean }[] = [
    { key: "base", label: t("columns.base"), value: (f) => f.baseCents, show: true },
    { key: "vat", label: t("columns.vat"), value: (f) => f.vatCents, show: true },
    { key: "irpf", label: t("columns.irpf"), value: (f) => -f.irpfCents, show: withIrpf },
    { key: "total", label: t("columns.total"), value: (f) => f.totalCents, show: true },
    { key: "receipts", label: t("columns.receipts"), value: (f) => f.receiptsCents, show: withReceipts },
    { key: "collected", label: t("columns.collected"), value: (f) => f.collectedCents, show: true },
    { key: "outstanding", label: t("columns.outstanding"), value: (f) => f.outstandingCents, show: true },
    { key: "expenses", label: t("columns.expenses"), value: (f) => f.expensesCents, show: costs },
    { key: "margin", label: t("columns.margin"), value: (f) => revenueOf(f) - f.expensesCents, show: costs },
  ];
  const visible = columns.filter((c) => c.show);

  const exportCsv = () => {
    const header = [t("columns.period"), t("columns.invoices"), ...visible.map((c) => c.label)];
    const body = newestFirst.map((r) => [label(r), String(r.invoices), ...visible.map((c) => centsToInput(c.value(r)))]);
    const footer = [t("columns.totalRow"), String(totals.invoices), ...visible.map((c) => centsToInput(c.value(totals)))];
    const blob = new Blob([toCsv([header, ...body, footer], { bom: true })], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${t("fileName")}${client ? `-${client.name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-")}` : ""}-${granularity}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          rows.length > 0 ? (
            <Button variant="outline" size="sm" onClick={exportCsv}>
              <Download data-icon="inline-start" />
              {t("export")}
            </Button>
          ) : undefined
        }
      />
      <InvoicesNav basePath={basePath} outboxCount={outboxCount} />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <nav aria-label={t("granularity")} className="flex gap-1 rounded-full border bg-card/60 p-1">
          {HISTORY_GRANULARITIES.map((g) => (
            <Link
              key={g}
              href={href({ g })}
              scroll={false}
              aria-current={g === granularity ? "page" : undefined}
              className={cn(
                "rounded-full px-3.5 py-1 text-sm font-semibold transition-colors",
                g === granularity ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(`by.${g}`)}
            </Link>
          ))}
        </nav>
        <Select value={client?.id ?? ALL} onValueChange={(value) => router.push(href({ client: value === ALL ? null : value }), { scroll: false })}>
          <SelectTrigger className="w-64 max-w-full" aria-label={t("client")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("allClients")}</SelectItem>
            {clients.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.archived ? t("archivedClient", { name: c.name }) : c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {client && (
          <Link
            href={`${basePath}/clients/${client.id}`}
            className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-foreground"
          >
            {t("openClient")}
            <ArrowUpRight className="size-3.5" />
          </Link>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl border bg-card px-6 py-14 text-center">
          <History className="mx-auto size-6 text-muted-foreground" />
          <p className="mt-3 font-semibold">{client ? t("emptyClient", { client: client.name }) : t("emptyTitle")}</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{t("emptyBody")}</p>
        </div>
      ) : (
        <>
          <p className="mb-2 text-xs text-muted-foreground">{t("since", { period: label(rows[0]!) })}</p>
          <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {withReceipts ? (
              <Stat
                label={t("kpi.revenue")}
                value={money(revenueOf(totals))}
                hint={t("kpi.revenueHint", { billed: money(totals.baseCents), receipts: money(totals.receiptsCents) })}
              />
            ) : (
              <Stat
                label={t("kpi.billed")}
                value={money(totals.baseCents)}
                hint={t("kpi.billedHint", { total: money(totals.totalCents), count: totals.invoices })}
              />
            )}
            <Stat
              label={t("kpi.collected")}
              value={money(totals.collectedCents)}
              hint={
                withReceipts
                  ? t("kpi.collectedReceiptsHint", { receipts: money(totals.receiptsCents) })
                  : percent(totals.collectedCents, totals.totalCents)
                    ? t("kpi.collectedHint", { percent: percent(totals.collectedCents, totals.totalCents)! })
                    : t("kpi.withVat")
              }
            />
            <Stat
              label={t("kpi.outstanding")}
              value={money(totals.outstandingCents)}
              hint={t("kpi.outstandingHint")}
              tone={totals.outstandingCents > 0 ? "warning" : undefined}
            />
            {costs ? (
              <Stat
                label={t("kpi.expenses")}
                value={money(totals.expensesCents)}
                hint={
                  <>
                    {t("kpi.marginHint", {
                      margin: money(revenueOf(totals) - totals.expensesCents),
                      percent: percent(revenueOf(totals) - totals.expensesCents, revenueOf(totals)) ?? "—",
                    })}{" "}
                    <Link href={`${basePath}/finance/profitability`} className="font-semibold text-foreground hover:text-primary">
                      {t("kpi.fullProfitability")}
                    </Link>
                  </>
                }
              />
            ) : (
              <Stat
                label={t(`kpi.best.${granularity}`)}
                value={best ? label(best) : "—"}
                hint={best ? t(withReceipts ? "kpi.bestRevenueHint" : "kpi.bestHint", { amount: money(revenueOf(best)) }) : t("kpi.noBest")}
              />
            )}
          </div>

          <HistoryChart rows={rows} granularity={granularity} costs={costs} locale={locale} />

          <div className="mt-6 overflow-hidden rounded-2xl border bg-card">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="h-9 text-xs text-muted-foreground">{t("columns.period")}</TableHead>
                    <TableHead className="h-9 text-right text-xs text-muted-foreground">{t("columns.invoices")}</TableHead>
                    {visible.map((c) => (
                      <TableHead key={c.key} className="h-9 text-right text-xs whitespace-nowrap text-muted-foreground">
                        {c.label}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {newestFirst.map((r) => (
                    <TableRow key={r.key}>
                      <TableCell className="font-semibold whitespace-nowrap first-letter:uppercase">{label(r)}</TableCell>
                      <TableCell className="text-right tabular">{r.invoices}</TableCell>
                      {visible.map((c) => (
                        <TableCell
                          key={c.key}
                          className={cn(
                            "text-right whitespace-nowrap tabular",
                            c.value(r) === 0 && "text-muted-foreground/60",
                            c.key === "base" && "font-semibold",
                            c.key === "margin" && c.value(r) < 0 && "text-destructive",
                          )}
                        >
                          {money(c.value(r))}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow className="hover:bg-transparent">
                    <TableCell className="font-bold">{t("columns.totalRow")}</TableCell>
                    <TableCell className="text-right font-bold tabular">{totals.invoices}</TableCell>
                    {visible.map((c) => (
                      <TableCell key={c.key} className="text-right font-bold whitespace-nowrap tabular">
                        {money(c.value(totals))}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
            <p className="border-t px-4 py-2.5 text-xs text-muted-foreground">{costs ? t("footnoteCosts") : t("footnote")}</p>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, hint, tone }: { label: ReactNode; value: ReactNode; hint: ReactNode; tone?: "warning" }) {
  return (
    <div className="min-w-0 rounded-2xl border bg-card px-4 py-3.5">
      <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{label}</p>
      <p className={cn("mt-1 truncate text-2xl font-bold tabular heading-tight first-letter:uppercase", tone === "warning" && "text-warning")}>
        {value}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

type Datum = HistoryRow & { label: string; short: string };

function HistoryTooltip({ active, payload, costs }: Partial<TooltipContentProps> & { costs: boolean }) {
  const t = useTranslations("invoices.history");
  const { money } = useInvoiceFormat();
  const datum = payload?.[0]?.payload as Datum | undefined;
  if (!active || !datum) return null;
  const rows = [
    { key: "billed", label: t("chart.billed"), cents: datum.baseCents, color: COLORS.billed },
    { key: "collected", label: t("chart.collected"), cents: datum.collectedBaseCents, color: COLORS.collected },
    ...(costs ? [{ key: "expenses", label: t("chart.expenses"), cents: datum.expensesCents, color: COLORS.expenses }] : []),
  ];
  return (
    <div className="min-w-56 rounded-lg border bg-popover/95 p-3 text-xs text-popover-foreground shadow-xl backdrop-blur-md">
      <p className="font-semibold first-letter:uppercase">{datum.label}</p>
      <ul className="mt-2 space-y-1.5">
        {rows.map((row) => (
          <li key={row.key} className="flex items-center gap-2">
            <span aria-hidden className="size-2 shrink-0 rounded-[2px]" style={{ background: row.color }} />
            <span className="text-muted-foreground">{row.label}</span>
            <span className="ml-auto font-semibold tabular">{money(row.cents)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 flex items-center justify-between gap-3 border-t pt-2 text-muted-foreground">
        <span>{t("chart.invoices", { count: datum.invoices })}</span>
        <span className="tabular">{t("chart.collectedWithVat", { amount: money(datum.collectedCents) })}</span>
      </p>
    </div>
  );
}

function HistoryChart({ rows, granularity, costs, locale }: { rows: HistoryRow[]; granularity: HistoryGranularity; costs: boolean; locale: string }) {
  const t = useTranslations("invoices.history");
  const label = usePeriodLabel(granularity);
  const mounted = useMounted();
  const data: Datum[] = rows.map((r) => ({ ...r, label: label(r), short: label(r, true) }));
  const fmt = { locale, currency: "EUR" };

  return (
    <ChartCard
      title={t("chart.title")}
      description={costs ? t("chart.descriptionCosts") : t("chart.description")}
      legend={
        <Legend
          items={[
            { key: "billed", label: t("chart.billed"), color: COLORS.billed, mark: "bar" },
            { key: "collected", label: t("chart.collected"), color: COLORS.collected, mark: "bar" },
            ...(costs ? [{ key: "expenses", label: t("chart.expenses"), color: COLORS.expenses, mark: "bar" as const }] : []),
          ]}
        />
      }
    >
      <div style={{ height: CHART_HEIGHT }}>
        {mounted && (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 16, right: 12, bottom: 0, left: 0 }} barCategoryGap="22%" barGap={2} accessibilityLayer>
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis
                dataKey="short"
                tickLine={false}
                axisLine={{ stroke: GRID }}
                tick={{ fill: AXIS_TEXT, fontSize: 11 }}
                tickMargin={8}
                minTickGap={8}
                interval="preserveStartEnd"
              />
              <YAxis
                width={60}
                tickLine={false}
                axisLine={false}
                tick={{ fill: AXIS_TEXT, fontSize: 11 }}
                tickFormatter={(cents: number) => compactMoney(cents, fmt)}
                domain={[(min: number) => Math.min(0, min), "auto"]}
                allowDecimals={false}
              />
              <Tooltip
                content={<HistoryTooltip costs={costs} />}
                cursor={{ fill: "color-mix(in oklab, var(--foreground) 5%, transparent)" }}
                isAnimationActive={false}
              />
              <Bar dataKey="baseCents" name={t("chart.billed")} fill={COLORS.billed} stroke={SURFACE} strokeWidth={1} radius={[4, 4, 0, 0]} maxBarSize={28} animationDuration={500} />
              <Bar dataKey="collectedBaseCents" name={t("chart.collected")} fill={COLORS.collected} stroke={SURFACE} strokeWidth={1} radius={[4, 4, 0, 0]} maxBarSize={28} animationDuration={500} />
              {costs && (
                <Bar dataKey="expensesCents" name={t("chart.expenses")} fill={COLORS.expenses} stroke={SURFACE} strokeWidth={1} radius={[4, 4, 0, 0]} maxBarSize={28} animationDuration={500} />
              )}
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </ChartCard>
  );
}
