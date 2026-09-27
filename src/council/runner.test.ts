import { describe, expect, it } from "vitest";
import { MISSING_API_KEY, runJob, runPendingJobs } from "./runner";
import type { FakeScript, FakeSession } from "./runtime/fake";
import { dueScheduledJobs, isoWeekKey, localNow, weekRange } from "./schedule";
import { claimedJob, memoryStore, ORG_ID, runnerDeps } from "./testing";

// El runner con FakeRuntime: guardarraíles y regeneración, silencio útil, deduplicación, abogado
// del diablo, presupuesto, agentes desactivados y la falta de clave de la API.

const retentionRec = (overrides: Record<string, unknown> = {}) => ({
  kind: "decision",
  title: "Reclamar hoy las facturas vencidas de Mar Blau",
  summary: "Mar Blau debe 1.452 € con 57 días de retraso y no hay actividad desde hace 117 días.",
  reasoning: "Tiene 3 facturas vencidas y un MRR de 750 € en juego.",
  evidence: ["receivables.client.c2.overdue", "receivables.client.c2.max_days", "risk.c2.quiet_days", "receivables.client.c2.count", "risk.c2.mrr"],
  impact_ref: "receivables.client.c2.overdue",
  proposed_actions: [{ title: "Llamar a la clínica para acordar el pago", due_in_days: 0 }],
  confidence: "alta",
  urgency: "hoy",
  risks: "Que el cliente se moleste si la llamada es brusca.",
  requires_professional_review: false,
  subject: "client:c2",
  policy_rule: null,
  missing_data: [],
  ...overrides,
});

const retentionScan =
  (rec: Record<string, unknown> = {}): FakeScript =>
  async (s) => {
    await s.call("get_at_risk_clients");
    await s.call("get_receivables");
    return { recommendations: [retentionRec(rec)], silence_reason: null };
  };

const commercialScan: FakeScript = async (s) => {
  await s.call("get_stalled_deals");
  return {
    recommendations: [
      {
        kind: "decision",
        title: "Llamar hoy a Tallers Rius para cerrar la tienda online",
        summary: "La tienda online lleva 47 días parada en Propuesta enviada y la próxima acción venció hace 25 días.",
        reasoning: "El deal pondera 3.250 € one-off.",
        evidence: ["deal.d1.days_stalled", "deal.d1.action_late", "deal.d1.weighted_one_off"],
        impact_ref: "deal.d1.weighted_one_off",
        proposed_actions: [{ title: "Llamar a Tallers Rius", due_in_days: 0 }],
        confidence: "media",
        urgency: "hoy",
        risks: "Que ya lo tengan con otra agencia.",
        requires_professional_review: false,
        subject: "deal:d1",
        policy_rule: null,
        missing_data: [],
      },
    ],
    silence_reason: null,
  };
};

const challenge =
  (verdict: "publicar" | "publicar_con_cambios" | "descartar"): FakeScript =>
  async (s: FakeSession) => {
    await s.call("get_stalled_deals");
    return {
      verdict,
      weak_assumptions: ["Que el cliente siga interesado tras 47 días sin respuesta."],
      risks: "El deal lleva 47 días parado: la probabilidad real puede ser menor.",
      pessimistic_scenario: "Si se pierde, no entran los 3.250 € ponderados.",
      evidence: ["deal.d1.days_stalled", "deal.d1.weighted_one_off"],
      confidence: "baja",
    };
  };

describe("runJob", () => {
  it("publica la recomendación con su evidencia resuelta y registra la ejecución", async () => {
    const deps = runnerDeps({ scripts: { "retention:scan": retentionScan() } });
    const outcome = await runJob(deps, await claimedJob(deps.store, { agent: "retention", trigger: "manual", payload: {} }));
    expect(outcome).toMatchObject({ status: "done", error: null });
    const rec = deps.store.recommendations[0]!;
    expect(rec).toMatchObject({ title: "Reclamar hoy las facturas vencidas de Mar Blau", impactCents: 145_200, confidence: "alta", urgency: "hoy", dedupeKey: "retention:client:c2", policyVersion: null });
    expect(rec.evidence.map((e) => e.key)).toEqual(["receivables.client.c2.overdue", "receivables.client.c2.max_days", "risk.c2.quiet_days", "receivables.client.c2.count", "risk.c2.mrr"]);
    expect(rec.evidence[0]).toMatchObject({ tool: "get_receivables", period: "2026-09-26", href: "/invoices?client=c2" });
    const run = deps.store.runs[0]!;
    expect(run).toMatchObject({ agent: "retention", model: "claude-sonnet-5", status: "succeeded", attempts: 1 });
    expect(run.toolCalls.map((c) => [c.name, c.status])).toEqual([
      ["get_at_risk_clients", "ok"],
      ["get_receivables", "ok"],
    ]);
    expect(run.output).toMatchObject({ published: [rec.id] });
  });

  it("si una cifra no sale de la evidencia, le pide que lo rehaga (y a la segunda vale)", async () => {
    const script: FakeScript = async (s) => {
      const out = await retentionScan(s.attempt === 1 ? { summary: "Mar Blau debe 1.452 € y perderíamos 9.000 € al año si se va." } : {})(s);
      return out;
    };
    const deps = runnerDeps({ scripts: { retention: script } });
    const outcome = await runJob(deps, await claimedJob(deps.store, { agent: "retention", trigger: "weekly", payload: {} }));
    expect(outcome.status).toBe("done");
    expect(deps.store.recommendations).toHaveLength(1);
    expect(deps.store.runs[0]!.attempts).toBe(2);
    const second = deps.runtime.requests[0];
    expect(second?.maxRetries).toBe(2);
  });

  it("si sigue inventando después de dos regeneraciones, no se publica", async () => {
    const deps = runnerDeps({ scripts: { retention: retentionScan({ summary: "Perderíamos 9.000 € al año." }) } });
    const outcome = await runJob(deps, await claimedJob(deps.store, { agent: "retention", trigger: "weekly", payload: {} }));
    expect(outcome.status).toBe("failed");
    expect(deps.store.recommendations).toHaveLength(0);
    expect(deps.store.runs[0]).toMatchObject({ attempts: 3, status: "failed" });
    expect(outcome.silenced[0]!.reason).toMatch(/9\.000/);
  });

  it("silencio útil: por debajo del umbral de impacto de la política no se publica", async () => {
    const deps = runnerDeps({ scripts: { retention: retentionScan({ impact_ref: "receivables.client.c2.count", evidence: ["risk.c2.mrr", "receivables.client.c2.count", "receivables.client.c2.overdue", "receivables.client.c2.max_days", "risk.c2.quiet_days"] }) } });
    // count no es una métrica en € → se rechaza; con el MRR (750 €) sí es € y pasa el umbral de 300 €.
    const first = await runJob(deps, await claimedJob(deps.store, { agent: "retention", trigger: "weekly", payload: {} }));
    expect(first.status).toBe("failed");
    const low = runnerDeps({
      scripts: {
        retention: async (s) => {
          await s.call("get_upsell_candidates");
          return {
            recommendations: [
              {
                ...retentionRec(),
                title: "Proponer SEO local a Can Sorra",
                summary: "Can Sorra tiene web y no tiene SEO: un MRR de 90 € hoy.",
                reasoning: "Regla de la org: web sin SEO.",
                evidence: ["upsell.rule-web-seo.c1.mrr"],
                impact_ref: "upsell.rule-web-seo.c1.mrr",
                subject: "upsell:rule-web-seo:c1",
              },
            ],
            silence_reason: null,
          };
        },
      },
    });
    const outcome = await runJob(low, await claimedJob(low.store, { agent: "retention", trigger: "weekly", payload: {} }));
    expect(outcome.status).toBe("done");
    expect(low.store.recommendations).toHaveLength(0);
    expect(outcome.silenced).toEqual([{ title: "Proponer SEO local a Can Sorra", reason: "Impacto por debajo del umbral de la política." }]);
  });

  it("no repite lo que sigue abierto ni lo descartado hace poco", async () => {
    const store = memoryStore();
    const deps = runnerDeps({ store, scripts: { retention: retentionScan() } });
    await runJob(deps, await claimedJob(store, { agent: "retention", trigger: "weekly", payload: {} }));
    const again = await runJob(deps, await claimedJob(store, { agent: "retention", trigger: "manual", payload: {} }));
    expect(again.silenced).toEqual([{ title: "Reclamar hoy las facturas vencidas de Mar Blau", reason: "Ya hay una abierta sobre lo mismo." }]);
    store.decide(store.recommendations[0]!.id, "descartada", "Ya han pagado por transferencia");
    const third = await runJob(deps, await claimedJob(store, { agent: "retention", trigger: "manual", payload: {} }));
    expect(third.silenced[0]!.reason).toBe("Se descartó hace poco.");
    // El motivo del descarte vuelve al agente en la tarea siguiente.
    expect(deps.runtime.requests.at(-1)!.prompt).toMatch(/Ya han pagado por transferencia/);
  });

  it("el abogado del diablo revisa lo de impacto alto: si lo descarta, no se publica", async () => {
    const deps = runnerDeps({ scripts: { "commercial:scan": commercialScan, "devils_advocate:challenge": challenge("descartar") } });
    const outcome = await runJob(deps, await claimedJob(deps.store, { agent: "commercial", trigger: "daily", payload: {} }));
    expect(outcome.status).toBe("done");
    expect(deps.store.recommendations).toHaveLength(0);
    expect(outcome.silenced[0]!.reason).toMatch(/abogado del diablo/);
    const da = deps.store.runs.find((r) => r.agent === "devils_advocate")!;
    expect(da).toMatchObject({ parentRunId: deps.store.runs[0]!.id, model: "claude-opus-5-5", trigger: "challenge" });
    // Solo con las tools del agente revisado (más política y simulación).
    expect(deps.runtime.requests.at(-1)!.prompt).toMatch(/get_stalled_deals/);
    expect(deps.runtime.requests.at(-1)!.prompt).not.toMatch(/get_cash_position/);
  });

  it("…y si pide cambios, se publica con su revisión, su riesgo y su confianza", async () => {
    const deps = runnerDeps({ scripts: { "commercial:scan": commercialScan, "devils_advocate:challenge": challenge("publicar_con_cambios") } });
    await runJob(deps, await claimedJob(deps.store, { agent: "commercial", trigger: "daily", payload: {} }));
    const rec = deps.store.recommendations[0]!;
    expect(rec.confidence).toBe("baja");
    expect(rec.risks).toMatch(/probabilidad real/);
    expect(rec.challenge).toMatchObject({ status: "revisada", verdict: "publicar_con_cambios" });
  });

  it("una tool fuera de su lista se deniega y queda en el registro", async () => {
    const deps = runnerDeps({
      scripts: {
        retention: async (s) => {
          const denied = await s.call("get_cash_position");
          expect(denied.isError).toBe(true);
          return retentionScan()(s);
        },
      },
    });
    await runJob(deps, await claimedJob(deps.store, { agent: "retention", trigger: "weekly", payload: {} }));
    expect(deps.store.runs[0]!.toolCalls[0]).toMatchObject({ name: "get_cash_position", status: "denied" });
  });

  it("sin clave de la API no ejecuta nada y lo dice", async () => {
    const deps = runnerDeps({ scripts: { retention: retentionScan() }, apiKey: false });
    const outcome = await runJob(deps, await claimedJob(deps.store, { agent: "retention", trigger: "manual", payload: {} }));
    expect(outcome).toMatchObject({ status: "failed", error: MISSING_API_KEY, runId: null });
    expect(deps.store.runs).toHaveLength(0);
    expect(deps.runtime.requests).toHaveLength(0);
  });

  it("un agente desactivado o sin presupuesto se salta", async () => {
    const off = runnerDeps({ store: memoryStore({ settings: [{ agent: "retention", enabled: false, model: null, monthlyBudgetUsdCents: null, thresholds: {} }] }), scripts: { retention: retentionScan() } });
    expect((await runJob(off, await claimedJob(off.store, { agent: "retention", trigger: "manual", payload: {} }))).status).toBe("skipped");
    const broke = runnerDeps({ store: memoryStore({ settings: [{ agent: "retention", enabled: true, model: null, monthlyBudgetUsdCents: 0, thresholds: {} }] }), scripts: { retention: retentionScan() } });
    const outcome = await runJob(broke, await claimedJob(broke.store, { agent: "retention", trigger: "manual", payload: {} }));
    expect(outcome).toMatchObject({ status: "skipped" });
    expect(outcome.error).toMatch(/Presupuesto/);
    expect(broke.runtime.requests).toHaveLength(0);
  });

  it("el modelo y los umbrales de los ajustes mandan sobre los de por defecto", async () => {
    const store = memoryStore({ settings: [{ agent: "retention", enabled: true, model: "claude-opus-5-5", monthlyBudgetUsdCents: 500, thresholds: { max_recommendations: 0 } }] });
    const deps = runnerDeps({ store, scripts: { retention: retentionScan() } });
    const outcome = await runJob(deps, await claimedJob(store, { agent: "retention", trigger: "manual", payload: {} }));
    expect(deps.runtime.requests[0]!.model).toBe("claude-opus-5-5");
    expect(outcome.silenced[0]!.reason).toMatch(/Más de 0/);
  });
});

describe("runPendingJobs y programación", () => {
  it("vacía la cola de uno en uno", async () => {
    const deps = runnerDeps({ scripts: { retention: retentionScan(), commercial: async () => ({ recommendations: [], silence_reason: "Nada parado." }) } });
    await deps.store.enqueueJob({ orgId: ORG_ID, agent: "retention", trigger: "weekly" });
    await deps.store.enqueueJob({ orgId: ORG_ID, agent: "commercial", trigger: "daily" });
    const outcomes = await runPendingJobs(deps);
    expect(outcomes.map((o) => [o.agent, o.status])).toEqual([
      ["retention", "done"],
      ["commercial", "done"],
    ]);
    expect(deps.store.jobs.every((j) => j.status === "done")).toBe(true);
  });

  it("el lunes a las 8:00 de Madrid toca el briefing; el día 5, el cierre del mes anterior", () => {
    const monday = dueScheduledJobs({ orgId: ORG_ID, timeZone: "Europe/Madrid", now: new Date("2026-09-28T06:05:00Z"), settings: [] });
    expect(monday.map((j) => j.dedupeKey)).toEqual(expect.arrayContaining(["commercial:daily:2026-09-28", "chief_of_staff:weekly_briefing:2026-W40"]));
    // Los mensuales ya pasados en el mes también salen (se recuperan), una vez por mes por su clave.
    expect(monday.map((j) => j.dedupeKey)).toContain("cfo:monthly_close:2026-09");
    const early = dueScheduledJobs({ orgId: ORG_ID, timeZone: "Europe/Madrid", now: new Date("2026-09-28T05:30:00Z"), settings: [] });
    expect(early.map((j) => j.agent)).not.toContain("chief_of_staff");
    expect(early.map((j) => j.agent)).not.toContain("commercial");
    const fifth = dueScheduledJobs({ orgId: ORG_ID, timeZone: "Europe/Madrid", now: new Date("2026-10-05T09:00:00Z"), settings: [] });
    const close = fifth.find((j) => j.agent === "cfo")!;
    expect(close).toMatchObject({ trigger: "monthly_close", payload: { task: "monthly_close", month: "2026-09-01" }, dedupeKey: "cfo:monthly_close:2026-10" });
    expect(fifth.find((j) => j.agent === "fiscal")?.dedupeKey).toBe("fiscal:monthly:2026-10");
    const disabled = dueScheduledJobs({ orgId: ORG_ID, timeZone: "Europe/Madrid", now: new Date("2026-10-05T09:00:00Z"), settings: [{ agent: "cfo", enabled: false, model: null, monthlyBudgetUsdCents: null, thresholds: {} }] });
    expect(disabled.some((j) => j.agent === "cfo")).toBe(false);
  });

  it("semanas ISO, lunes a domingo y la hora local con cambio de horario", () => {
    expect(isoWeekKey("2026-09-26")).toBe("2026-W39");
    expect(isoWeekKey("2026-12-31")).toBe("2026-W53");
    expect(isoWeekKey("2027-01-04")).toBe("2027-W01");
    expect(weekRange("2026-09-26")).toEqual({ from: "2026-09-21", to: "2026-09-27" });
    expect(localNow(new Date("2026-10-25T06:30:00Z"), "Europe/Madrid")).toEqual({ date: "2026-10-25", hour: 7, weekday: 7 });
  });
});
