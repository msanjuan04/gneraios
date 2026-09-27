// Ingresos y MRR (ARCHITECTURE.md §7.8): get_revenue, get_mrr_history, get_churn y get_nrr.
// Reutilizan las definiciones versionadas de src/domain/metrics; aquí solo se eligen los periodos
// y se ponen nombre a las cifras.

import { z } from "zod";
import { addDays, compareCivil } from "@/domain/dates/civil-date";
import {
  addMonths,
  arrCents,
  METRICS_DEFINITION_VERSION,
  monthEnd,
  monthOf,
  monthRange,
  monthsEndingAt,
  movementsHistory,
  mrrBridge,
  mrrHistory,
  revenueByMonth,
  type Month,
  type MonthRevenue,
  type SnapshotLike,
  twelfthsToCents,
} from "@/domain/metrics";
import { changeBps, clientHref, hasPausedLineOn, linesByClient, m, mrrTwelfthsOn, shareBps } from "./common";
import { formatMetricValue, monthLabel, monthPeriod, rangePeriod } from "./format";
import { defineTool, type Metric, type ToolContext, type ToolRow } from "./types";

const REVENUE_SOURCE =
  "Facturas emitidas: base imponible sin IVA por mes de emisión (vista revenue_by_month); las rectificativas restan en su mes.";
const MRR_SOURCE = `Líneas de contratos firmados (definición v${METRICS_DEFINITION_VERSION} del MRR: mensuales + anuales / 12, sin IVA ni pausas) y fotos mensuales (metrics_snapshots).`;

const CATEGORIES = [
  { field: "recurringCents", key: "recurring", label: "Ingresos recurrentes" },
  { field: "usageCents", key: "usage", label: "Ingresos por uso" },
  { field: "oneOffCents", key: "one_off", label: "Ingresos one-off" },
] as const satisfies readonly { field: keyof Omit<MonthRevenue, "month">; key: string; label: string }[];

const monthsInput = (max: number, fallback: number) =>
  z.object({ months: z.number().int().min(1).max(max).default(fallback).describe("Meses hacia atrás, incluido el actual") }).strict();

export const getRevenue = defineTool({
  name: "get_revenue",
  description:
    "Ingresos por mes (base imponible sin IVA de las facturas emitidas), SIEMPRE separados en recurrente, uso y one-off. Incluye el último mes cerrado frente al anterior y al mismo mes del año pasado, y los últimos 12 meses cerrados por categoría. El mes en curso va hasta hoy.",
  input: monthsInput(24, 12),
  async run(ctx, { months }) {
    const current = monthOf(ctx.today);
    const reference = addMonths(current, -1);
    const window = monthsEndingAt(current, months);
    const from = compareCivil(window[0]!, addMonths(reference, -12)) < 0 ? window[0]! : addMonths(reference, -12);
    const all = revenueByMonth(await ctx.data.revenueRows(from, current), monthRange(from, current));
    const byMonth = new Map(all.map((r) => [r.month, r]));
    const get = (month: Month) => byMonth.get(month)!;

    const metrics: Metric[] = [];
    for (const month of window) {
      const revenue = get(month);
      const partial = month === current ? " (en curso)" : "";
      for (const c of CATEGORIES) {
        metrics.push(m.eur(`revenue.${monthPeriod(month)}.${c.key}`, `${c.label} · ${monthLabel(month)}${partial}`, revenue[c.field], monthPeriod(month)));
      }
      metrics.push(
        m.eur(
          `revenue.${monthPeriod(month)}.total`,
          `Ingresos totales (suma de las tres) · ${monthLabel(month)}${partial}`,
          revenue.recurringCents + revenue.usageCents + revenue.oneOffCents,
          monthPeriod(month),
        ),
      );
    }

    const previous = get(addMonths(reference, -1));
    const yearAgo = get(addMonths(reference, -12));
    const ref = get(reference);
    for (const c of CATEGORIES) {
      const vsPrev = changeBps(ref[c.field], previous[c.field]);
      if (vsPrev !== null) {
        metrics.push(m.bps(`revenue.${monthPeriod(reference)}.${c.key}.vs_previous`, `${c.label}: ${monthLabel(reference)} frente a ${monthLabel(addMonths(reference, -1))}`, vsPrev, monthPeriod(reference)));
      }
      const vsYear = changeBps(ref[c.field], yearAgo[c.field]);
      if (vsYear !== null) {
        metrics.push(m.bps(`revenue.${monthPeriod(reference)}.${c.key}.vs_year`, `${c.label}: ${monthLabel(reference)} frente a ${monthLabel(addMonths(reference, -12))}`, vsYear, monthPeriod(reference)));
      }
    }

    const ttmMonths = monthsEndingAt(reference, 12);
    const ttmPeriod = rangePeriod(ttmMonths[0]!, monthEnd(reference));
    for (const c of CATEGORIES) {
      const total = ttmMonths.reduce((sum, month) => sum + (byMonth.get(month)?.[c.field] ?? 0), 0);
      metrics.push(m.eur(`revenue.ttm.${c.key}`, `${c.label} de los últimos 12 meses cerrados`, total, ttmPeriod));
    }

    const fmt = (cents: number) => formatMetricValue(cents, "eur_cents");
    return {
      tool: "get_revenue",
      status: "ok",
      subject: "revenue",
      period: { from: window[0]!, to: ctx.today },
      source: REVENUE_SOURCE,
      href: "/",
      summary: `${monthLabel(reference)}: recurrente ${fmt(ref.recurringCents)}, uso ${fmt(ref.usageCents)} y one-off ${fmt(ref.oneOffCents)} (base sin IVA).`,
      metrics,
      notes: ["El total solo se enseña junto a su desglose: recurrente, uso y one-off nunca se mezclan en una métrica."],
    };
  },
});

async function loadHistory(ctx: ToolContext, window: Month[]) {
  const lines = await ctx.data.contractLines();
  const snapshots = await ctx.data.snapshots(addMonths(window[0]!, -1), window.at(-1)!);
  const byMonth = new Map<Month, SnapshotLike>(snapshots.map((s) => [s.month, s]));
  return { lines, byMonth };
}

export const getMrrHistory = defineTool({
  name: "get_mrr_history",
  description:
    "MRR (ingreso recurrente mensual, sin IVA) al cierre de cada mes y hoy, ARR, y los movimientos de cada mes: nuevo, expansión, contracción y churn, con el puente del periodo (inicio + movimientos + ajustes = final). Los meses sin foto se reconstruyen y van marcados como estimados.",
  input: monthsInput(24, 12),
  async run(ctx, { months }) {
    const current = monthOf(ctx.today);
    const window = monthsEndingAt(current, months);
    const { lines, byMonth } = await loadHistory(ctx, window);
    const points = mrrHistory(window, byMonth, lines, ctx.today);
    const movements = movementsHistory(window, byMonth, lines, ctx.today);
    const bridge = mrrBridge(movements, window.length);
    const now = points.at(-1)!;

    const metrics: Metric[] = [
      m.eur("mrr.current", "MRR hoy", now.mrrCents, ctx.today),
      m.eur("arr.current", "ARR hoy (MRR × 12)", arrCents(now.mrrCents), ctx.today),
    ];
    for (const [i, point] of points.entries()) {
      if (point.source === "current") continue;
      const estimated = point.estimated ? " (estimado)" : "";
      metrics.push(m.eur(`mrr.${monthPeriod(point.month)}`, `MRR al cierre de ${monthLabel(point.month)}${estimated}`, point.mrrCents, monthPeriod(point.month)));
      const mv = movements[i]!;
      metrics.push(
        m.eur(`mrr.${monthPeriod(point.month)}.new`, `MRR nuevo · ${monthLabel(point.month)}`, mv.newCents, monthPeriod(point.month)),
        m.eur(`mrr.${monthPeriod(point.month)}.expansion`, `Expansión de MRR · ${monthLabel(point.month)}`, mv.expansionCents, monthPeriod(point.month)),
        m.eur(`mrr.${monthPeriod(point.month)}.contraction`, `Contracción de MRR · ${monthLabel(point.month)}`, mv.contractionCents, monthPeriod(point.month)),
        m.eur(`mrr.${monthPeriod(point.month)}.churn`, `Churn de MRR · ${monthLabel(point.month)}`, mv.churnCents, monthPeriod(point.month)),
      );
    }
    const period = rangePeriod(addDays(window[0]!, -1), ctx.today);
    metrics.push(
      m.eur("mrr.bridge.start", `MRR al empezar el periodo (cierre de ${monthLabel(addMonths(window[0]!, -1))})`, bridge.startCents, period),
      m.eur("mrr.bridge.new", "MRR nuevo en el periodo", bridge.newCents, period),
      m.eur("mrr.bridge.expansion", "Expansión de MRR en el periodo", bridge.expansionCents, period),
      m.eur("mrr.bridge.contraction", "Contracción de MRR en el periodo", bridge.contractionCents, period),
      m.eur("mrr.bridge.churn", "Churn de MRR en el periodo", bridge.churnCents, period),
      m.eur("mrr.bridge.adjustments", "Ajustes (cambios con efecto atrasado)", bridge.adjustmentCents, period),
    );
    const estimated = points.filter((p) => p.estimated).map((p) => monthLabel(p.month));
    return {
      tool: "get_mrr_history",
      status: "ok",
      subject: "mrr",
      period: { from: addDays(window[0]!, -1), to: ctx.today },
      source: MRR_SOURCE,
      href: "/",
      summary: `MRR hoy: ${formatMetricValue(now.mrrCents, "eur_cents")}.`,
      metrics,
      notes: estimated.length > 0 ? [`Meses reconstruidos (estimados): ${estimated.join(", ")}.`] : [],
    };
  },
});

export const getChurn = defineTool({
  name: "get_churn",
  description:
    "Churn del periodo: MRR perdido por bajas (churn) y por bajadas (contracción), tasa de churn bruta sobre el MRR inicial y los clientes que se han ido (tenían MRR al empezar y hoy no tienen nada activo ni en pausa), con el MRR que se llevaron.",
  input: monthsInput(24, 12),
  async run(ctx, { months }) {
    const current = monthOf(ctx.today);
    const window = monthsEndingAt(current, months);
    const { lines, byMonth } = await loadHistory(ctx, window);
    const movements = movementsHistory(window, byMonth, lines, ctx.today);
    const start = monthEnd(addMonths(window[0]!, -1));
    const period = rangePeriod(start, ctx.today);
    const startMrr = movements[0]!.startCents;
    const churn = movements.reduce((sum, mv) => sum + mv.churnCents, 0);
    const contraction = movements.reduce((sum, mv) => sum + mv.contractionCents, 0);

    const metrics: Metric[] = [
      m.eur("churn.start_mrr", `MRR al empezar (${start})`, startMrr, start),
      m.eur("churn.mrr", "MRR perdido por bajas (churn)", churn, period),
      m.eur("churn.contraction", "MRR perdido por bajadas (contracción)", contraction, period),
    ];
    const rate = shareBps(churn + contraction, startMrr);
    if (rate !== null) metrics.push(m.bps("churn.gross_rate", "Churn bruto de MRR (bajas + bajadas) sobre el MRR inicial", rate, period));
    for (const mv of movements) {
      if (mv.churnCents > 0) metrics.push(m.eur(`churn.${monthPeriod(mv.month)}`, `Churn de MRR · ${monthLabel(mv.month)}`, mv.churnCents, monthPeriod(mv.month)));
    }

    const clients = new Map((await ctx.data.clients()).map((c) => [c.id, c]));
    const rows: ToolRow[] = [];
    for (const [clientId, clientLines] of linesByClient(lines)) {
      const before = mrrTwelfthsOn(clientLines, start);
      if (before === BigInt(0)) continue;
      if (mrrTwelfthsOn(clientLines, ctx.today) !== BigInt(0) || hasPausedLineOn(clientLines, ctx.today)) continue;
      const lost = twelfthsToCents(before);
      rows.push({
        subject: `client:${clientId}`,
        label: clients.get(clientId)?.name ?? "—",
        href: clientHref(clientId),
        fields: {},
        metrics: [m.eur(`churn.client.${clientId}`, `MRR que tenía al empezar (${start})`, lost, start, clientHref(clientId))],
      });
    }
    rows.sort((a, b) => b.metrics[0]!.value - a.metrics[0]!.value);
    metrics.push(m.count("churn.clients", "Clientes que se han ido en el periodo", rows.length, period));
    return {
      tool: "get_churn",
      status: "ok",
      subject: "churn",
      period: { from: start, to: ctx.today },
      source: MRR_SOURCE,
      href: "/",
      summary: `${rows.length} clientes perdidos; ${formatMetricValue(churn, "eur_cents")} de MRR por bajas y ${formatMetricValue(contraction, "eur_cents")} por bajadas.`,
      metrics,
      rows,
    };
  },
});

export const getNrr = defineTool({
  name: "get_nrr",
  description:
    "Retención neta (NRR) y bruta (GRR) del MRR de los clientes que ya tenían MRR al empezar el periodo: MRR de esa cohorte hoy frente a entonces. NRR > 100 % = crecen más de lo que se pierde. Excluye clientes nuevos.",
  input: z.object({ months: z.number().int().min(3).max(24).default(12).describe("Tamaño del periodo en meses") }).strict(),
  async run(ctx, { months }) {
    const start = monthEnd(addMonths(monthOf(ctx.today), -months));
    const period = rangePeriod(start, ctx.today);
    const lines = await ctx.data.contractLines();
    let sumStart = BigInt(0);
    let sumEnd = BigInt(0);
    let retained = BigInt(0);
    let gained = BigInt(0);
    let lost = BigInt(0);
    let cohort = 0;
    for (const clientLines of linesByClient(lines).values()) {
      const before = mrrTwelfthsOn(clientLines, start);
      if (before === BigInt(0)) continue;
      const after = mrrTwelfthsOn(clientLines, ctx.today);
      cohort += 1;
      sumStart += before;
      sumEnd += after;
      retained += after < before ? after : before;
      if (after > before) gained += after - before;
      else lost += before - after;
    }
    const metrics: Metric[] = [
      m.count("nrr.cohort", `Clientes con MRR el ${start}`, cohort, start),
      m.eur("nrr.start_mrr", `MRR de esa cohorte el ${start}`, twelfthsToCents(sumStart), start),
      m.eur("nrr.end_mrr", "MRR de esa misma cohorte hoy", twelfthsToCents(sumEnd), ctx.today),
      m.eur("nrr.expansion", "Lo que ha crecido la cohorte (expansión)", twelfthsToCents(gained), period),
      m.eur("nrr.loss", "Lo que ha perdido la cohorte (bajadas y bajas)", twelfthsToCents(lost), period),
    ];
    const nrr = shareBps(sumEnd, sumStart);
    const grr = shareBps(retained, sumStart);
    if (nrr !== null) metrics.push(m.bps("nrr.nrr", "Retención neta de MRR (NRR)", nrr, period));
    if (grr !== null) metrics.push(m.bps("nrr.grr", "Retención bruta de MRR (GRR)", grr, period));
    return {
      tool: "get_nrr",
      status: cohort === 0 ? "missing_data" : "ok",
      subject: "nrr",
      period: { from: start, to: ctx.today },
      source: MRR_SOURCE,
      href: "/",
      summary: nrr === null ? `Ningún cliente tenía MRR el ${start}.` : `NRR ${formatMetricValue(nrr, "bps")}, GRR ${formatMetricValue(grr ?? 0, "bps")} (${cohort} clientes).`,
      metrics,
      missing: cohort === 0 ? { what: `No había clientes con MRR el ${start}: no hay cohorte que medir.`, needs: ["Contratos recurrentes firmados con más antigüedad"] } : null,
    };
  },
});
