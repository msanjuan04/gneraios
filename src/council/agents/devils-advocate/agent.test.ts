import { describe, expect, it } from "vitest";
import { runEval, scenariosFor } from "../../evals/run";
import { allowedTools } from "../index";
import { devilsAdvocate } from "./agent";

// Abogado del diablo: no se lanza solo ni tiene horario; revisa lo de impacto alto con las tools
// del agente revisado. Sus escenarios: descartar, publicar con matices y dejar pasar.

describe("abogado del diablo", () => {
  it("sin horario ni «Ejecutar ahora», con las tools del revisado (más política y simulación)", () => {
    expect(devilsAdvocate.manualTask).toBeNull();
    expect(devilsAdvocate.schedules).toEqual([]);
    expect([...allowedTools("devils_advocate", "retention")]).toEqual(expect.arrayContaining(["get_at_risk_clients", "get_receivables", "get_policy", "simulate"]));
    expect([...allowedTools("devils_advocate", "retention")]).not.toContain("get_cash_position");
  });

  it.each(scenariosFor("devils_advocate").map((s) => [s.id, s] as const))("eval %s", async (_id, scenario) => {
    const result = await runEval(scenario, { kind: "replay" });
    expect(result.checks.filter((c) => !c.passed)).toEqual([]);
  });
});
