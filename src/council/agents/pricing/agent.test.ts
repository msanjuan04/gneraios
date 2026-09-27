import { describe, expect, it } from "vitest";
import { runEval, scenariosFor } from "../../evals/run";
import { pricing } from "./agent";

// Pricing y margen: su definición y sus escenarios de evaluación (src/council/evals/scenarios)
// de principio a fin con las respuestas grabadas.

describe("pricing y margen", () => {
  it("el día 10 de cada mes, con rentabilidad, ingresos y simulación", () => {
    expect(pricing.schedules).toEqual([{ task: "scan", trigger: "monthly", schedule: { kind: "monthly", day: 10, hour: 8 } }]);
    expect(pricing.tools).toEqual(expect.arrayContaining(["get_client_profitability", "get_revenue", "simulate", "get_policy"]));
  });

  it.each(scenariosFor("pricing").map((s) => [s.id, s] as const))("eval %s", async (_id, scenario) => {
    const result = await runEval(scenario, { kind: "replay" });
    expect(result.checks.filter((c) => !c.passed)).toEqual([]);
  });
});
