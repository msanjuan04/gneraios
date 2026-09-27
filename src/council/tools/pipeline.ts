// Pipeline comercial (ARCHITECTURE.md §7.9): get_pipeline, get_stalled_deals y
// get_conversion_by_source. El pipeline ponderado va siempre en dos cifras (one-off y MRR) que
// nunca se suman.

import { z } from "zod";
import { addDays, daysBetween } from "@/domain/dates/civil-date";
import { pipelineByStage, weightedPipeline } from "@/domain/metrics";
import { computeCloseRates, toDateRange, type FunnelDeal } from "@/domain/pipeline";
import { channelBreakdown } from "@/domain/seo";
import type { CouncilDeal } from "../data/types";
import { dealHref, localDay, m, shareBps } from "./common";
import { formatMetricValue, rangePeriod } from "./format";
import { defineTool, type Metric, type ToolContext, type ToolRow } from "./types";

const PIPELINE_SOURCE = "Deals abiertos con su etapa y probabilidad efectiva (vista deals_board) e historial de etapas.";

const weighted = (cents: number, bps: number) => Math.round((cents * Math.min(10_000, Math.max(0, bps))) / 10_000);

async function openDeals(ctx: ToolContext): Promise<CouncilDeal[]> {
  return (await ctx.data.deals()).filter((d) => d.stageKind === "open");
}

export const getPipeline = defineTool({
  name: "get_pipeline",
  description:
    "Pipeline abierto hoy: ponderado en dos cifras que nunca se suman (one-off ponderado y MRR ponderado), por etapa, los deals más grandes y cuántos tienen la próxima acción vencida.",
  input: z.object({}).strict(),
  async run(ctx) {
    const [deals, stages] = await Promise.all([openDeals(ctx), ctx.data.stages()]);
    const total = weightedPipeline(deals);
    const byStage = pipelineByStage(deals, stages);
    const names = new Map(stages.map((s) => [s.id, s.name]));
    const today = ctx.today;
    const overdueActions = deals.filter((d) => d.nextActionOn !== null && d.nextActionOn < today).length;

    const metrics: Metric[] = [
      m.eur("pipeline.weighted_one_off", "Pipeline ponderado one-off", total.oneOffCents, today, "/pipeline"),
      m.eur("pipeline.weighted_mrr", "Pipeline ponderado en MRR (€/mes)", total.mrrCents, today, "/pipeline"),
      m.count("pipeline.open_deals", "Deals abiertos", total.openDeals, today, "/pipeline"),
      m.count("pipeline.overdue_actions", "Deals con la próxima acción vencida", overdueActions, today, "/pipeline"),
    ];
    for (const stage of byStage) {
      const name = names.get(stage.stageId) ?? "—";
      metrics.push(
        m.count(`pipeline.stage.${stage.stageId}.deals`, `Deals en ${name}`, stage.deals, today),
        m.eur(`pipeline.stage.${stage.stageId}.weighted_one_off`, `One-off ponderado en ${name}`, stage.weighted.oneOffCents, today),
        m.eur(`pipeline.stage.${stage.stageId}.weighted_mrr`, `MRR ponderado en ${name}`, stage.weighted.mrrCents, today),
      );
    }
    const top: ToolRow[] = [...deals]
      .sort((a, b) => b.estOneOffCents + b.estMrrCents * 12 - (a.estOneOffCents + a.estMrrCents * 12))
      .slice(0, 8)
      .map((d) => dealRow(d, names.get(d.stageId) ?? "—", today));
    return {
      tool: "get_pipeline",
      status: "ok",
      subject: "pipeline",
      period: { from: today, to: today },
      source: PIPELINE_SOURCE,
      href: "/pipeline",
      summary: `${total.openDeals} deals abiertos: ${formatMetricValue(total.oneOffCents, "eur_cents")} one-off ponderado y ${formatMetricValue(total.mrrCents, "eur_cents")}/mes ponderados.`,
      metrics,
      rows: top,
    };
  },
});

function dealRow(d: CouncilDeal, stageName: string, today: string, extra: Metric[] = [], extraFields: Record<string, string> = {}): ToolRow {
  const href = dealHref(d.id);
  return {
    subject: `deal:${d.id}`,
    label: `${d.title} · ${d.clientName}`,
    href,
    fields: { etapa: stageName, proxima_accion: d.nextAction, proxima_accion_el: d.nextActionOn, ...extraFields },
    metrics: [
      ...extra,
      m.eur(`deal.${d.id}.one_off`, "Importe one-off estimado", d.estOneOffCents, today, href),
      m.eur(`deal.${d.id}.mrr`, "MRR estimado (€/mes)", d.estMrrCents, today, href),
      m.bps(`deal.${d.id}.probability`, "Probabilidad", d.probabilityBps, today, href),
      m.eur(`deal.${d.id}.weighted_one_off`, "One-off ponderado", weighted(d.estOneOffCents, d.probabilityBps), today, href),
      m.eur(`deal.${d.id}.weighted_mrr`, "MRR ponderado (€/mes)", weighted(d.estMrrCents, d.probabilityBps), today, href),
    ],
  };
}

export const getStalledDeals = defineTool({
  name: "get_stalled_deals",
  description:
    "Deals abiertos parados: sin cambio de etapa ni actividad desde hace al menos N días (umbral de la org si no se indica), o con la próxima acción vencida. Con los días sin movimiento, importes y probabilidad.",
  input: z.object({ days: z.number().int().min(1).max(365).optional().describe("Días sin movimiento; por defecto, el umbral de la org") }).strict(),
  async run(ctx, { days }) {
    const threshold = days ?? ctx.thresholds.stalled_days ?? 21;
    const today = ctx.today;
    const [deals, stages, activities] = await Promise.all([
      openDeals(ctx),
      ctx.data.stages(),
      ctx.data.activities(`${addDays(today, -730)}T00:00:00Z`),
    ]);
    const names = new Map(stages.map((s) => [s.id, s.name]));
    const lastActivity = new Map<string, string>();
    for (const a of activities) {
      if (!a.dealId) continue;
      const current = lastActivity.get(a.dealId);
      if (!current || a.occurredAt > current) lastActivity.set(a.dealId, a.occurredAt);
    }

    const rows: ToolRow[] = [];
    let stalledOneOff = 0;
    let stalledMrr = 0;
    for (const deal of deals) {
      const moments = [deal.createdAt, deal.stageEnteredAt, lastActivity.get(deal.id)].filter((x): x is string => Boolean(x));
      const lastMove = localDay(moments.sort().at(-1)!, ctx.timeZone);
      const quiet = daysBetween(lastMove, today);
      const actionLate = deal.nextActionOn !== null && deal.nextActionOn < today ? daysBetween(deal.nextActionOn, today) : 0;
      if (quiet < threshold && actionLate === 0) continue;
      stalledOneOff += weighted(deal.estOneOffCents, deal.probabilityBps);
      stalledMrr += weighted(deal.estMrrCents, deal.probabilityBps);
      const extra = [m.days(`deal.${deal.id}.days_stalled`, "Días sin movimiento (etapa o actividad)", quiet, today, dealHref(deal.id))];
      if (actionLate > 0) extra.push(m.days(`deal.${deal.id}.action_late`, "Días que lleva vencida la próxima acción", actionLate, today, dealHref(deal.id)));
      rows.push(dealRow(deal, names.get(deal.stageId) ?? "—", today, extra, { ultimo_movimiento: lastMove }));
    }
    rows.sort((a, b) => b.metrics[0]!.value - a.metrics[0]!.value);
    return {
      tool: "get_stalled_deals",
      status: "ok",
      subject: "stalled_deals",
      period: { from: addDays(today, -threshold), to: today },
      source: `${PIPELINE_SOURCE} Actividades del CRM.`,
      href: "/pipeline",
      summary: rows.length === 0 ? `Ningún deal parado más de ${threshold} días.` : `${rows.length} deals parados.`,
      metrics: [
        m.days("stalled.threshold", "Umbral de días sin movimiento", threshold, today, "/settings/council"),
        m.count("stalled.count", "Deals parados", rows.length, today, "/pipeline"),
        m.eur("stalled.weighted_one_off", "One-off ponderado de los deals parados", stalledOneOff, today),
        m.eur("stalled.weighted_mrr", "MRR ponderado de los deals parados (€/mes)", stalledMrr, today),
      ],
      rows: rows.slice(0, 15),
    };
  },
});

/**
 * Leads, ganados, perdidos y facturación por fuente de adquisición entre dos días (ambos
 * incluidos), con las definiciones del embudo (src/domain/pipeline y src/domain/seo).
 */
export async function channelRows(ctx: ToolContext, from: string, to: string) {
  const range = toDateRange({ from, to }, ctx.today, ctx.timeZone);
  const [deals, history, stages, sources, clients, invoices] = await Promise.all([
    ctx.data.deals(),
    ctx.data.stageHistory(),
    ctx.data.stages(),
    ctx.data.sources(),
    ctx.data.clients(),
    ctx.data.invoices({ issuedFrom: from, issuedTo: to }),
  ]);
  const funnelDeals: FunnelDeal[] = deals.map((d) => ({
    id: d.id,
    createdAt: d.createdAt,
    stageId: d.stageId,
    sourceId: d.sourceId,
    broughtById: d.broughtByMemberId,
    ownerId: d.ownerMemberId,
    lossReasonId: d.lossReasonId,
    estOneOffCents: d.estOneOffCents,
    estMrrCents: d.estMrrCents,
  }));
  const live = new Set(funnelDeals.map((d) => d.id));
  const changes = history.filter((h) => live.has(h.dealId));
  const channel = channelBreakdown({
    deals: funnelDeals,
    history: changes,
    stages,
    range,
    clients: clients.map((c) => ({ id: c.id, sourceId: c.sourceId, lifetimeBilledCents: c.billedNetCents })),
    invoices: invoices.filter((i) => i.status !== "draft" && i.status !== "issuing").map((i) => ({ clientId: i.clientId, subtotalCents: i.subtotalCents })),
  });
  const rates = new Map(computeCloseRates(funnelDeals, changes, stages, range, "source").map((r) => [r.key, r]));
  return { channel, rates, sources };
}

export const getConversionBySource = defineTool({
  name: "get_conversion_by_source",
  description:
    "Qué fuentes de adquisición convierten y traen clientes que pagan: por fuente, leads (deals creados), ganados, perdidos y tasa de cierre en el periodo, importes ganados (one-off y MRR aparte), lo facturado en el periodo y desde siempre a sus clientes.",
  input: z.object({ months: z.number().int().min(1).max(36).default(12) }).strict(),
  async run(ctx, { months }) {
    const today = ctx.today;
    const from = addDays(today, -Math.round(months * 30.4375));
    const { channel, rates, sources } = await channelRows(ctx, from, today);
    const names = new Map(sources.map((s) => [s.id, s.name]));
    const period = rangePeriod(from, today);
    const rows: ToolRow[] = channel
      .filter((row) => row.leads + row.won + row.lifetimeBilledCents + row.billedCents > 0)
      .map((row) => {
        const key = row.sourceId ?? "none";
        const rate = rates.get(row.sourceId);
        const metrics: Metric[] = [
          m.count(`source.${key}.leads`, "Leads (deals creados en el periodo)", row.leads, period),
          m.count(`source.${key}.won`, "Ganados en el periodo", row.won, period),
          m.count(`source.${key}.lost`, "Perdidos en el periodo", rate?.lost ?? 0, period),
          m.eur(`source.${key}.won_one_off`, "One-off ganado (estimado)", row.wonOneOffCents, period),
          m.eur(`source.${key}.won_mrr`, "MRR ganado (estimado, €/mes)", row.wonMrrCents, period),
          m.eur(`source.${key}.billed`, "Facturado en el periodo a sus clientes", row.billedCents, period),
          m.eur(`source.${key}.lifetime`, "Facturado desde siempre a sus clientes", row.lifetimeBilledCents, period),
          m.count(`source.${key}.paying_clients`, "Clientes que ya han pagado", row.payingClients, period),
        ];
        const closeRate = rate ? shareBps(rate.won, rate.won + rate.lost) : null;
        if (closeRate !== null) metrics.push(m.bps(`source.${key}.close_rate`, "Tasa de cierre (ganados / cerrados)", closeRate, period));
        return { subject: `source:${key}`, label: row.sourceId ? (names.get(row.sourceId) ?? "—") : "Sin fuente", href: "/pipeline/funnel", fields: {}, metrics };
      });
    return {
      tool: "get_conversion_by_source",
      status: rows.length > 0 ? "ok" : "missing_data",
      subject: "conversion_by_source",
      period: { from, to: today },
      source: "Embudo sobre deals y su historial de etapas; facturación por la fuente del primer deal del cliente.",
      href: "/pipeline/funnel",
      summary: `${rows.length} fuentes con actividad en el periodo.`,
      metrics: [m.count("conversion.sources", "Fuentes con actividad", rows.length, period)],
      rows,
      missing: rows.length > 0 ? null : { what: "No hay deals ni facturación en el periodo.", needs: ["Deals con su fuente de adquisición"], href: "/pipeline" },
    };
  },
});
