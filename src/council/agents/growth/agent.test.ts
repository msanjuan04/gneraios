import { describe, expect, it } from "vitest";
import { runEval, scenariosFor } from "../../evals/run";
import { growth } from "./agent";

// Crecimiento y SEO: su definición y sus escenarios de evaluación (src/council/evals/scenarios)
// de principio a fin con las respuestas grabadas.

describe("crecimiento y SEO", () => {
  it("el día 15 de cada mes, con SEO, fuentes e ingresos", () => {
    expect(growth.schedules).toEqual([{ task: "scan", trigger: "monthly", schedule: { kind: "monthly", day: 15, hour: 8 } }]);
    expect(growth.tools).toEqual(expect.arrayContaining(["get_seo_summary", "get_conversion_by_source", "get_revenue"]));
  });

  it.each(scenariosFor("growth").map((s) => [s.id, s] as const))("eval %s", async (_id, scenario) => {
    const result = await runEval(scenario, { kind: "replay" });
    expect(result.checks.filter((c) => !c.passed)).toEqual([]);
  });
});
