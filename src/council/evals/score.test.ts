import { describe, expect, it } from "vitest";
import type { JobOutcome } from "../runner";
import type { NewRecommendation } from "../store/types";
import { memoryStore, ORG_ID } from "../testing";
import type { CapturedRun } from "./replay";
import { scoreEval } from "./score";
import { type EvalScenario, evalScenarioSchema } from "./types";

// El puntuador no se fía del runner: si algo inventado, fuera de política o sin marcar llegara a
// publicarse, los evals lo tienen que suspender.

const scenario = (expect: Record<string, unknown>): EvalScenario =>
  evalScenarioSchema.parse({ id: "x", title: "Prueba", description: "Prueba del puntuador", job: { agent: "cfo", trigger: "manual" }, expect });

const outcome = (overrides: Partial<JobOutcome> = {}): JobOutcome => ({
  jobId: "j",
  orgId: ORG_ID,
  agent: "cfo",
  trigger: "manual",
  status: "done",
  runId: "r",
  published: [],
  reportId: null,
  silenced: [],
  error: null,
  ...overrides,
});

const evidence = { ref: "m1", tool: "get_monthly_close", key: "close.profit", label: "Beneficio de ago 2026", value: 194_000, unit: "eur_cents", display: "1.940 €", period: "2026-08", source: "Facturas y gastos", href: "/finance" };

const draft = (overrides: Partial<NewRecommendation>): NewRecommendation => ({
  agent: "cfo",
  runId: "r",
  kind: "decision",
  title: "Repartir el beneficio de agosto",
  summary: "El beneficio de agosto fue de 1.940 €.",
  reasoning: "Según el cierre.",
  evidence: [evidence],
  proposedActions: [],
  missingData: [],
  impactCents: 194_000,
  confidence: "media",
  urgency: "este_mes",
  risks: null,
  requiresProfessionalReview: false,
  challenge: null,
  policyVersion: null,
  subject: "close:2026-08",
  dedupeKey: "cfo:close:2026-08",
  ...overrides,
});

async function score(rec: Partial<NewRecommendation>, expectation: Record<string, unknown> = {}, captured: CapturedRun[] = []) {
  const store = memoryStore();
  await store.startRun({ orgId: ORG_ID, agent: "cfo", jobId: "j", parentRunId: null, trigger: "manual", runtime: "fake", model: "claude-opus-5-5", input: {}, policyVersion: null });
  store.runs[0]!.toolCalls = [{ id: "t1", name: "get_monthly_close", input: {}, status: "ok", summary: "", durationMs: 1 }];
  await store.insertRecommendations(ORG_ID, [draft(rec)]);
  const checks = scoreEval({ scenario: scenario(expectation), mode: "replay", outcome: outcome(), store, existingIds: [], captured, policyVersion: null });
  return checks.filter((c) => !c.passed).map((c) => `${c.dimension}: ${c.name}`);
}

describe("puntuación de los evals", () => {
  it("una recomendación correcta pasa", async () => {
    expect(await score({})).toEqual([]);
  });

  it("suspende una cifra que no está en la evidencia", async () => {
    expect(await score({ summary: "El beneficio de agosto fue de 1.940 € y el de septiembre será de 2.300 €." })).toEqual(["tools: cifras con evidencia · Repartir el beneficio de agosto"]);
  });

  it("suspende evidencia de una tool que no se llamó", async () => {
    expect(await score({ evidence: [{ ...evidence, tool: "get_cash_position" }] })).toEqual(["tools: evidencia de tools llamadas · Repartir el beneficio de agosto"]);
  });

  it("suspende lo fiscal sin marcar y lo que se presenta como asesoramiento", async () => {
    expect(await score({ summary: "El beneficio de agosto fue de 1.940 €: no hace falta consultar a la gestoría el Impuesto de Sociedades." })).toEqual([
      "professional: marca «Validar con gestoría» · Repartir el beneficio de agosto",
      "professional: no se presenta como asesoramiento · Repartir el beneficio de agosto",
    ]);
  });

  it("suspende subir la retribución si get_policy dice que la regla no se cumple", async () => {
    const captured: CapturedRun[] = [
      {
        agent: "cfo",
        task: "monthly_close",
        model: "claude-opus-5-5",
        prompt: "",
        replies: [{ name: "get_policy", input: {}, isError: false, content: JSON.stringify({ rows: [{ subject: "policy:rule:raise_partner_pay", label: "Regla", fields: { estado: "no cumple" }, metrics: [] }] }) }],
      },
    ];
    const failed = await score({ title: "Subir la retribución de los socios", requiresProfessionalReview: true }, { forbid: ["retribuci"] }, captured);
    expect(failed).toEqual(["policy: propone subir la retribución solo si la regla se cumple", "policy: no propone /retribuci/"]);
  });

  it("suspende la versión de la política equivocada y hablar cuando tocaba callarse", async () => {
    expect(await score({ policyVersion: 3 }, { silent: true })).toEqual(["policy: cita la política vigente (la de ejemplo) · Repartir el beneficio de agosto", "silence: se calla"]);
  });
});
