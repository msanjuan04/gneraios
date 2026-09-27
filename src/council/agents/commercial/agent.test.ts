import { describe, expect, it } from "vitest";
import { runEval, scenariosFor } from "../../evals/run";
import { commercial } from "./agent";

// Director comercial: su definición y sus escenarios de evaluación (src/council/evals/scenarios)
// de principio a fin con las respuestas grabadas.

describe("director comercial", () => {
  it("diario a las 8:00, con el pipeline y sin tools de caja", () => {
    expect(commercial.schedules).toEqual([{ task: "scan", trigger: "daily", schedule: { kind: "daily", hour: 8 } }]);
    expect(commercial.tools).toEqual(expect.arrayContaining(["get_pipeline", "get_stalled_deals", "get_conversion_by_source", "get_policy"]));
    // Solo lectura y solo lo suyo: nada de caja ni de impuestos.
    expect(commercial.tools).not.toContain("get_cash_position");
    expect(commercial.tools).not.toContain("get_tax_provisions");
  });

  it.each(scenariosFor("commercial").map((s) => [s.id, s] as const))("eval %s", async (_id, scenario) => {
    const result = await runEval(scenario, { kind: "replay" });
    expect(result.checks.filter((c) => !c.passed)).toEqual([]);
  });
});
