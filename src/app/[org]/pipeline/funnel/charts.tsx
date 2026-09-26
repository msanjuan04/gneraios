"use client";

import { ArrowDown, Table2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { type CSSProperties, type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { SERIES_COLOR, TRACK_COLOR } from "./colors";
import { FunnelLink } from "./frame";

/*
 * Gráficas del embudo: barras horizontales en HTML (la forma para comparar magnitudes entre
 * categorías con nombre), con la cifra en la punta de cada barra, tooltip al pasar o enfocar
 * cada fila (que es el área activa, más grande que la marca) y una vista de tabla equivalente.
 * Barras de 16-20 px con la punta redondeada a 4 px y la base recta; sin ejes ni rejilla,
 * porque cada barra lleva su valor. El texto va siempre en tinta de texto, nunca del color
 * de la serie.
 */

export type ConversionRow = { id: string; name: string; color: string; reached: number; conversionToNext: number | null };
export type TimeRow = {
  id: string;
  name: string;
  color: string;
  avgDays: number | null;
  medianDays: number | null;
  samples: number;
};
export type RateRow = { key: string; name: string; won: number; lost: number; rate: number };
export type LossRow = { key: string; name: string; count: number };

/** Hueco a la derecha de las barras para la cifra de la punta: la barra más larga no la saca de la tarjeta. */
const TIP_RESERVE = "4.5rem";
const LABEL_WIDTH = "clamp(5.5rem, 30%, 9rem)";

function useNumbers() {
  const format = useFormatter();
  return {
    count: (value: number) => format.number(value, { useGrouping: "always" }),
    percent: (value: number) => format.number(value, { style: "percent", maximumFractionDigits: 0 }),
    days: (value: number) => format.number(value, { maximumFractionDigits: 1, useGrouping: "always" }),
  };
}

const clampRatio = (value: number) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);

// ---------------------------------------------------------------------------
// Piezas comunes
// ---------------------------------------------------------------------------

function ChartCard({
  title,
  description,
  table,
  footer,
  className,
  children,
}: {
  title: string;
  description?: ReactNode;
  /** La vista de tabla; sin ella (p. ej. sin datos) no hay conmutador. */
  table?: ReactNode;
  footer?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const t = useTranslations("funnel.chart");
  const [asTable, setAsTable] = useState(false);
  return (
    <Card className={cn("gap-5", className)}>
      <CardHeader>
        <CardTitle className="font-semibold">
          <h2>{title}</h2>
        </CardTitle>
        {description && <CardDescription className="text-xs">{description}</CardDescription>}
        {table !== undefined && (
          <CardAction>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("showTable")}
                  aria-pressed={asTable}
                  onClick={() => setAsTable((value) => !value)}
                  className="text-muted-foreground aria-pressed:bg-muted aria-pressed:text-foreground"
                >
                  <Table2 />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("showTable")}</TooltipContent>
            </Tooltip>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        {asTable && table !== undefined ? table : children}
        {footer && <p className="mt-auto text-xs text-muted-foreground">{footer}</p>}
      </CardContent>
    </Card>
  );
}

function ChartEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-32 flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function BarList({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ul aria-label={label} className="-mx-2 space-y-0.5" style={{ "--label-w": LABEL_WIDTH } as CSSProperties}>
      {children}
    </ul>
  );
}

/** Una categoría: su nombre, su marca y el tooltip. La fila entera es el área activa. */
function BarRow({ label, tooltip, children }: { label: string; tooltip: ReactNode; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <li
          tabIndex={0}
          className="group grid grid-cols-[var(--label-w)_minmax(0,1fr)] items-start gap-x-3 rounded-md px-2 py-1 outline-none transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <span className="truncate text-sm leading-5">{label}</span>
          <div className="min-w-0">{children}</div>
        </li>
      </TooltipTrigger>
      <TooltipContent side="top" align="start" sideOffset={2} className="flex-col items-start gap-0.5">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

/** Tooltip: primero el valor, después el nombre y los detalles. */
function TooltipBody({ value, label, details }: { value: string; label: string; details?: (string | null)[] }) {
  return (
    <>
      <span className="text-sm font-semibold tabular">{value}</span>
      <span className="opacity-70">{label}</span>
      {details?.filter(Boolean).map((detail) => (
        <span key={detail} className="tabular">
          {detail}
        </span>
      ))}
    </>
  );
}

function Bar({ ratio, color, value, thick = false }: { ratio: number; color: string; value: string; thick?: boolean }) {
  const share = clampRatio(ratio);
  return (
    <div className="flex h-5 items-center gap-2">
      <div
        aria-hidden
        className={cn(
          "shrink-0 rounded-r-[4px] transition-[filter] group-hover:brightness-110 group-focus-visible:brightness-110",
          thick ? "h-5" : "h-4",
        )}
        style={{ width: `calc((100% - ${TIP_RESERVE}) * ${share})`, minWidth: share > 0 ? 2 : 0, background: color }}
      />
      <span className="shrink-0 text-sm font-semibold tabular">{value}</span>
    </div>
  );
}

type Column<T> = { header: string; cell: (row: T) => ReactNode; numeric?: boolean };

function DataTable<T>({
  caption,
  columns,
  rows,
  rowKey,
}: {
  caption: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
}) {
  return (
    <Table>
      <TableCaption className="sr-only">{caption}</TableCaption>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          {columns.map((column) => (
            <TableHead
              key={column.header}
              className={cn("h-8 text-xs text-muted-foreground", column.numeric && "text-right")}
            >
              {column.header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={rowKey(row)}>
            {columns.map((column) => (
              <TableCell key={column.header} className={cn(column.numeric && "text-right tabular")}>
                {column.cell(row)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// ---------------------------------------------------------------------------
// Conversión por etapa
// ---------------------------------------------------------------------------

export function ConversionCard({
  rows,
  created,
  seeAllHref,
  className,
}: {
  rows: ConversionRow[];
  /** Deals de la cohorte (creados en el periodo). */
  created: number;
  /** Enlace a "Todo" cuando el periodo está vacío; null si ya es todo el histórico. */
  seeAllHref: string | null;
  className?: string;
}) {
  const t = useTranslations("funnel.conversion");
  const tf = useTranslations("funnel");
  const n = useNumbers();
  const first = rows[0];
  const last = rows.at(-1);
  const max = Math.max(1, ...rows.map((row) => row.reached));
  const ofFirst = (row: ConversionRow) => (first && first.reached > 0 ? n.percent(row.reached / first.reached) : "—");
  const toNext = (row: ConversionRow) => (row.conversionToNext === null ? "—" : n.percent(row.conversionToNext));

  if (rows.length === 0 || created === 0) {
    return (
      <ChartCard title={t("title")} description={t("description")} className={className}>
        <ChartEmpty>
          <p>{rows.length === 0 ? t("noStages") : t("empty")}</p>
          {rows.length > 0 && seeAllHref && (
            <FunnelLink href={seeAllHref} className="font-semibold text-primary underline-offset-4 hover:underline">
              {t("seeAll")}
            </FunnelLink>
          )}
        </ChartEmpty>
      </ChartCard>
    );
  }

  const table = (
    <DataTable
      caption={t("title")}
      rows={rows}
      rowKey={(row) => row.id}
      columns={[
        { header: t("colStage"), cell: (row) => row.name },
        { header: t("colDeals"), cell: (row) => n.count(row.reached), numeric: true },
        { header: t("colOfFirst"), cell: ofFirst, numeric: true },
        { header: t("colToNext"), cell: toNext, numeric: true },
      ]}
    />
  );

  return (
    <ChartCard title={t("title")} description={t("description")} table={table} footer={t("footnote")} className={className}>
      {first && last && rows.length > 1 && first.reached > 0 && (
        <p className="text-sm text-muted-foreground">
          {t.rich("overall", {
            rate: n.percent(last.reached / first.reached),
            first: first.name,
            last: last.name,
            strong: (chunks) => <strong className="font-semibold text-foreground tabular">{chunks}</strong>,
          })}
        </p>
      )}
      <BarList label={t("title")}>
        {rows.map((row, index) => {
          const next = rows[index + 1];
          const nextText =
            next && row.conversionToNext !== null ? t("toNext", { rate: toNext(row), stage: next.name }) : null;
          return (
            <BarRow
              key={row.id}
              label={row.name}
              tooltip={
                <TooltipBody
                  value={tf("deals", { count: row.reached })}
                  label={row.name}
                  details={[index > 0 ? t("ofFirst", { rate: ofFirst(row) }) : null, nextText]}
                />
              }
            >
              <Bar ratio={row.reached / max} color={row.color} value={n.count(row.reached)} thick />
              {next && (
                <p className="mt-1 flex h-4 items-center gap-1 text-xs text-muted-foreground tabular">
                  <ArrowDown aria-hidden className="size-3" />
                  <span aria-hidden>{toNext(row)}</span>
                  {nextText && <span className="sr-only">{nextText}</span>}
                </p>
              )}
            </BarRow>
          );
        })}
      </BarList>
    </ChartCard>
  );
}

// ---------------------------------------------------------------------------
// Tiempo medio por etapa
// ---------------------------------------------------------------------------

export function TimeInStageCard({
  rows,
  created,
  className,
}: {
  rows: TimeRow[];
  /** Deals de la cohorte: sin ninguno, el vacío es del periodo y no de falta de historial. */
  created: number;
  className?: string;
}) {
  const t = useTranslations("funnel.time");
  const n = useNumbers();
  const max = Math.max(0, ...rows.map((row) => row.avgDays ?? 0));
  const days = (value: number | null) => (value === null ? "—" : t("days", { days: value }));

  if (!rows.some((row) => row.samples > 0)) {
    return (
      <ChartCard title={t("title")} description={t("description")} className={className}>
        <ChartEmpty>
          <p>{created === 0 ? t("emptyPeriod") : t("empty")}</p>
        </ChartEmpty>
      </ChartCard>
    );
  }

  const table = (
    <DataTable
      caption={t("title")}
      rows={rows}
      rowKey={(row) => row.id}
      columns={[
        { header: t("colStage"), cell: (row) => row.name },
        { header: t("colAverage"), cell: (row) => days(row.avgDays), numeric: true },
        { header: t("colMedian"), cell: (row) => days(row.medianDays), numeric: true },
        { header: t("colSamples"), cell: (row) => n.count(row.samples), numeric: true },
      ]}
    />
  );

  return (
    <ChartCard title={t("title")} description={t("description")} table={table} className={className}>
      <BarList label={t("title")}>
        {rows.map((row) => (
          <BarRow
            key={row.id}
            label={row.name}
            tooltip={
              row.avgDays === null || row.medianDays === null ? (
                <TooltipBody value={t("noData")} label={row.name} />
              ) : (
                <TooltipBody
                  value={t("average", { days: row.avgDays })}
                  label={row.name}
                  details={[t("median", { days: row.medianDays }), t("samples", { count: row.samples })]}
                />
              )
            }
          >
            {row.avgDays === null ? (
              <p className="flex h-5 items-center text-xs text-muted-foreground">{t("noData")}</p>
            ) : (
              <Bar
                ratio={max > 0 ? row.avgDays / max : 0}
                color={row.color}
                value={t("valueShort", { days: n.days(row.avgDays) })}
              />
            )}
          </BarRow>
        ))}
      </BarList>
    </ChartCard>
  );
}

// ---------------------------------------------------------------------------
// Tasa de cierre (por fuente o por socio)
// ---------------------------------------------------------------------------

export function CloseRateCard({ by, rows, className }: { by: "source" | "partner"; rows: RateRow[]; className?: string }) {
  const t = useTranslations("funnel.closeRate");
  const n = useNumbers();
  const title = by === "source" ? t("sourceTitle") : t("partnerTitle");
  const description = by === "source" ? t("sourceDescription") : t("partnerDescription");

  if (rows.length === 0) {
    return (
      <ChartCard title={title} description={description} className={className}>
        <ChartEmpty>
          <p>{t("empty")}</p>
        </ChartEmpty>
      </ChartCard>
    );
  }

  const table = (
    <DataTable
      caption={title}
      rows={rows}
      rowKey={(row) => row.key}
      columns={[
        { header: by === "source" ? t("colSource") : t("colPartner"), cell: (row) => row.name },
        { header: t("colWon"), cell: (row) => n.count(row.won), numeric: true },
        { header: t("colLost"), cell: (row) => n.count(row.lost), numeric: true },
        { header: t("colRate"), cell: (row) => n.percent(row.rate), numeric: true },
      ]}
    />
  );

  return (
    <ChartCard title={title} description={description} table={table} className={className}>
      <BarList label={title}>
        {rows.map((row) => (
          <BarRow
            key={row.key}
            label={row.name}
            tooltip={
              <TooltipBody
                value={n.percent(row.rate)}
                label={row.name}
                details={[t("detail", { won: row.won, lost: row.lost })]}
              />
            }
          >
            <div className="flex h-5 items-center gap-2">
              {/* Medidor: la pista es el 100 % de los cerrados y el relleno, los ganados. */}
              <div aria-hidden className="h-2 min-w-0 flex-1 overflow-hidden rounded-full" style={{ background: TRACK_COLOR }}>
                <div
                  className="h-full rounded-full transition-[filter] group-hover:brightness-110 group-focus-visible:brightness-110"
                  style={{ width: `${clampRatio(row.rate) * 100}%`, background: SERIES_COLOR }}
                />
              </div>
              <span className="min-w-11 shrink-0 text-right text-sm font-semibold tabular">{n.percent(row.rate)}</span>
              <span className="min-w-9 shrink-0 text-right text-xs text-muted-foreground tabular">
                {t("ratio", { won: n.count(row.won), closed: n.count(row.won + row.lost) })}
              </span>
            </div>
          </BarRow>
        ))}
      </BarList>
    </ChartCard>
  );
}

// ---------------------------------------------------------------------------
// Motivos de pérdida
// ---------------------------------------------------------------------------

export function LossReasonsCard({
  rows,
  total,
  className,
}: {
  rows: LossRow[];
  /** Todos los deals perdidos en el periodo (también los que no caben en la lista). */
  total: number;
  className?: string;
}) {
  const t = useTranslations("funnel.loss");
  const tf = useTranslations("funnel");
  const n = useNumbers();
  const max = Math.max(1, ...rows.map((row) => row.count));
  const share = (row: LossRow) => (total > 0 ? n.percent(row.count / total) : "—");
  const others = total - rows.reduce((sum, row) => sum + row.count, 0);

  if (rows.length === 0) {
    return (
      <ChartCard title={t("title")} description={t("description")} className={className}>
        <ChartEmpty>
          <p>{t("empty")}</p>
        </ChartEmpty>
      </ChartCard>
    );
  }

  const table = (
    <DataTable
      caption={t("title")}
      rows={rows}
      rowKey={(row) => row.key}
      columns={[
        { header: t("colReason"), cell: (row) => row.name },
        { header: t("colDeals"), cell: (row) => n.count(row.count), numeric: true },
        { header: t("colShare"), cell: share, numeric: true },
      ]}
    />
  );

  return (
    <ChartCard
      title={t("title")}
      description={t("description")}
      table={table}
      footer={others > 0 ? t("others", { count: others }) : null}
      className={className}
    >
      <BarList label={t("title")}>
        {rows.map((row) => (
          <BarRow
            key={row.key}
            label={row.name}
            tooltip={
              <TooltipBody
                value={tf("deals", { count: row.count })}
                label={row.name}
                details={[t("share", { rate: share(row) })]}
              />
            }
          >
            <Bar ratio={row.count / max} color={SERIES_COLOR} value={n.count(row.count)} />
          </BarRow>
        ))}
      </BarList>
    </ChartCard>
  );
}
