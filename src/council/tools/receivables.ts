// Cobros y concentración: get_receivables y get_concentration (src/domain/metrics).

import { z } from "zod";
import { addDays, daysBetween } from "@/domain/dates/civil-date";
import { collectionStats, concentration, monthOf, monthsEndingAt, receivables } from "@/domain/metrics";
import { clientHref, m } from "./common";
import { formatMetricValue, monthLabel, rangePeriod } from "./format";
import { defineTool, type Metric, type ToolRow } from "./types";

export const getReceivables = defineTool({
  name: "get_receivables",
  description:
    "Pendiente de cobro y vencido (con IVA y neto de IRPF: lo que el cliente tiene que pagar), por cliente, con los días de retraso, y cómo se cobra (días medios hasta el cobro, parte cobrada en plazo) en los últimos 12 meses.",
  input: z.object({}).strict(),
  async run(ctx) {
    const open = await ctx.data.invoices({ statuses: ["issued", "overdue"] });
    const totals = receivables(open.map((i) => ({ kind: i.kind, status: i.status, outstandingCents: i.outstandingCents })));
    const today = ctx.today;

    const byClient = new Map<string, { name: string; cents: number; count: number; maxDays: number; numbers: string[] }>();
    for (const invoice of open) {
      if (invoice.kind !== "ordinary" || invoice.status !== "overdue" || !invoice.dueOn) continue;
      const entry = byClient.get(invoice.clientId) ?? { name: invoice.clientName, cents: 0, count: 0, maxDays: 0, numbers: [] };
      entry.cents += invoice.outstandingCents;
      entry.count += 1;
      entry.maxDays = Math.max(entry.maxDays, daysBetween(invoice.dueOn, today));
      if (invoice.number) entry.numbers.push(invoice.number);
      byClient.set(invoice.clientId, entry);
    }
    const rows: ToolRow[] = [...byClient]
      .sort((a, b) => b[1].cents - a[1].cents)
      .slice(0, 15)
      .map(([clientId, e]) => ({
        subject: `client:${clientId}`,
        label: e.name,
        href: clientHref(clientId),
        fields: { facturas: e.numbers.join(", ") },
        metrics: [
          m.eur(`receivables.client.${clientId}.overdue`, "Vencido de este cliente", e.cents, today, `/invoices?client=${clientId}`),
          m.count(`receivables.client.${clientId}.count`, "Facturas vencidas", e.count, today),
          m.days(`receivables.client.${clientId}.max_days`, "Días de retraso de la más antigua", e.maxDays, today),
        ],
      }));

    const since = addDays(today, -365);
    const paid = (await ctx.data.invoices({ statuses: ["paid"] })).filter((i) => i.kind === "ordinary" && i.lastPaidOn && i.lastPaidOn >= since);
    const stats = collectionStats(paid.flatMap((i) => (i.issuedOn && i.lastPaidOn ? [{ issuedOn: i.issuedOn, dueOn: i.dueOn, paidOn: i.lastPaidOn }] : [])));
    const statsPeriod = rangePeriod(since, today);

    const metrics: Metric[] = [
      m.eur("receivables.outstanding", "Pendiente de cobro (con IVA)", totals.outstandingCents, today, "/invoices?status=issued"),
      m.count("receivables.open_count", "Facturas pendientes de cobro", totals.openCount, today),
      m.eur("receivables.overdue", "Vencido (con IVA)", totals.overdueCents, today, "/invoices?status=overdue"),
      m.count("receivables.overdue_count", "Facturas vencidas", totals.overdueCount, today),
      m.count("receivables.overdue_clients", "Clientes con facturas vencidas", byClient.size, today),
      m.count("collection.paid_count", "Facturas cobradas en los últimos 12 meses", stats.paidCount, statsPeriod),
    ];
    if (stats.avgDaysToPay !== null) metrics.push(m.days("collection.avg_days", "Días medios de la emisión al cobro", stats.avgDaysToPay, statsPeriod));
    if (stats.onTimeShare !== null) metrics.push(m.bps("collection.on_time", "Parte cobrada en plazo", Math.round(stats.onTimeShare * 10_000), statsPeriod));
    if (stats.avgDaysLate !== null) metrics.push(m.days("collection.avg_days_late", "Retraso medio de las que se cobraron tarde", stats.avgDaysLate, statsPeriod));

    return {
      tool: "get_receivables",
      status: "ok",
      subject: "receivables",
      period: { from: since, to: today },
      source: "Facturas emitidas con su estado derivado y sus cobros (vista invoices_overview).",
      href: "/invoices",
      summary: `Pendiente ${formatMetricValue(totals.outstandingCents, "eur_cents")}, vencido ${formatMetricValue(totals.overdueCents, "eur_cents")} (${totals.overdueCount} facturas).`,
      metrics,
      rows,
      notes: ["Los cobros se miden con IVA y neto de IRPF; los ingresos, en base imponible sin IVA."],
    };
  },
});

export const getConcentration = defineTool({
  name: "get_concentration",
  description:
    "Cuánto depende el negocio de sus clientes más grandes: facturación neta (base sin IVA) de los últimos 12 meses, la parte del primer cliente y de los tres primeros, y si se pasa del umbral de aviso de la org.",
  input: z.object({ months: z.number().int().min(3).max(24).default(12) }).strict(),
  async run(ctx, { months }) {
    const current = monthOf(ctx.today);
    const window = monthsEndingAt(current, months);
    const rows = await ctx.data.clientRevenue(window[0]!, current);
    const result = concentration(rows, { thresholdBps: ctx.concentrationAlertBps });
    const names = new Map((await ctx.data.clients()).map((c) => [c.id, c.name]));
    const period = rangePeriod(window[0]!, ctx.today);
    const metrics: Metric[] = [
      m.eur("concentration.total", `Facturación neta desde ${monthLabel(window[0]!)}`, result.totalCents, period),
      m.bps("concentration.top1", "Parte del cliente más grande", result.top1ShareBps, period),
      m.bps("concentration.top3", "Parte de los tres más grandes", result.top3ShareBps, period),
      m.bps("concentration.threshold", "Umbral de aviso de la org", ctx.concentrationAlertBps, ctx.today, "/settings"),
      m.flag("concentration.alert", "El cliente más grande pasa del umbral", result.alert, period),
    ];
    return {
      tool: "get_concentration",
      status: result.totalCents > 0 ? "ok" : "missing_data",
      subject: "concentration",
      period: { from: window[0]!, to: ctx.today },
      source: "Facturación neta por cliente y mes (vista revenue_by_client_month).",
      href: "/",
      summary: `El cliente más grande pesa ${formatMetricValue(result.top1ShareBps, "bps")} y los tres primeros ${formatMetricValue(result.top3ShareBps, "bps")}.`,
      metrics,
      rows: result.clients.slice(0, 5).map((c) => ({
        subject: `client:${c.clientId}`,
        label: names.get(c.clientId) ?? "—",
        href: clientHref(c.clientId),
        fields: {},
        metrics: [
          m.eur(`concentration.client.${c.clientId}`, "Facturación neta en el periodo", c.cents, period, clientHref(c.clientId)),
          m.bps(`concentration.client.${c.clientId}.share`, "Parte del total", c.shareBps, period),
        ],
      })),
      missing: result.totalCents > 0 ? null : { what: "No hay facturas emitidas en el periodo.", needs: ["Facturas emitidas"] },
    };
  },
});
