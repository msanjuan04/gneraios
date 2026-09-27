import { describe, expect, it } from "vitest";
import { runEval, scenariosFor } from "../../evals/run";
import { fiscal } from "./agent";

// Fiscal y cumplimiento: su definición y sus escenarios de evaluación (src/council/evals/scenarios)
// de principio a fin con las respuestas grabadas.

describe("fiscal y cumplimiento", () => {
  it("el día 1 de cada mes, con impuestos y caja", () => {
    expect(fiscal.schedules).toEqual([{ task: "scan", trigger: "monthly", schedule: { kind: "monthly", day: 1, hour: 8 } }]);
    expect(fiscal.tools).toEqual(expect.arrayContaining(["get_tax_provisions", "get_cash_position", "get_policy"]));
  });

  it.each(scenariosFor("fiscal").map((s) => [s.id, s] as const))("eval %s", async (_id, scenario) => {
    const result = await runEval(scenario, { kind: "replay" });
    expect(result.checks.filter((c) => !c.passed)).toEqual([]);
  });
});
