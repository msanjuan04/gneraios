import { describe, expect, it } from "vitest";
import { runEval, scenariosFor } from "../../evals/run";
import { retention } from "./agent";

// Retención y upsell: su definición y sus escenarios de evaluación (src/council/evals/scenarios)
// de principio a fin con las respuestas grabadas.

describe("retención y upsell", () => {
  it("los miércoles, con riesgo, renovaciones, venta cruzada y cobros", () => {
    expect(retention.schedules).toEqual([{ task: "scan", trigger: "weekly", schedule: { kind: "weekly", weekday: 3, hour: 8 } }]);
    expect(retention.tools).toEqual(expect.arrayContaining(["get_at_risk_clients", "get_renewals", "get_upsell_candidates", "get_receivables"]));
  });

  it.each(scenariosFor("retention").map((s) => [s.id, s] as const))("eval %s", async (_id, scenario) => {
    const result = await runEval(scenario, { kind: "replay" });
    expect(result.checks.filter((c) => !c.passed)).toEqual([]);
  });
});
