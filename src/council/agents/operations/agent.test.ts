import { describe, expect, it } from "vitest";
import { runEval, scenariosFor } from "../../evals/run";
import { operations } from "./agent";

// Operaciones y capacidad: su definición y sus escenarios de evaluación (src/council/evals/scenarios)
// de principio a fin con las respuestas grabadas.

describe("operaciones y capacidad", () => {
  it("los jueves, con capacidad, pipeline y la regla de contratar", () => {
    expect(operations.schedules).toEqual([{ task: "scan", trigger: "weekly", schedule: { kind: "weekly", weekday: 4, hour: 8 } }]);
    expect(operations.tools).toEqual(expect.arrayContaining(["get_capacity", "get_pipeline", "get_policy"]));
  });

  it.each(scenariosFor("operations").map((s) => [s.id, s] as const))("eval %s", async (_id, scenario) => {
    const result = await runEval(scenario, { kind: "replay" });
    expect(result.checks.filter((c) => !c.passed)).toEqual([]);
  });
});
