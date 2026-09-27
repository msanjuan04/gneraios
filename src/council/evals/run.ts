// Ejecuta un escenario de principio a fin con el runner de verdad: datos del escenario, almacén en
// memoria y, como modelo, las respuestas grabadas (por defecto) o Claude (`live`). Después puntúa.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { runJob, type JobOutcome, type RunnerDeps } from "../runner";
import { ClaudeRuntime } from "../runtime/claude";
import { FakeRuntime } from "../runtime/fake";
import type { AgentRuntime } from "../runtime/types";
import { claimedJob, fixtureData } from "../testing";
import { DEFAULT_NOW, scenarioData, scenarioPolicy, scenarioStore } from "./build";
import { RecordingRuntime, replayScript } from "./replay";
import { scoreEval } from "./score";
import { DIMENSIONS, type Dimension, type EvalResult, type EvalScenario, evalScenarioSchema } from "./types";

export type EvalMode = { kind: "replay" } | { kind: "live"; apiKey: string };

export const SCENARIOS_DIR = path.join(process.cwd(), "src/council/evals/scenarios");

/** Los escenarios de la carpeta, validados (lanza con el nombre del fichero si alguno no lo está). */
export function loadScenarios(dir = SCENARIOS_DIR): EvalScenario[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((file) => {
      const parsed = evalScenarioSchema.safeParse(JSON.parse(readFileSync(path.join(dir, file), "utf8")));
      if (!parsed.success) throw new Error(`${file}: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
      if (`${parsed.data.id}.json` !== file.replace(/^\d+-/, "")) throw new Error(`${file}: el id «${parsed.data.id}» no coincide con el nombre del fichero`);
      return parsed.data;
    });
}

/** Los escenarios en los que trabaja un agente (el que se lanza o, el abogado del diablo, el que revisa). */
export function scenariosFor(agent: string, all: readonly EvalScenario[] = loadScenarios()): EvalScenario[] {
  return all.filter((s) => s.job.agent === agent || Object.keys(s.replay).some((key) => key.split(":")[0] === agent));
}

export async function runEval(scenario: EvalScenario, mode: EvalMode): Promise<EvalResult> {
  const now = new Date(scenario.now ?? DEFAULT_NOW);
  const { data } = fixtureData(scenarioData(scenario, now));
  const { store, existingIds } = await scenarioStore(scenario, now);
  const inner: AgentRuntime =
    mode.kind === "live"
      ? new ClaudeRuntime({ apiKey: mode.apiKey })
      : new FakeRuntime((request) => {
          const attempts = scenario.replay[`${request.agent}:${request.task}`] ?? scenario.replay[request.agent];
          return attempts ? replayScript(attempts, existingIds) : null;
        });
  const runtime = new RecordingRuntime(inner);
  const deps: RunnerDeps = { store, dataFor: () => data, runtimeFor: () => runtime, now: () => now };

  const started = Date.now();
  let outcome: JobOutcome;
  let error: string | null = null;
  try {
    outcome = await runJob(deps, await claimedJob(store, { agent: scenario.job.agent, trigger: scenario.job.trigger, payload: scenario.job.payload }));
    error = outcome.status === scenario.expect.status ? null : outcome.error;
  } catch (thrown) {
    error = thrown instanceof Error ? thrown.message : String(thrown);
    outcome = { jobId: "", orgId: "", agent: scenario.job.agent, trigger: scenario.job.trigger, status: "failed", runId: null, published: [], reportId: null, silenced: [], error };
  }
  const checks = scoreEval({
    scenario,
    mode: mode.kind,
    outcome,
    store,
    existingIds,
    captured: runtime.runs,
    policyVersion: scenarioPolicy(scenario) ? 1 : null,
  });
  const existing = new Set(existingIds);
  const mainRun = store.runs.find((r) => r.agent === scenario.job.agent && r.parentRunId === null);
  return {
    id: scenario.id,
    title: scenario.title,
    agent: scenario.job.agent,
    mode: mode.kind,
    passed: checks.every((c) => c.passed),
    checks,
    status: outcome.status,
    published: store.recommendations.filter((r) => !existing.has(r.id)).map((r) => ({ title: r.title, impactCents: r.impactCents, professional: r.requiresProfessionalReview })),
    silenced: outcome.silenced,
    attempts: mainRun?.attempts ?? 0,
    costUsdMicros: store.runs.reduce((sum, r) => sum + r.costUsdMicros, 0),
    durationMs: Date.now() - started,
    error,
  };
}

/** Aciertos por dimensión (comprobaciones pasadas / hechas) en todos los escenarios. */
export function summarize(results: readonly EvalResult[]): Record<Dimension, { passed: number; total: number }> {
  const out = Object.fromEntries(DIMENSIONS.map((d) => [d, { passed: 0, total: 0 }])) as Record<Dimension, { passed: number; total: number }>;
  for (const result of results) {
    for (const check of result.checks) {
      out[check.dimension].total += 1;
      if (check.passed) out[check.dimension].passed += 1;
    }
  }
  return out;
}
