import { describe, expect, it } from "vitest";
import { loadScenarios, runEval, summarize } from "./run";

// Los evals con las respuestas grabadas (sin red): cada escenario pasa entero por el runner real
// (tools, guardarraíles, silencio útil, deduplicación, abogado del diablo, presupuesto) y se puntúa.
// Contra el modelo real: `pnpm council:evals --live`.

const scenarios = loadScenarios();

describe("evals del consejo", () => {
  it("hay al menos 15 escenarios y cubren a todos los agentes que trabajan solos", () => {
    expect(scenarios.length).toBeGreaterThanOrEqual(15);
    const agents = new Set(scenarios.map((s) => s.job.agent));
    for (const agent of ["cfo", "commercial", "pricing", "retention", "operations", "growth", "fiscal", "chief_of_staff"]) expect(agents).toContain(agent);
    // El abogado del diablo no se lanza solo: se evalúa a través de lo que revisa.
    expect(scenarios.some((s) => Object.keys(s.replay).some((k) => k.startsWith("devils_advocate")))).toBe(true);
  });

  it.each(scenarios.map((s) => [s.id, s] as const))("%s", async (_id, scenario) => {
    const result = await runEval(scenario, { kind: "replay" });
    const failed = result.checks.filter((c) => !c.passed).map((c) => `[${c.dimension}] ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
    expect(failed, result.error ?? undefined).toEqual([]);
    expect(result.checks.length).toBeGreaterThan(0);
  });

  it("puntúa las cuatro preguntas en el conjunto", async () => {
    const results = await Promise.all(scenarios.map((s) => runEval(s, { kind: "replay" })));
    const summary = summarize(results);
    for (const dimension of ["tools", "policy", "professional", "silence"] as const) expect(summary[dimension].total).toBeGreaterThan(0);
  });
});
