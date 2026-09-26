"use client";

import { useFormatter, useTranslations } from "next-intl";
import type { CSSProperties } from "react";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { addMonths, mrrBridge, type MonthMovements } from "@/domain/metrics";
import { cn } from "@/lib/utils";
import { ChartCard } from "./chart-card";
import { MOVEMENT, TRACK } from "./colors";
import { civilToDate, money, signedMoney, signedPercent } from "./format";
import type { MoneyFormat } from "./types";

/*
 * Puente de MRR: del cierre del mes anterior a la ventana hasta hoy, cuánto entró por clientes
 * nuevos y expansión y cuánto se fue por contracción y churn. Barras horizontales flotantes en
 * HTML (como el embudo): cada fila lleva su nombre y su cifra, y el tooltip explica qué cuenta.
 * inicio + nuevo + expansión − contracción − churn (+ ajustes) = hoy, al céntimo.
 */

type Kind = "level" | "new" | "expansion" | "contraction" | "churn" | "adjustment";
type Row = { key: string; kind: Kind; label: string; hint: string; from: number; to: number; value: number; signed: boolean };

const COLOR: Record<Kind, string> = {
  level: MOVEMENT.level,
  new: MOVEMENT.new,
  expansion: MOVEMENT.expansion,
  contraction: MOVEMENT.contraction,
  churn: MOVEMENT.churn,
  adjustment: MOVEMENT.adjustment,
};

function MonthsTable({ movements, money: fmt }: { movements: readonly MonthMovements[]; money: MoneyFormat }) {
  const t = useTranslations("dashboard.bridge");
  const format = useFormatter();
  const head = "h-8 text-xs text-muted-foreground";
  const hasAdjustments = movements.some((m) => m.adjustmentCents !== 0);
  return (
    <Table>
      <TableCaption className="sr-only">{t("tableCaption")}</TableCaption>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className={head}>{t("month")}</TableHead>
          <TableHead className={cn(head, "text-right")}>{t("new")}</TableHead>
          <TableHead className={cn(head, "text-right")}>{t("expansion")}</TableHead>
          <TableHead className={cn(head, "text-right")}>{t("contraction")}</TableHead>
          <TableHead className={cn(head, "text-right")}>{t("churn")}</TableHead>
          {hasAdjustments && <TableHead className={cn(head, "text-right")}>{t("adjustment")}</TableHead>}
          <TableHead className={cn(head, "text-right")}>{t("endShort")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {[...movements].reverse().map((m) => (
          <TableRow key={m.month}>
            <TableCell className="capitalize">
              {format.dateTime(civilToDate(m.month), { month: "short", year: "numeric" })}
              {m.estimated && <span className="ml-1 text-muted-foreground">*</span>}
            </TableCell>
            <TableCell className="text-right tabular">{m.newCents ? signedMoney(m.newCents, fmt) : "—"}</TableCell>
            <TableCell className="text-right tabular">{m.expansionCents ? signedMoney(m.expansionCents, fmt) : "—"}</TableCell>
            <TableCell className="text-right tabular">{m.contractionCents ? signedMoney(-m.contractionCents, fmt) : "—"}</TableCell>
            <TableCell className="text-right tabular">{m.churnCents ? signedMoney(-m.churnCents, fmt) : "—"}</TableCell>
            {hasAdjustments && (
              <TableCell className="text-right tabular">{m.adjustmentCents ? signedMoney(m.adjustmentCents, fmt) : "—"}</TableCell>
            )}
            <TableCell className="text-right font-semibold tabular">{money(m.endCents, fmt)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function MovementsBridge({
  movements,
  money: fmt,
  className,
}: {
  /** Los meses de la ventana, en orden; el último es el mes en curso. */
  movements: readonly MonthMovements[];
  money: MoneyFormat;
  className?: string;
}) {
  const t = useTranslations("dashboard.bridge");
  const format = useFormatter();
  const bridge = mrrBridge(movements, movements.length);
  const first = movements[0];
  const startLabel = first
    ? t("start", { month: format.dateTime(civilToDate(addMonths(first.month, -1)), { month: "short", year: "numeric" }) })
    : t("startEmpty");

  const rows: Row[] = [];
  let level = bridge.startCents;
  rows.push({ key: "start", kind: "level", label: startLabel, hint: t("startHint"), from: 0, to: level, value: level, signed: false });
  const step = (kind: Kind, delta: number, label: string, hint: string) => {
    const next = level + delta;
    rows.push({ key: kind, kind, label, hint, from: Math.min(level, next), to: Math.max(level, next), value: delta, signed: true });
    level = next;
  };
  step("new", bridge.newCents, t("new"), t("newHint"));
  step("expansion", bridge.expansionCents, t("expansion"), t("expansionHint"));
  step("contraction", -bridge.contractionCents, t("contraction"), t("contractionHint"));
  step("churn", -bridge.churnCents, t("churn"), t("churnHint"));
  if (bridge.adjustmentCents !== 0) step("adjustment", bridge.adjustmentCents, t("adjustment"), t("adjustmentHint"));
  rows.push({ key: "end", kind: "level", label: t("end"), hint: t("endHint"), from: 0, to: bridge.endCents, value: bridge.endCents, signed: false });

  const max = Math.max(1, ...rows.map((r) => r.to));
  const net = bridge.endCents - bridge.startCents;
  const growth = bridge.startCents > 0 ? net / bridge.startCents : null;
  const pct = (cents: number) => `${(Math.max(0, cents) / max) * 100}%`;

  return (
    <ChartCard
      title={t("title")}
      description={t("description", { months: bridge.months })}
      table={<MonthsTable movements={movements} money={fmt} />}
      className={className}
    >
      <p className="text-sm text-muted-foreground">
        {t.rich("net", {
          amount: signedMoney(net, fmt),
          growth: growth === null ? "" : signedPercent(growth, fmt.locale),
          hasGrowth: growth === null ? "no" : "yes",
          strong: (chunks) => <strong className="font-semibold text-foreground tabular">{chunks}</strong>,
        })}
      </p>
      <ul aria-label={t("title")} className="-mx-2 space-y-0.5" style={{ "--label-w": "clamp(5.5rem, 34%, 8.5rem)" } as CSSProperties}>
        {rows.map((row) => (
          <Tooltip key={row.key}>
            <TooltipTrigger asChild>
              <li
                tabIndex={0}
                className="group grid grid-cols-[var(--label-w)_minmax(0,1fr)_auto] items-center gap-x-3 rounded-md px-2 py-1.5 outline-none transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <span className={cn("truncate text-sm leading-5", row.kind === "level" && "font-semibold")}>{row.label}</span>
                <span className="relative h-5">
                  <span aria-hidden className="absolute inset-y-[9px] right-0 left-0 rounded-full" style={{ background: TRACK }} />
                  <span
                    aria-hidden
                    className="absolute inset-y-0 rounded-[4px] transition-[filter] group-hover:brightness-110 group-focus-visible:brightness-110"
                    style={{
                      left: pct(row.from),
                      width: pct(row.to - row.from),
                      minWidth: row.value !== 0 ? 3 : 0,
                      background: COLOR[row.kind],
                    }}
                  />
                </span>
                <span
                  className={cn(
                    "min-w-[4.5rem] text-right text-sm tabular",
                    row.kind === "level" ? "font-bold" : "font-semibold",
                    row.signed && row.value === 0 && "text-muted-foreground",
                  )}
                >
                  {row.signed ? (row.value === 0 ? "—" : signedMoney(row.value, fmt)) : money(row.value, fmt)}
                </span>
              </li>
            </TooltipTrigger>
            <TooltipContent side="top" align="start" sideOffset={2} className="max-w-64 flex-col items-start gap-0.5">
              <span className="text-sm font-semibold tabular">
                {row.signed ? signedMoney(row.value, fmt) : money(row.value, fmt)}
              </span>
              <span className="opacity-70">{row.label}</span>
              <span>{row.hint}</span>
            </TooltipContent>
          </Tooltip>
        ))}
      </ul>
      {bridge.estimated && <p className="mt-auto text-xs text-muted-foreground">{t("estimatedNote")}</p>}
    </ChartCard>
  );
}
