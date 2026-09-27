import { describe, expect, it } from "vitest";
import { runJob } from "../../runner";
import type { FakeScript } from "../../runtime/fake";
import type { NewRecommendation } from "../../store/types";
import { claimedJob, memoryStore, ORG_ID, runnerDeps } from "../../testing";
import { TOOL_NAMES } from "../../tools/registry";
import { chiefOfStaff } from "./agent";

// El Chief of Staff de principio a fin con FakeRuntime: el briefing del lunes con lo abierto.

const open = (overrides: Partial<NewRecommendation>): NewRecommendation => ({
  agent: "retention",
  runId: null,
  kind: "decision",
  title: "Reclamar las facturas vencidas de Mar Blau",
  summary: "…",
  reasoning: "…",
  evidence: [],
  proposedActions: [],
  missingData: [],
  impactCents: 145_200,
  confidence: "alta",
  urgency: "hoy",
  risks: null,
  requiresProfessionalReview: false,
  challenge: null,
  policyVersion: null,
  subject: "client:c2",
  dedupeKey: "retention:client:c2",
  ...overrides,
});

type Row = { label: string; fields: { id: string }; metrics: { id: string; value: string }[] };

const briefing: FakeScript = async (s) => {
  const past = (await s.call("get_past_recommendations", { statuses: ["nueva", "pospuesta", "aceptada"] })).json as { rows: (Row & { fields: { id: string; agent?: string } })[] };
  const cash = (await s.call("get_cash_position")).json as { call: string };
  await s.call("get_pipeline");
  await s.call("get_receivables");
  await s.call("get_mrr_history", { months: 3 });
  return {
    briefing: {
      headline: "Dos acciones con dinero en juego esta semana: cerrar la tienda online y cobrar a Mar Blau",
      top_actions: past.rows.map((r) => ({
        title: r.label,
        why: `Impacto estimado de ${r.metrics[0]!.value}.`,
        impact_ref: r.metrics[0]!.id,
        urgency: "esta_semana",
        if_not_done: "Se enfría el cliente y el cobro se retrasa otro mes.",
        recommendation_id: r.fields.id,
        from_agents: ["retention"],
        evidence: [r.metrics[0]!.id],
      })),
      risk_alerts: [],
      optimizations: [],
      conflicts: [],
      cash: { text: "No hay datos de caja: faltan los saldos de las cuentas.", evidence: [cash.call] },
      areas: [
        { area: "caja", status: "sin_datos", note: "Sin saldos registrados.", evidence: [] },
        { area: "comercial", status: "ambar", note: "Un deal con la próxima acción vencida.", evidence: ["pipeline.overdue_actions"] },
        { area: "clientes", status: "rojo", note: "1.452 € vencidos.", evidence: ["receivables.overdue"] },
        { area: "ingresos", status: "verde", note: "MRR de 2.260 € hoy.", evidence: ["mrr.current"] },
      ],
    },
  };
};

describe("definición del Chief of Staff", () => {
  it("briefing los lunes a las 8:00, con todas las tools en solo lectura y el modelo profundo", () => {
    expect(chiefOfStaff.schedules[0]).toMatchObject({ task: "weekly_briefing", schedule: { kind: "weekly", weekday: 1, hour: 8 } });
    expect(chiefOfStaff.tools).toEqual(TOOL_NAMES);
  });
});

describe("briefing semanal", () => {
  it("prioriza lo abierto, dice que no hay caja y pone el semáforo con evidencia", async () => {
    const store = memoryStore();
    const [retention, commercial] = await store.insertRecommendations(ORG_ID, [
      open({}),
      open({ agent: "commercial", title: "Cerrar la tienda online de Tallers Rius", impactCents: 325_000, subject: "deal:d1", dedupeKey: "commercial:deal:d1" }),
    ]);
    const deps = runnerDeps({ store, scripts: { "chief_of_staff:weekly_briefing": briefing }, now: new Date("2026-09-28T06:30:00Z") });
    const outcome = await runJob(deps, await claimedJob(store, { agent: "chief_of_staff", trigger: "weekly_briefing", payload: { task: "weekly_briefing" } }));
    expect(outcome).toMatchObject({ status: "done", error: null });

    const report = store.reports[0]!;
    expect(report).toMatchObject({ kind: "weekly_briefing", periodStart: "2026-09-28", periodEnd: "2026-10-04" });
    const content = report.content as {
      version: number;
      topActions: { recommendationId: string; impactCents: number | null; evidence: string[] }[];
      areas: { area: string; status: string }[];
      cash: { evidence: string[] };
    };
    expect(content.version).toBe(2);
    expect(content.topActions.map((d) => d.recommendationId).sort()).toEqual([retention, commercial].sort());
    // El impacto sale de la métrica en € de cada recomendación, no de un número escrito.
    expect(content.topActions.map((d) => d.impactCents).sort((a, b) => a! - b!)).toEqual([145_200, 325_000]);
    expect(content.areas.map((a) => `${a.area}:${a.status}`)).toEqual(["caja:sin_datos", "comercial:ambar", "clientes:rojo", "ingresos:verde"]);
    const cashRef = content.cash.evidence[0]!;
    expect(report.evidence.find((e) => e.ref === cashRef)).toMatchObject({ tool: "get_cash_position", unit: "missing" });
    expect(store.runs[0]).toMatchObject({ agent: "chief_of_staff", model: "claude-opus-5-5", status: "succeeded" });
  });

  it("una acción que apunta a una recomendación que no está abierta se rechaza", async () => {
    const store = memoryStore();
    await store.insertRecommendations(ORG_ID, [open({})]);
    const wrong: FakeScript = async (s) => {
      const output = (await briefing(s)) as { briefing: { top_actions: { recommendation_id: string | null }[] } };
      output.briefing.top_actions[0]!.recommendation_id = "00000000-0000-0000-0000-000000000000";
      return output;
    };
    const deps = runnerDeps({ store, scripts: { "chief_of_staff:weekly_briefing": wrong } });
    const outcome = await runJob(deps, await claimedJob(store, { agent: "chief_of_staff", trigger: "manual", payload: {} }));
    expect(outcome.status).toBe("failed");
    expect(store.reports).toHaveLength(0);
  });

  it("sin métrica propia, una acción hereda el impacto de su recomendación", async () => {
    const store = memoryStore();
    await store.insertRecommendations(ORG_ID, [open({})]);
    const noRef: FakeScript = async (s) => {
      const output = (await briefing(s)) as { briefing: { top_actions: { impact_ref: string | null; why: string; evidence: string[] }[] } };
      for (const a of output.briefing.top_actions) {
        a.impact_ref = null;
        a.why = "Es lo que más dinero tiene en juego esta semana.";
      }
      return output;
    };
    const deps = runnerDeps({ store, scripts: { "chief_of_staff:weekly_briefing": noRef } });
    const outcome = await runJob(deps, await claimedJob(store, { agent: "chief_of_staff", trigger: "manual", payload: {} }));
    expect(outcome.status).toBe("done");
    const content = store.reports[0]!.content as { topActions: { impactCents: number | null }[] };
    expect(content.topActions[0]!.impactCents).toBe(145_200);
  });

  it("rechaza un impacto que no es una métrica en euros, un conflicto de un solo agente y un punto repetido en dos secciones", async () => {
    const cases: ((b: Record<string, unknown[]> & { top_actions: Record<string, unknown>[] }) => void)[] = [
      (b) => {
        b.top_actions[0]!.impact_ref = "pipeline.overdue_actions";
      },
      (b) => {
        b.conflicts = [{ agents: ["commercial", "commercial"], tension: "Cerrar rápido o cuidar el margen.", decision: "Cerrar con el precio mínimo.", evidence: [] }];
      },
      (b) => {
        b.optimizations = [{ ...b.top_actions[0]!, recommendation_id: null }];
      },
    ];
    for (const mutate of cases) {
      const store = memoryStore();
      await store.insertRecommendations(ORG_ID, [open({})]);
      const broken: FakeScript = async (s) => {
        const output = (await briefing(s)) as { briefing: Record<string, unknown[]> & { top_actions: Record<string, unknown>[] } };
        mutate(output.briefing);
        return output;
      };
      const deps = runnerDeps({ store, scripts: { "chief_of_staff:weekly_briefing": broken } });
      const outcome = await runJob(deps, await claimedJob(store, { agent: "chief_of_staff", trigger: "manual", payload: {} }));
      expect(outcome.status).toBe("failed");
      expect(store.reports).toHaveLength(0);
    }
  });

  it("si solo falla un punto (una cifra inventada en un conflicto), se publica el briefing sin él", async () => {
    const store = memoryStore();
    await store.insertRecommendations(ORG_ID, [open({})]);
    // El guion responde lo mismo en cada reintento (sin volver a llamar a las tools).
    let cached: unknown = null;
    const oneBad: FakeScript = async (s) => {
      if (cached) return cached;
      const output = (await briefing(s)) as { briefing: { conflicts: unknown[] } };
      output.briefing.conflicts = [
        { agents: ["retention", "commercial"], tension: "Cobrar ya o cuidar la relación.", decision: "Reclamar los 865 € con una llamada cordial.", evidence: [] },
      ];
      cached = output;
      return output;
    };
    const deps = runnerDeps({ store, scripts: { "chief_of_staff:weekly_briefing": oneBad } });
    const outcome = await runJob(deps, await claimedJob(store, { agent: "chief_of_staff", trigger: "manual", payload: {} }));
    expect(outcome.status).toBe("done");
    const content = store.reports[0]!.content as { conflicts: unknown[]; topActions: unknown[]; omitted: number };
    expect(content.conflicts).toHaveLength(0);
    expect(content.topActions).toHaveLength(1);
    expect(content.omitted).toBe(1);
  });
});

