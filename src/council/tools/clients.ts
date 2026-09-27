// Clientes: renovaciones, riesgo y venta cruzada (get_renewals, get_at_risk_clients y
// get_upsell_candidates). La rentabilidad por cliente (€/hora) está en profitability.ts y la
// capacidad por socio en capacity.ts: las dos salen de las horas de Proyectos.

import { z } from "zod";
import { addDays, compareCivil, daysBetween, parseCivilDate } from "@/domain/dates/civil-date";
import { linesInForce, lineMrrCents, upcomingRenewals } from "@/domain/metrics";
import type { CouncilLine } from "../data/types";
import { clientHref, containsAny, contractHref, linesByClient, liveRecurringLines, localDay, m, mrrCentsOn } from "./common";
import { rangePeriod } from "./format";
import { defineTool, type Metric, type ToolRow } from "./types";

const LINES_SOURCE = "Líneas de los contratos firmados (fechas, pausas y bajas) y estado derivado del cliente (vista clients_overview).";

/** Meses de calendario completos entre dos fechas. */
export function monthsBetween(from: string, to: string): number {
  const a = parseCivilDate(from);
  const b = parseCivilDate(to);
  return Math.max(0, (b.year - a.year) * 12 + (b.month - a.month) - (b.day < a.day ? 1 : 0));
}

export const getRenewals = defineTool({
  name: "get_renewals",
  description:
    "Renovaciones anuales próximas: líneas anuales cuya próxima facturación cae en la ventana (la de avisos de la org si no se indica), con el cliente, la fecha, los días que faltan y el importe anual sin IVA.",
  input: z.object({ days: z.number().int().min(1).max(365).optional() }).strict(),
  async run(ctx, { days }) {
    const window = days ?? ctx.renewalWindowDays;
    const [lines, clients] = await Promise.all([ctx.data.contractLines(), ctx.data.clients()]);
    const names = new Map(clients.map((c) => [c.id, c.name]));
    const renewals = upcomingRenewals(linesInForce(lines, ctx.today), ctx.today, window);
    const period = rangePeriod(ctx.today, addDays(ctx.today, window));
    const rows: ToolRow[] = renewals.map((r) => ({
      subject: `line:${r.line.id}`,
      label: `${names.get(r.line.clientId) ?? "—"} · ${r.line.description}`,
      href: contractHref(r.line.contractId),
      fields: { cliente_id: r.line.clientId, contrato: r.line.contractTitle, renueva_el: r.renewsOn },
      metrics: [
        m.eur(`renewal.${r.line.id}.amount`, "Importe anual que se renueva (sin IVA)", r.amountCents, r.renewsOn, contractHref(r.line.contractId)),
        m.days(`renewal.${r.line.id}.days_left`, "Días que faltan", r.daysLeft, ctx.today),
      ],
    }));
    return {
      tool: "get_renewals",
      status: "ok",
      subject: "renewals",
      period: { from: ctx.today, to: addDays(ctx.today, window) },
      source: LINES_SOURCE,
      href: "/contracts",
      summary: rows.length === 0 ? `Ninguna renovación en los próximos ${window} días.` : `${rows.length} renovaciones en los próximos ${window} días.`,
      metrics: [
        m.days("renewals.window", "Ventana de renovaciones", window, ctx.today, "/settings"),
        m.count("renewals.count", "Renovaciones en la ventana", rows.length, period),
        m.eur("renewals.amount", "Importe anual que se renueva (sin IVA)", renewals.reduce((s, r) => s + r.amountCents, 0), period),
      ],
      rows,
    };
  },
});

/** Líneas recurrentes que terminan pronto sin otra que las siga (ni versión nueva ni renovación). */
function endingLines(lines: readonly CouncilLine[], today: string, horizon: string): CouncilLine[] {
  return liveRecurringLines(lines, today).filter(
    (line) =>
      line.endsOn !== null &&
      compareCivil(line.endsOn, horizon) <= 0 &&
      !lines.some((other) => other.id !== line.id && other.startsOn !== null && compareCivil(other.startsOn, line.endsOn!) > 0 && other.billingType !== "one_off"),
  );
}

export const getAtRiskClients = defineTool({
  name: "get_at_risk_clients",
  description:
    "Clientes activos o en pausa con señales de riesgo: facturas vencidas hace más de N días, sin actividad desde hace N días, bajada de MRR en los últimos 90 días, servicios que terminan en los próximos 60 días sin continuidad, o en pausa. Con el MRR de cada uno (lo que está en juego).",
  input: z.object({}).strict(),
  async run(ctx) {
    const today = ctx.today;
    const inactivityDays = ctx.thresholds.inactivity_days ?? 60;
    const overdueDays = ctx.thresholds.overdue_days ?? 15;
    const [clients, lines, overdue] = await Promise.all([ctx.data.clients(), ctx.data.contractLines(), ctx.data.invoices({ statuses: ["overdue"] })]);
    const byClient = linesByClient(lines);
    const ninetyAgo = addDays(today, -90);
    const horizon = addDays(today, 60);

    const rows: ToolRow[] = [];
    let mrrAtRisk = 0;
    for (const client of clients) {
      if (client.archived || (client.status !== "active" && client.status !== "paused")) continue;
      const clientLines = byClient.get(client.id) ?? [];
      const href = clientHref(client.id);
      const signals: string[] = [];
      const metrics: Metric[] = [];
      const mrrToday = mrrCentsOn(clientLines, today);

      const late = overdue.filter((i) => i.clientId === client.id && i.kind === "ordinary" && i.dueOn && daysBetween(i.dueOn, today) >= overdueDays);
      if (late.length > 0) {
        signals.push("facturas vencidas");
        metrics.push(
          m.eur(`risk.${client.id}.overdue`, `Vencido hace más de ${overdueDays} días`, late.reduce((s, i) => s + i.outstandingCents, 0), today, `/invoices?client=${client.id}`),
          m.days(`risk.${client.id}.overdue_days`, "Días de retraso de la más antigua", Math.max(...late.map((i) => daysBetween(i.dueOn!, today))), today),
        );
      }
      const lastActivity = client.lastActivityAt ? localDay(client.lastActivityAt, ctx.timeZone) : null;
      const quiet = lastActivity ? daysBetween(lastActivity, today) : daysBetween(localDay(client.createdAt, ctx.timeZone), today);
      if (quiet >= inactivityDays) {
        signals.push("sin actividad");
        metrics.push(m.days(`risk.${client.id}.quiet_days`, lastActivity ? "Días sin actividad registrada" : "Días de cliente sin ninguna actividad registrada", quiet, today, href));
      }
      const mrrBefore = mrrCentsOn(clientLines, ninetyAgo);
      if (mrrToday > 0 && mrrBefore > mrrToday) {
        signals.push("bajada de MRR");
        metrics.push(m.eur(`risk.${client.id}.contraction`, "Bajada de MRR en los últimos 90 días", mrrBefore - mrrToday, rangePeriod(ninetyAgo, today)));
      }
      const ending = endingLines(clientLines, today, horizon);
      if (ending.length > 0) {
        signals.push("servicios que terminan");
        metrics.push(m.eur(`risk.${client.id}.ending_mrr`, "MRR de servicios que terminan en 60 días", ending.reduce((s, l) => s + lineMrrCents(l, today), 0), rangePeriod(today, horizon)));
      }
      if (client.status === "paused") signals.push("en pausa");
      if (signals.length === 0) continue;

      mrrAtRisk += mrrToday;
      rows.push({
        subject: `client:${client.id}`,
        label: client.name,
        href,
        fields: { senales: signals.join(", "), estado: client.status, ultima_actividad: lastActivity },
        metrics: [m.eur(`risk.${client.id}.mrr`, "MRR del cliente hoy", mrrToday, today, href), ...metrics],
      });
    }
    rows.sort((a, b) => b.metrics[0]!.value - a.metrics[0]!.value);
    return {
      tool: "get_at_risk_clients",
      status: "ok",
      subject: "at_risk_clients",
      period: { from: ninetyAgo, to: today },
      source: `${LINES_SOURCE} Facturas vencidas (invoices_overview) y actividades del CRM.`,
      href: "/clients",
      summary: rows.length === 0 ? "Ningún cliente con señales de riesgo." : `${rows.length} clientes con señales de riesgo.`,
      metrics: [
        m.count("risk.count", "Clientes con señales de riesgo", rows.length, today, "/clients"),
        m.eur("risk.mrr", "MRR de esos clientes", mrrAtRisk, today),
        m.days("risk.inactivity_threshold", "Umbral de días sin actividad", inactivityDays, today, "/settings/council"),
        m.days("risk.overdue_threshold", "Umbral de días de vencida", overdueDays, today, "/settings/council"),
      ],
      rows: rows.slice(0, 15),
    };
  },
});

export const getUpsellCandidates = defineTool({
  name: "get_upsell_candidates",
  description:
    "Candidatos a venta cruzada según las reglas de la org (datos, no código: p. ej. web sin mantenimiento, Ads sin landing, un solo servicio desde hace más de 6 meses). Por cliente activo y regla: la sugerencia, su MRR hoy, su antigüedad y el MRR de referencia del servicio si la regla lo tiene.",
  input: z.object({}).strict(),
  async run(ctx) {
    const today = ctx.today;
    const [rules, clients, lines] = await Promise.all([ctx.council.upsellRules(), ctx.data.clients(), ctx.data.contractLines()]);
    const byClient = linesByClient(lines);
    const rows: ToolRow[] = [];
    let potential = 0;
    for (const client of clients) {
      if (client.archived || client.status !== "active") continue;
      const clientLines = byClient.get(client.id) ?? [];
      const live = liveRecurringLines(clientLines, today);
      const oneOffs = clientLines.filter((l) => l.billingType === "one_off");
      const since = client.firstInvoiceOn ?? clientLines.map((l) => l.signedOn).sort()[0] ?? null;
      const months = since ? monthsBetween(since, today) : 0;
      const href = clientHref(client.id);
      for (const rule of rules) {
        const requires = rule.requiresAny.length === 0 || clientLines.some((l) => containsAny(l.description, rule.requiresAny));
        const excluded = rule.excludesAny.length > 0 && [...live, ...oneOffs].some((l) => containsAny(l.description, rule.excludesAny));
        const fewServices = rule.maxServices === null || (live.length >= 1 && live.length <= rule.maxServices);
        const oldEnough = rule.minMonths === null || months >= rule.minMonths;
        if (!requires || excluded || !fewServices || !oldEnough) continue;
        const metrics: Metric[] = [
          m.eur(`upsell.${rule.id}.${client.id}.mrr`, "MRR del cliente hoy", mrrCentsOn(clientLines, today), today, href),
          m.months(`upsell.${rule.id}.${client.id}.months`, "Meses como cliente", months, today),
          m.count(`upsell.${rule.id}.${client.id}.services`, "Servicios recurrentes activos", live.length, today),
        ];
        if (rule.referenceMrrCents !== null) {
          potential += rule.referenceMrrCents;
          metrics.push(m.eur(`upsell.${rule.id}.${client.id}.potential`, "MRR de referencia del servicio sugerido (€/mes)", rule.referenceMrrCents, today, "/settings/council"));
        }
        rows.push({
          subject: `upsell:${rule.id}:${client.id}`,
          label: `${client.name} · ${rule.label}`,
          href,
          fields: { sugerencia: rule.suggestion, servicios_activos: live.map((l) => l.description).join(", ") || null, cliente_id: client.id },
          metrics,
        });
      }
    }
    rows.sort((a, b) => b.metrics[0]!.value - a.metrics[0]!.value);
    return {
      tool: "get_upsell_candidates",
      status: rules.length > 0 ? "ok" : "missing_data",
      subject: "upsell",
      period: { from: today, to: today },
      source: "Reglas de venta cruzada de la org (Ajustes → Consejo) sobre las líneas de contrato de cada cliente activo.",
      href: "/clients",
      summary: `${rows.length} oportunidades de venta cruzada.`,
      metrics: [
        m.count("upsell.count", "Oportunidades de venta cruzada", rows.length, today),
        m.eur("upsell.potential_mrr", "MRR de referencia de las que tienen precio (€/mes)", potential, today, "/settings/council"),
      ],
      rows: rows.slice(0, 20),
      missing: rules.length > 0 ? null : { what: "No hay reglas de venta cruzada activas.", needs: ["Reglas en Ajustes → Consejo"], href: "/settings/council" },
      notes: rows.some((r) => r.metrics.length < 4) ? ["Algunas reglas no tienen precio de referencia: sin él no hay impacto en €."] : [],
    };
  },
});
