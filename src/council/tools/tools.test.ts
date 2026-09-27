import { describe, expect, it } from "vitest";
import type { Scenario, ScenarioProject } from "../data/scenario";
import { agencyScenario, financeFixture, projectsFixture, toolContext } from "../testing";
import { formatMetricValue } from "./format";
import { executeTool, TOOL_NAMES, toolSpecs } from "./registry";
import type { ToolContext, ToolResult } from "./types";

// Cada tool contra el escenario de referencia (src/council/testing.ts): hoy es el 26/09/2026.
// Las cifras esperadas se sacan a mano de las líneas del escenario, no del código que se prueba.

async function run(name: string, input: unknown = {}, ctx?: ToolContext): Promise<ToolResult> {
  const outcome = await executeTool(name, input, ctx ?? (await toolContext()));
  if (!outcome.ok) throw new Error(outcome.error);
  return outcome.result;
}

const metric = (result: ToolResult, key: string) => {
  const all = [...result.metrics, ...result.rows.flatMap((r) => r.metrics)];
  const found = all.find((mm) => mm.key === key);
  if (!found) throw new Error(`No está la métrica ${key}: ${all.map((mm) => mm.key).join(", ")}`);
  return found.value;
};

const withFinance = async (overrides = {}) => {
  const scenario = { ...agencyScenario(), finance: financeFixture(overrides) };
  return toolContext({ scenario });
};

describe("registro", () => {
  it("todas las tools tienen esquema JSON de entrada y se llaman como en el registro", () => {
    const specs = toolSpecs();
    expect(specs.map((s) => s.name)).toEqual([...TOOL_NAMES]);
    for (const spec of specs) {
      expect(spec.inputSchema.type).toBe("object");
      expect(spec.description.length).toBeGreaterThan(40);
    }
  });

  it("una entrada no válida o una tool que no existe vuelven como error, nunca lanzan", async () => {
    const ctx = await toolContext();
    expect(await executeTool("borrar_facturas", {}, ctx)).toMatchObject({ ok: false });
    expect(await executeTool("get_revenue", { months: 99 }, ctx)).toMatchObject({ ok: false });
    expect(await executeTool("simulate", { kind: "hire" }, ctx)).toMatchObject({ ok: false });
  });
});

describe("ingresos y MRR", () => {
  it("get_revenue separa recurrente, uso y one-off, con el anual en su mes", async () => {
    const r = await run("get_revenue", { months: 12 });
    expect(metric(r, "revenue.2026-08.recurring")).toBe(334_000);
    expect(metric(r, "revenue.2026-08.one_off")).toBe(0);
    expect(metric(r, "revenue.2026-09.recurring")).toBe(214_000);
    // Agosto frente a julio: +1.200 € del anual de analítica sobre 2.140 €.
    expect(metric(r, "revenue.2026-08.recurring.vs_previous")).toBe(5607);
    expect(r.metrics.every((mm) => mm.unit !== "eur_cents" || Number.isInteger(mm.value))).toBe(true);
  });

  it("get_mrr_history: MRR = mensuales + anuales / 12, y el churn de julio por la baja del gimnasio", async () => {
    const r = await run("get_mrr_history", { months: 12 });
    expect(metric(r, "mrr.current")).toBe(226_000);
    expect(metric(r, "arr.current")).toBe(2_712_000);
    expect(metric(r, "mrr.2026-07.churn")).toBe(25_000);
    expect(metric(r, "mrr.bridge.start") + metric(r, "mrr.bridge.new") + metric(r, "mrr.bridge.expansion") - metric(r, "mrr.bridge.contraction") - metric(r, "mrr.bridge.churn") + metric(r, "mrr.bridge.adjustments")).toBe(226_000);
  });

  it("get_churn cuenta al cliente que se fue y el MRR que se llevó", async () => {
    const r = await run("get_churn", { months: 12 });
    expect(metric(r, "churn.mrr")).toBe(25_000);
    expect(metric(r, "churn.start_mrr")).toBe(189_000);
    expect(metric(r, "churn.gross_rate")).toBe(1323);
    expect(r.rows.map((row) => row.subject)).toEqual(["client:c4"]);
  });

  it("get_nrr mide la cohorte que ya pagaba hace un año", async () => {
    const r = await run("get_nrr", { months: 12 });
    expect(metric(r, "nrr.cohort")).toBe(4);
    expect(metric(r, "nrr.start_mrr")).toBe(189_000);
    expect(metric(r, "nrr.end_mrr")).toBe(164_000);
    expect(metric(r, "nrr.nrr")).toBe(8677);
    expect(metric(r, "nrr.grr")).toBe(8677);
  });
});

describe("cobros", () => {
  it("get_receivables: vencido por cliente y días de retraso", async () => {
    const r = await run("get_receivables");
    expect(metric(r, "receivables.overdue")).toBe(145_200);
    expect(metric(r, "receivables.outstanding")).toBe(145_200);
    expect(metric(r, "receivables.overdue_count")).toBe(3);
    expect(r.rows[0]!.subject).toBe("client:c2");
    expect(metric(r, "receivables.client.c2.max_days")).toBe(57);
    expect(metric(r, "collection.avg_days")).toBe(15);
  });

  it("get_concentration: la parte del cliente más grande", async () => {
    const r = await run("get_concentration");
    expect(r.rows[0]!.subject).toBe("client:c5");
    expect(metric(r, "concentration.top1")).toBeGreaterThan(3000);
  });
});

describe("pipeline", () => {
  it("get_pipeline: ponderado en dos cifras que no se suman", async () => {
    const r = await run("get_pipeline");
    expect(metric(r, "pipeline.weighted_one_off")).toBe(325_000);
    expect(metric(r, "pipeline.weighted_mrr")).toBe(22_500);
    expect(metric(r, "pipeline.open_deals")).toBe(2);
    expect(metric(r, "pipeline.overdue_actions")).toBe(1);
  });

  it("get_stalled_deals: el deal parado 47 días con la acción vencida, y no el que se movió hace 6", async () => {
    const r = await run("get_stalled_deals");
    expect(r.rows.map((row) => row.subject)).toEqual(["deal:d1"]);
    expect(metric(r, "deal.d1.days_stalled")).toBe(47);
    expect(metric(r, "deal.d1.action_late")).toBe(25);
    expect(metric(r, "stalled.weighted_one_off")).toBe(325_000);
    const strict = await run("get_stalled_deals", { days: 5 });
    expect(strict.rows).toHaveLength(2);
  });

  it("get_conversion_by_source: leads y perdidos por fuente", async () => {
    const r = await run("get_conversion_by_source", { months: 12 });
    expect(metric(r, "source.src-web.leads")).toBe(2);
    expect(metric(r, "source.src-web.lost")).toBe(1);
    expect(metric(r, "source.src-web.close_rate")).toBe(0);
  });
});

describe("clientes", () => {
  it("get_renewals: la renovación anual del hosting en 19 días", async () => {
    const r = await run("get_renewals");
    expect(r.rows.map((row) => row.subject)).toEqual(["line:l5"]);
    expect(metric(r, "renewal.l5.days_left")).toBe(19);
    expect(metric(r, "renewal.l5.amount")).toBe(24_000);
  });

  it("get_at_risk_clients: la clínica con impagados y sin actividad; el ex-cliente no", async () => {
    const r = await run("get_at_risk_clients");
    expect(r.rows.map((row) => row.subject)).toEqual(["client:c2"]);
    expect(r.rows[0]!.fields.senales).toBe("facturas vencidas, sin actividad");
    expect(metric(r, "risk.c2.mrr")).toBe(75_000);
    expect(metric(r, "risk.c2.quiet_days")).toBe(117);
  });

  it("get_upsell_candidates aplica las reglas de la org como datos", async () => {
    const r = await run("get_upsell_candidates");
    expect(r.rows.map((row) => row.subject).sort()).toEqual([
      "upsell:rule-ads-landing:c2",
      "upsell:rule-seo-report:c2",
      "upsell:rule-seo-report:c5",
      "upsell:rule-single:c1",
      "upsell:rule-web-seo:c1",
    ]);
    expect(metric(r, "upsell.potential_mrr")).toBe(45_000);
    expect(metric(r, "upsell.rule-single.c1.months")).toBe(19);
  });

});

describe("horas de Proyectos: rentabilidad y capacidad", () => {
  // projectsFixture(): horas cada día laborable desde el 1 de junio. De junio a agosto hay 66 días
  // laborables: Mar Blau 30 min/día (33 h), Costa Nord 45 (49,5 h), el hotel 40 (44 h) y el
  // proyecto interno 60 (66 h).
  const withProjects = (projects: ScenarioProject[] = projectsFixture(), extra: Partial<Scenario> = {}) =>
    toolContext({ scenario: { ...agencyScenario(), projects, ...extra } });

  it("sin horas registradas, las dos dicen qué falta en vez de inventar una tarifa o una carga", async () => {
    const profit = await run("get_client_profitability");
    expect(profit.status).toBe("missing_data");
    expect(profit.missing?.needs.join(" ")).toMatch(/Proyectos.*GTiQ/);
    // Como contexto, lo facturado de marzo a agosto con la definición de Proyectos: el hotel, 6 × 700 € + el anual de 1.200 €.
    expect(profit.rows[0]!.subject).toBe("client:c5");
    expect(metric(profit, "profit.client.c5.invoiced")).toBe(540_000);
    expect(profit.metrics.some((mm) => mm.key.endsWith(".rate"))).toBe(false);
    const capacity = await run("get_capacity");
    expect(capacity.status).toBe("missing_data");
    expect(capacity.missing?.href).toBe("/projects");
    expect(capacity.rows).toHaveLength(3);
  });

  it("get_client_profitability: facturado, horas y €/hora frente al objetivo; el periodo empieza con las horas", async () => {
    const r = await run("get_client_profitability", {}, await withProjects());
    expect(r.status).toBe("ok");
    expect(r.period).toEqual({ from: "2026-06-01", to: "2026-08-31" });
    expect(r.notes[0]).toMatch(/2026-06-01/);
    expect(metric(r, "profit.months")).toBe(3);
    expect(metric(r, "profit.target_rate")).toBe(6000);
    // Costa Nord: 3 × 600 € entre 49,5 h = 36,36 €/h, el 60,6 % del objetivo; con esas horas faltaron 2.970 min × 60 €/h − 1.800 € = 1.170 €.
    expect(r.rows[0]!.subject).toBe("client:c3");
    expect(metric(r, "profit.client.c3.invoiced")).toBe(180_000);
    expect(metric(r, "profit.client.c3.minutes")).toBe(2970);
    expect(metric(r, "profit.client.c3.rate")).toBe(3636);
    expect(metric(r, "profit.client.c3.rate_vs_target")).toBe(6060);
    expect(metric(r, "profit.client.c3.gap")).toBe(117_000);
    expect(r.rows[0]!.fields.tarifa).toBe("claramente por debajo del objetivo");
    // Mar Blau: 3 × 750 € entre 33 h = 68,18 €/h. El hotel: 3 × 700 € + el anual de agosto (1.200 €) entre 44 h = 75 €/h.
    expect(metric(r, "profit.client.c2.rate")).toBe(6818);
    expect(metric(r, "profit.client.c5.invoiced")).toBe(330_000);
    expect(metric(r, "profit.client.c5.rate")).toBe(7500);
    // Can Sorra y el gimnasio han facturado sin horas: dato que falta, sin tarifa.
    for (const id of ["c1", "c4"]) {
      const row = r.rows.find((row) => row.subject === `client:${id}`)!;
      expect(row.fields.falta).toMatch(/Horas registradas/);
      expect(row.metrics.some((mm) => mm.key.endsWith(".rate"))).toBe(false);
    }
    expect(metric(r, "profit.without_rate")).toBe(2);
    expect(metric(r, "profit.untracked")).toBe(27_000 + 25_000);
    expect(r.missing?.needs.join(" ")).toMatch(/Registrar sus horas/);
    // Totales: lo facturado de los contratos con proyecto (7.350 €) entre las horas de clientes (126,5 h).
    expect(metric(r, "profit.rate")).toBe(5810);
    expect(metric(r, "profit.below_target")).toBe(1);
    expect(metric(r, "profit.internal_minutes")).toBe(3960);
    expect(r.rows.some((row) => row.subject.startsWith("project:"))).toBe(false);
  });

  it("lo facturado es el de Facturación: la misma cifra que get_revenue en esos meses", async () => {
    const ctx = await withProjects();
    const profit = await run("get_client_profitability", {}, ctx);
    const revenue = await run("get_revenue", { months: 4 }, ctx);
    const total = ["2026-06", "2026-07", "2026-08"].reduce((sum, month) => sum + metric(revenue, `revenue.${month}.total`), 0);
    expect(metric(profit, "profit.invoiced")).toBe(total);
  });

  it("por proyecto: un contrato compartido se reparte por horas y los dos proyectos tienen la misma tarifa", async () => {
    const ads: ScenarioProject = { id: "p1b", name: "Google Ads Mar Blau", clientId: "c2", contractId: "k2", hours: [{ memberId: "m2", from: "2026-06-01", to: "2026-09-25", minutesPerDay: 15 }] };
    const r = await run("get_client_profitability", {}, await withProjects([...projectsFixture(), ads]));
    // 2.250 € del contrato entre 33 h + 16,5 h: 45,45 €/h para el cliente y para cada proyecto; a cada uno, su parte por horas.
    expect(metric(r, "profit.client.c2.rate")).toBe(4545);
    expect(metric(r, "profit.project.p1.invoiced")).toBe(150_000);
    expect(metric(r, "profit.project.p1b.invoiced")).toBe(75_000);
    expect(metric(r, "profit.project.p1.rate")).toBe(4545);
    expect(metric(r, "profit.project.p1b.rate")).toBe(4545);
    expect(r.rows.find((row) => row.subject === "project:p1")).toMatchObject({ href: "/projects/p1", fields: { contrato_compartido: true } });
    // Con client_id, el detalle de ese cliente aunque tenga un solo proyecto.
    const one = await run("get_client_profitability", { client_id: "c3" }, await withProjects());
    expect(one.rows.map((row) => row.subject)).toEqual(["client:c3", "project:p2"]);
    expect(metric(one, "profit.project.p2.rate")).toBe(3636);
    expect(await executeTool("get_client_profitability", { client_id: "nadie" }, await withProjects())).toMatchObject({ ok: false });
  });

  it("un proyecto sin contrato no da tarifa: falta enlazarlo con el contrato que factura", async () => {
    const menu: ScenarioProject = { id: "p5", name: "Carta digital", clientId: "c1", hours: [{ memberId: "m1", from: "2026-06-01", to: "2026-09-25", minutesPerDay: 20 }] };
    const r = await run("get_client_profitability", {}, await withProjects([...projectsFixture(), menu]));
    const row = r.rows.find((x) => x.subject === "client:c1")!;
    expect(row.fields.falta).toMatch(/Enlazar/);
    expect(row.metrics.some((mm) => mm.key.endsWith(".rate"))).toBe(false);
    expect(r.missing?.needs.join(" ")).toMatch(/Enlazar cada proyecto/);
  });

  it("si las horas empiezan a mitad de mes, el periodo empieza el mes siguiente; sin un mes entero, missing_data", async () => {
    const late: ScenarioProject = { id: "p3", name: "SEO Hotel Llevant", clientId: "c5", contractId: "k5", hours: [{ memberId: "m1", from: "2026-07-15", to: "2026-09-25", minutesPerDay: 40 }] };
    const r = await run("get_client_profitability", {}, await withProjects([late]));
    expect(r.period).toEqual({ from: "2026-08-01", to: "2026-08-31" });
    expect(metric(r, "profit.months")).toBe(1);
    // Agosto: 700 € + el anual de 1.200 € entre 21 días × 40 min (14 h).
    expect(metric(r, "profit.client.c5.rate")).toBe(13_571);
    expect(r.notes.join(" ")).toMatch(/anual/);
    const recent: ScenarioProject = { ...late, hours: [{ memberId: "m1", from: "2026-08-20", to: "2026-09-25", minutesPerDay: 40 }] };
    const none = await run("get_client_profitability", { months: 1 }, await withProjects([recent]));
    expect(none.status).toBe("missing_data");
    expect(none.summary).toMatch(/2026-08-20/);
  });

  it("el objetivo es el de Ajustes de la org (el de Proyectos), y si la política dice otro se avisa", async () => {
    const r = await run("get_client_profitability", {}, await withProjects(projectsFixture(), { org: { settings: { target_hourly_rate_cents: 4000 } } }));
    expect(metric(r, "profit.target_rate")).toBe(4000);
    expect(metric(r, "profit.client.c3.rate_vs_target")).toBe(9090);
    expect(r.rows.find((row) => row.subject === "client:c3")!.fields.tarifa).toBe("algo por debajo del objetivo");
    expect(r.notes.join(" ")).toMatch(/política del consejo/);
  });

  it("get_capacity: horas por socio y semana frente a 30 h (el supuesto, dicho) y la carga planificada", async () => {
    const r = await run("get_capacity", {}, await withProjects());
    expect(r.status).toBe("ok");
    // Las 6 semanas completas de la regla de contratar: del lunes 10/08 al domingo 20/09.
    expect(r.period).toEqual({ from: "2026-08-10", to: "2026-09-20" });
    expect(metric(r, "capacity.weekly_capacity")).toBe(1800);
    expect(r.metrics.find((mm) => mm.key === "capacity.weekly_capacity")!.label).toMatch(/supuesto/);
    // Marc Sanjuan: 40 + 60 min al día = 500 min a la semana, el 27,78 % de 30 h; el equipo, 875 de 5.400 min.
    expect(r.rows[0]!.subject).toBe("member:m1");
    expect(metric(r, "capacity.m1.2026-09-14")).toBe(500);
    expect(metric(r, "capacity.m1.avg")).toBe(500);
    expect(metric(r, "capacity.m1.load")).toBe(2778);
    expect(metric(r, "capacity.team.2026-09-14.load")).toBe(1620);
    expect(metric(r, "capacity.team.avg_load")).toBe(1620);
    expect(metric(r, "capacity.team.weeks_at_policy")).toBe(0);
    // Hasta el 23/10: Helena, 240 + 120 + 180 (vencida) min y una tarea sin estimar; la hecha de Marc Costa y la que no tiene fecha no cuentan.
    expect(metric(r, "capacity.m3.planned")).toBe(540);
    expect(metric(r, "capacity.m3.overdue")).toBe(180);
    expect(metric(r, "capacity.m3.unestimated")).toBe(1);
    expect(metric(r, "capacity.m3.planned_load")).toBe(750);
    expect(metric(r, "capacity.m2.planned")).toBe(0);
    expect(metric(r, "capacity.team.planned")).toBe(540 + 360 + 480);
    expect(metric(r, "capacity.team.unassigned")).toBe(480);
    expect(r.missing).toBeNull();
    expect(formatMetricValue(2970, "minutes")).toBe("49,5 h");
  });

  it("la capacidad semanal de orgs.settings manda si está", async () => {
    const r = await run("get_capacity", { weeks: 4 }, await withProjects(projectsFixture(), { org: { settings: { weekly_capacity_minutes: 1200 } } }));
    expect(metric(r, "capacity.weekly_capacity")).toBe(1200);
    expect(r.metrics.find((mm) => mm.key === "capacity.weekly_capacity")!.label).toMatch(/fijada en Ajustes/);
    expect(metric(r, "capacity.m1.load")).toBe(4167);
    expect(r.period).toEqual({ from: "2026-08-24", to: "2026-09-20" });
  });

  it("la regla de contratar se evalúa con las horas: cumple con el equipo al 94 % seis semanas y pipeline suficiente", async () => {
    const busy = (id: string, name: string, clientId: string, contractId: string, memberId: string, minutesPerDay: number): ScenarioProject => ({
      id,
      name,
      clientId,
      contractId,
      hours: [{ memberId, from: "2026-08-03", to: "2026-09-25", minutesPerDay }],
    });
    const projects = [busy("p1", "SEO local Mar Blau", "c2", "k2", "m2", 330), busy("p2", "Redes sociales Costa Nord", "c3", "k3", "m3", 330), busy("p3", "SEO Hotel Llevant", "c5", "k5", "m1", 360)];
    const base = agencyScenario();
    const bigDeal = { id: "d4", title: "Marketing de cuatro hoteles", clientId: "c7", stageId: "stage-negotiation", estMrrCents: 400_000 };
    const ctx = await withProjects(projects, { clients: [...base.clients, { id: "c7", name: "Grup Hotels Maresme" }], deals: [...base.deals!, bigDeal] });
    const capacity = await run("get_capacity", {}, ctx);
    expect(metric(capacity, "capacity.team.avg_load")).toBe(9444);
    expect(metric(capacity, "capacity.team.weeks_at_policy")).toBe(6);
    const policy = await run("get_policy", {}, ctx);
    expect(policy.data).toMatchObject({ rules: { hire: "cumple" } });
    expect(metric(policy, "policy.rule.hire.capacity_ok")).toBe(1);
    expect(metric(policy, "policy.rule.hire.capacity_weeks")).toBe(6);
    expect(metric(policy, "policy.rule.hire.pipeline_mrr")).toBe(22_500 + 300_000);

    // Si un socio no registra horas, la carga del equipo no se conoce: sin datos, aunque el pipeline cumpla.
    const partial = await withProjects(projects.slice(1), { clients: [...base.clients, { id: "c7", name: "Grup Hotels Maresme" }], deals: [...base.deals!, bigDeal] });
    const unknown = await run("get_capacity", {}, partial);
    expect(unknown.status).toBe("ok");
    expect(unknown.missing?.what).toMatch(/Marc Costa/);
    expect(metric(unknown, "capacity.people")).toBe(2);
    expect((await run("get_policy", {}, partial)).data).toMatchObject({ rules: { hire: "sin_datos" } });
  });
});

describe("SEO", () => {
  it("sin la web conectada, missing_data con lo que hay que hacer", async () => {
    const r = await run("get_seo_summary");
    expect(r.status).toBe("missing_data");
    expect(r.missing?.href).toBe("/seo");
  });

  it("con datos, compara con el periodo anterior", async () => {
    const days = Array.from({ length: 70 }, (_, i) => {
      const date = new Date(Date.UTC(2026, 6, 16 + i)).toISOString().slice(0, 10);
      return { date, clicks: i < 42 ? 10 : 15, impressions: 400, position: 8 };
    });
    const scenario = { ...agencyScenario(), seo: { propertyId: "p1", label: "gnerai.com", siteUrl: "https://gnerai.com", searchDays: days, organicDays: [], allDays: [], lastDataOn: days.at(-1)!.date } };
    const r = await run("get_seo_summary", { days: 28 }, await toolContext({ scenario }));
    expect(r.status).toBe("ok");
    expect(metric(r, "seo.clicks")).toBe(28 * 15);
    expect(metric(r, "seo.clicks.previous")).toBe(28 * 10);
    expect(metric(r, "seo.clicks.change")).toBe(5000);
  });
});

describe("política y consejo", () => {
  it("get_policy dice que es de EJEMPLO y evalúa las reglas con los datos de hoy", async () => {
    const r = await run("get_policy");
    expect(r.source).toMatch(/EJEMPLO/);
    expect(metric(r, "policy.cushion_months")).toBe(4);
    expect(metric(r, "policy.impact_threshold")).toBe(30_000);
    expect(r.data).toMatchObject({ rules: { raise_partner_pay: "no_cumple", hire: "no_cumple", cushion: "sin_datos" } });
    expect(metric(r, "policy.rule.raise.mrr.2026-06")).toBe(251_000);
  });

  it("con caja y gastos, el colchón y el margen se pueden medir", async () => {
    const r = await run("get_policy", {}, await withFinance());
    expect(metric(r, "policy.rule.cushion.months")).toBe(25);
    expect(r.data).toMatchObject({ rules: { cushion: "cumple" } });
  });

  it("get_past_recommendations devuelve lo decidido con su motivo", async () => {
    const { memoryStore } = await import("../testing");
    const store = memoryStore();
    const [id] = await store.insertRecommendations("org-fixture", [
      {
        agent: "retention",
        runId: null,
        kind: "decision",
        title: "Subir precios a hostelería",
        summary: "…",
        reasoning: "…",
        evidence: [],
        proposedActions: [],
        missingData: [],
        impactCents: 50_000,
        confidence: "media",
        urgency: "este_mes",
        risks: null,
        requiresProfessionalReview: false,
        challenge: null,
        policyVersion: null,
        subject: "client:c1",
        dedupeKey: "pricing:client:c1",
      },
    ]);
    store.decide(id!, "descartada", "Ya subimos en enero");
    const r = await run("get_past_recommendations", {}, await toolContext({ store }));
    expect(r.rows[0]!.fields).toMatchObject({ estado: "descartada", motivo_de_la_decision: "Ya subimos en enero" });
    expect(metric(r, "past.descartada")).toBe(1);
  });
});

describe("simulate", () => {
  it("subir precios un 5 %: el MRR sube 113 € línea a línea", async () => {
    const r = await run("simulate", { kind: "price_change", percent_bps: 500 });
    expect(metric(r, "simulate.mrr.before")).toBe(226_000);
    expect(metric(r, "simulate.mrr.after")).toBe(237_300);
    expect(metric(r, "simulate.mrr.delta")).toBe(11_300);
    expect(metric(r, "simulate.billing.delta")).toBeGreaterThan(0);
    expect(r.missing?.what).toMatch(/caja/);
  });

  it("perder un cliente resta su MRR y su facturación prevista", async () => {
    const r = await run("simulate", { kind: "lose_client", client_id: "c5" });
    expect(metric(r, "simulate.mrr.delta")).toBe(-80_000);
    expect(metric(r, "simulate.billing.delta")).toBeLessThan(0);
  });

  it("contratar: coste del horizonte y meses de gastos que cubre la caja antes y después", async () => {
    const r = await run("simulate", { kind: "hire", monthly_cost_cents: 250_000, horizon_months: 6 }, await withFinance());
    expect(metric(r, "simulate.cost.horizon")).toBe(1_500_000);
    // Runway de Finanzas: meses de costes fijos (1.000 €/mes) que cubre la caja (25.000 €).
    expect(metric(r, "simulate.cover.before")).toBe(25);
    expect(metric(r, "simulate.cover.after")).toBe(7.1);
    // Margen medio de junio, julio y agosto: (1.190 + 840 + 1.940) / 3.
    expect(metric(r, "simulate.result.before")).toBe(132_333);
    expect(metric(r, "simulate.result.after")).toBe(132_333 - 250_000);
    expect(r.missing).toBeNull();
  });
});

describe("cierre mensual", () => {
  it("sin Finanzas: el lado de los ingresos y qué falta para el reparto", async () => {
    const r = await run("get_monthly_close");
    expect(r.status).toBe("missing_data");
    expect(r.subject).toBe("close:2026-08");
    expect(metric(r, "close.revenue.total")).toBe(334_000);
    expect(metric(r, "close.collected")).toBe(313_390);
    expect(metric(r, "close.outstanding")).toBe(145_200);
    expect(metric(r, "close.overdue")).toBe(54_450);
    expect(r.data).toMatchObject({ distribution: null });
    expect(r.missing?.needs.length).toBeGreaterThan(0);
  });

  it("con Finanzas: la propuesta de la política cuadra al céntimo", async () => {
    const r = await run("get_monthly_close", { month: "2026-08" }, await withFinance());
    expect(r.status).toBe("ok");
    expect(metric(r, "close.profit")).toBe(194_000);
    // IVA del 3T por ingresar (repercutido de julio a septiembre − soportado de julio y agosto).
    expect(metric(r, "close.taxes_due")).toBe(118_020);
    expect(metric(r, "close.fixed_monthly")).toBe(100_000);
    const buckets = (r.data!.distribution as { buckets: Record<string, number> }).buckets;
    expect(buckets).toEqual({ taxes: 48_500, cushion: 0, reinvestment: 43_650, partners: 101_850 });
    expect(r.notes.join(" ")).toMatch(/gestoría/);
  });

  it("un mes que no ha cerrado no se cierra", async () => {
    const outcome = await executeTool("get_monthly_close", { month: "2026-09" }, await toolContext());
    expect(outcome).toMatchObject({ ok: false });
  });
});

describe("impuestos", () => {
  it("IVA repercutido del trimestre, plazo y Verifactu; el soportado falta sin gastos", async () => {
    const r = await run("get_tax_provisions");
    expect(metric(r, "tax.2026-Q3.issuer-sl.vat_output")).toBe(160_020);
    expect(metric(r, "tax.2026-Q3.days_left")).toBe(24);
    expect(metric(r, "verifactu.issuer-sl.days_left")).toBe(97);
    expect(r.missing?.what).toMatch(/soportado/);
    expect(r.notes[0]).toMatch(/gestoría/);
  });

  it("con gastos: IVA a ingresar y provisión de Sociedades estimada", async () => {
    const r = await run("get_tax_provisions", {}, await withFinance());
    expect(metric(r, "tax.2026-Q3.issuer-sl.vat_input")).toBe(42_000);
    expect(metric(r, "tax.2026-Q3.issuer-sl.vat_payable")).toBe(118_020);
    // 25 % del margen de junio, julio y agosto (los meses del año con gastos): 3.970 €.
    expect(metric(r, "tax.is.profit_ytd")).toBe(397_000);
    expect(metric(r, "tax.is.provision_ytd")).toBe(99_250);
  });
});

describe("caja", () => {
  it("sin Finanzas, las cuatro tools de caja dicen qué falta", async () => {
    for (const name of ["get_expenses", "get_cash_position", "get_cash_forecast", "get_runway"]) {
      const r = await run(name);
      expect(r.status).toBe("missing_data");
      expect(r.metrics).toEqual([]);
      expect(r.missing?.href).toBe("/finance");
    }
  });

  it("con Finanzas: posición, previsión y runway", async () => {
    const ctx = await withFinance();
    const position = await run("get_cash_position", {}, ctx);
    expect(metric(position, "cash.estimated")).toBe(2_500_000);
    expect(metric(position, "cash.runway_months")).toBe(25);
    expect(metric(position, "cash.taxes_due")).toBe(118_020);
    expect(metric(position, "cash.after_taxes")).toBe(2_500_000 - 118_020);
    const expenses = await run("get_expenses", {}, ctx);
    expect(metric(expenses, "expenses.2026-08.total")).toBe(140_000);
    expect(metric(expenses, "expenses.expenses_avg")).toBe(130_000);
    expect(metric(expenses, "expenses.fixed_monthly")).toBe(100_000);
    const runway = await run("get_runway", {}, ctx);
    expect(metric(runway, "runway.months")).toBe(25);
    expect(metric(runway, "runway.net_burn")).toBe(0);
    expect(metric(runway, "runway.below_cushion")).toBe(0);
    // Previsión de Finanzas: caja + lo pendiente de cobro (hoy) − el IVA del 3T (20 de octubre).
    const forecast = await run("get_cash_forecast", {}, ctx);
    expect(metric(forecast, "forecast.start")).toBe(2_500_000);
    expect(metric(forecast, "forecast.end")).toBe(2_500_000 + 145_200 - 118_020);
    expect(metric(forecast, "forecast.kind.vat")).toBe(-118_020);
  });
});
