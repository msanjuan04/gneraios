// Lo que el consejo sabe de sí mismo: la política financiera de los socios (con sus reglas
// evaluadas contra los datos de hoy) y las recomendaciones anteriores con lo que se decidió.

import { z } from "zod";
import { addDays } from "@/domain/dates/civil-date";
import { monthEnd, mrrHistory } from "@/domain/metrics";
import { AGENT_NAMES, RECOMMENDATION_STATUSES } from "../types";
import { hireCapacityOk, loadCapacity, untrackedNames, weeksAtOrAbove } from "./capacity";
import { m } from "./common";
import { closedMonths, combinedMargin, hasCash, monthPnl } from "./finance-common";
import { formatMetricValue, monthLabel, monthPeriod } from "./format";
import { defineTool, type Metric, type ToolContext, type ToolRow } from "./types";

export type RuleStatus = "cumple" | "no_cumple" | "sin_datos";
export const POLICY_RULES = ["raise_partner_pay", "hire", "cushion"] as const;
export type PolicyRule = (typeof POLICY_RULES)[number];

function combine(conditions: (boolean | null)[]): RuleStatus {
  if (conditions.some((c) => c === false)) return "no_cumple";
  if (conditions.some((c) => c === null)) return "sin_datos";
  return "cumple";
}

const STATUS_TEXT: Record<RuleStatus, string> = { cumple: "cumple", no_cumple: "no cumple", sin_datos: "sin datos para saberlo" };

async function evaluateRules(ctx: ToolContext): Promise<{ rows: ToolRow[]; rules: Record<PolicyRule, RuleStatus> }> {
  const { policy } = ctx.policy;
  const today = ctx.today;
  const [lines, finance, deals, capacity] = await Promise.all([ctx.data.contractLines(), ctx.data.finance(today), ctx.data.deals(), loadCapacity(ctx, policy.hire.weeks)]);

  // Subir la retribución: MRR por encima del mínimo N meses seguidos, colchón y margen.
  const months = closedMonths(today, policy.raise_partner_pay.consecutive_months);
  const snapshots = new Map((await ctx.data.snapshots(months[0]!, months.at(-1)!)).map((s) => [s.month, s]));
  const points = mrrHistory(months, snapshots, lines, today);
  const mrrOk = points.every((p) => p.mrrCents > policy.raise_partner_pay.min_mrr_cents);
  const raiseMetrics: Metric[] = points.map((p) =>
    m.eur(`policy.rule.raise.mrr.${monthPeriod(p.month)}`, `MRR al cierre de ${monthLabel(p.month)}`, p.mrrCents, monthPeriod(p.month)),
  );
  raiseMetrics.push(m.flag("policy.rule.raise.mrr_ok", "MRR por encima del mínimo todos esos meses", mrrOk, today));

  // Colchón: los meses de costes fijos que cubre la caja (el runway de Finanzas).
  const cushionNow = hasCash(finance) ? finance.runwayMonths : null;
  const cushionOk = cushionNow === null ? null : cushionNow >= policy.cushion_months;
  if (cushionNow !== null) raiseMetrics.push(m.months("policy.rule.cushion.now", "Colchón actual (meses de costes fijos que cubre la caja)", cushionNow, today, "/finance"));

  let marginOk: boolean | null = null;
  const pnls = finance ? months.map((month) => monthPnl(finance, month)) : [];
  if (pnls.length > 0 && pnls.every((p) => p !== null)) {
    const margin = combinedMargin(pnls.filter((p) => p !== null));
    if (margin.bps !== null) {
      marginOk = margin.bps >= policy.raise_partner_pay.min_margin_bps;
      raiseMetrics.push(m.bps("policy.rule.raise.margin", `Margen de esos ${months.length} meses (beneficio / ingresos)`, margin.bps, `${months[0]!.slice(0, 7)}/${monthEnd(months.at(-1)!)}`));
    }
  }
  const raise = combine([mrrOk, policy.raise_partner_pay.require_cushion ? cushionOk : true, marginOk]);

  // Contratar: la carga del equipo (horas de Proyectos, la misma foto que get_capacity) en el mínimo
  // todas las semanas de la política, y pipeline ponderado suficiente.
  const weightedMrr = deals
    .filter((d) => d.stageKind === "open")
    .reduce((sum, d) => sum + Math.round((d.estMrrCents * Math.min(10_000, Math.max(0, d.probabilityBps))) / 10_000), 0);
  const pipelineOk = weightedMrr >= policy.hire.min_weighted_pipeline_mrr_cents;
  const capacityOk = hireCapacityOk(capacity, policy.hire.min_capacity_bps);
  const hire = combine([capacityOk, pipelineOk]);
  const capacityPeriod = `${capacity.from}/${capacity.to}`;
  const hireMetrics: Metric[] = [];
  if (capacity.team.avgLoadBps !== null) {
    hireMetrics.push(
      m.bps("policy.rule.hire.capacity_avg", `Carga media del equipo en las últimas ${capacity.mondays.length} semanas completas`, capacity.team.avgLoadBps, capacityPeriod, "/projects"),
      m.count("policy.rule.hire.capacity_weeks", "Semanas seguidas, hasta la última completa, con la carga del equipo en el mínimo o por encima", weeksAtOrAbove(capacity.team.loadBpsByWeek, policy.hire.min_capacity_bps), capacityPeriod),
    );
  }
  if (capacityOk !== null) hireMetrics.push(m.flag("policy.rule.hire.capacity_ok", "Carga del equipo en el mínimo o por encima todas esas semanas", capacityOk, capacityPeriod));
  const missingHours = capacity.team.people === 0 ? "horas registradas por socio (Proyectos)" : capacityOk === null ? `horas de ${untrackedNames(capacity).join(", ")} (Proyectos)` : null;

  // Colchón (y alerta de runway): meses de gastos fijos en caja frente al objetivo.
  const cushion = combine([cushionOk]);

  const rows: ToolRow[] = [
    {
      subject: "policy:rule:raise_partner_pay",
      label: "Regla para subir la retribución de los socios",
      href: "/settings/council",
      fields: {
        estado: STATUS_TEXT[raise],
        condiciones: `MRR por encima del mínimo ${months.length} meses seguidos${policy.raise_partner_pay.require_cushion ? ", colchón cumplido" : ""} y margen mínimo`,
        faltan: [cushionOk === null && policy.raise_partner_pay.require_cushion ? "caja y gastos fijos" : null, marginOk === null ? "gastos de esos meses" : null]
          .filter(Boolean)
          .join(", ") || null,
      },
      metrics: [...raiseMetrics, m.flag("policy.rule.raise_partner_pay.met", "Se cumple la regla para subir la retribución", raise === "cumple", today)],
    },
    {
      subject: "policy:rule:hire",
      label: "Regla para contratar",
      href: "/settings/council",
      fields: {
        estado: STATUS_TEXT[hire],
        condiciones: "Carga del equipo (horas registradas frente a su capacidad semanal) en el mínimo o por encima todas las semanas de la política y pipeline ponderado suficiente",
        faltan: missingHours,
      },
      metrics: [
        ...hireMetrics,
        m.eur("policy.rule.hire.pipeline_mrr", "Pipeline ponderado en MRR hoy (€/mes)", weightedMrr, today, "/pipeline"),
        m.flag("policy.rule.hire.pipeline_ok", "Pipeline ponderado por encima del mínimo", pipelineOk, today),
      ],
    },
    {
      subject: "policy:rule:cushion",
      label: "Colchón de caja",
      href: "/finance",
      fields: { estado: STATUS_TEXT[cushion], faltan: cushionOk === null ? "saldo de caja y gastos fijos" : null },
      metrics: cushionNow === null ? [] : [m.months(`policy.rule.cushion.months`, "Colchón actual (meses de costes fijos que cubre la caja)", cushionNow, today, "/finance")],
    },
  ];
  return { rows, rules: { raise_partner_pay: raise, hire, cushion } };
}

export const getPolicy = defineTool({
  name: "get_policy",
  description:
    "La política financiera vigente que fijan los socios (versión, colchón, provisión de impuestos, reparto, reglas para subir la retribución y para contratar, umbrales) y cada regla evaluada con los datos de hoy: cumple, no cumple o sin datos. Si es la política de EJEMPLO, dilo siempre.",
  input: z.object({}).strict(),
  async run(ctx) {
    const { policy, version, isExample } = ctx.policy;
    const today = ctx.today;
    const at = "/settings/council";
    const metrics: Metric[] = [
      m.months("policy.cushion_months", "Colchón objetivo (meses de gastos fijos)", policy.cushion_months, today, at),
      m.bps("policy.corporate_tax_provision", "Provisión del Impuesto de Sociedades sobre el beneficio", policy.corporate_tax_provision_bps, today, at),
      m.bps("policy.distribution.reinvestment", "Reinversión (de lo que queda tras impuestos y colchón)", policy.distribution.reinvestment_bps, today, at),
      m.bps("policy.distribution.partners", "Socios (de lo que queda tras impuestos y colchón)", policy.distribution.partners_bps, today, at),
      m.months("policy.raise.months", "Subir retribución: meses seguidos con el MRR por encima del mínimo", policy.raise_partner_pay.consecutive_months, today, at),
      m.eur("policy.raise.min_mrr", "Subir retribución: MRR mínimo", policy.raise_partner_pay.min_mrr_cents, today, at),
      m.bps("policy.raise.min_margin", "Subir retribución: margen mínimo", policy.raise_partner_pay.min_margin_bps, today, at),
      m.bps("policy.hire.min_capacity", "Contratar: capacidad comprometida mínima", policy.hire.min_capacity_bps, today, at),
      m.count("policy.hire.weeks", "Contratar: semanas seguidas por encima de esa capacidad", policy.hire.weeks, today, at),
      m.eur("policy.hire.min_pipeline_mrr", "Contratar: pipeline ponderado mínimo (€/mes)", policy.hire.min_weighted_pipeline_mrr_cents, today, at),
      m.bps("policy.min_project_margin", "Margen mínimo por proyecto", policy.min_project_margin_bps, today, at),
      m.eur("policy.target_hourly_rate", "Precio por hora objetivo", policy.target_hourly_rate_cents, today, at),
      m.eur("policy.impact_threshold", "Umbral de impacto para avisar", policy.impact_threshold_cents, today, at),
      m.eur("policy.high_impact_threshold", "Umbral de impacto alto (revisa el abogado del diablo)", policy.high_impact_threshold_cents, today, at),
    ];
    if (version !== null) metrics.push(m.number("policy.version", "Versión de la política", version, today, at));
    const { rows, rules } = await evaluateRules(ctx);
    return {
      tool: "get_policy",
      status: "ok",
      subject: "policy",
      period: { from: today, to: today },
      source: isExample ? "Política de EJEMPLO (CONSEJO.md §4): los socios aún no han fijado la suya." : `Política financiera v${version} (financial_policies).`,
      href: at,
      summary: isExample
        ? "Política de EJEMPLO: los socios aún no la han fijado. Toda propuesta basada en ella tiene que decirlo."
        : `Política v${version}: colchón de ${formatMetricValue(policy.cushion_months, "months")}.`,
      metrics,
      rows,
      notes: isExample ? ["Los valores son de ejemplo, no una decisión de los socios."] : [],
      data: { rules },
    };
  },
});

export const getPastRecommendations = defineTool({
  name: "get_past_recommendations",
  description:
    "Recomendaciones anteriores del consejo con lo que decidieron los socios (aceptada, descartada con su motivo, pospuesta, hecha). Úsala para no repetir lo descartado y para priorizar lo abierto.",
  input: z
    .object({
      agent: z.enum(AGENT_NAMES).optional(),
      statuses: z.array(z.enum(RECOMMENDATION_STATUSES)).max(5).optional(),
      days: z.number().int().min(1).max(365).default(120),
      limit: z.number().int().min(1).max(50).default(20),
    })
    .strict(),
  async run(ctx, { agent, statuses, days, limit }) {
    const since = `${addDays(ctx.today, -days)}T00:00:00Z`;
    const recs = await ctx.council.pastRecommendations({ agent, statuses, since, limit });
    const rows: ToolRow[] = recs.map((r) => ({
      subject: `recommendation:${r.id}`,
      label: r.title,
      href: `/council?id=${r.id}`,
      fields: {
        id: r.id,
        agente: r.agent,
        estado: r.status,
        sobre: r.subject,
        urgencia: r.urgency,
        confianza: r.confidence,
        motivo_de_la_decision: r.decisionNote,
        pospuesta_hasta: r.postponedUntil,
        creada: r.createdAt.slice(0, 10),
        decidida: r.decidedAt?.slice(0, 10) ?? null,
        validar_con_gestoria: r.requiresProfessionalReview,
      },
      metrics: r.impactCents === null ? [] : [m.eur(`recommendation.${r.id}.impact`, "Impacto estimado", r.impactCents, r.createdAt.slice(0, 10), `/council?id=${r.id}`)],
    }));
    const count = (status: string) => recs.filter((r) => r.status === status).length;
    const period = `${since.slice(0, 10)}/${ctx.today}`;
    return {
      tool: "get_past_recommendations",
      status: "ok",
      subject: "past_recommendations",
      period: { from: since.slice(0, 10), to: ctx.today },
      source: "Recomendaciones del consejo y decisiones de los socios (recommendations).",
      href: "/council",
      summary: `${recs.length} recomendaciones en los últimos ${days} días.`,
      metrics: [
        m.days("past.days", "Días consultados", days, period),
        m.count("past.count", "Recomendaciones", recs.length, period),
        ...RECOMMENDATION_STATUSES.map((s) => m.count(`past.${s}`, `Recomendaciones en estado ${s}`, count(s), period)),
      ],
      rows,
    };
  },
});

