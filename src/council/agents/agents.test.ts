import { describe, expect, it } from "vitest";
import { AGENT_CONFIG, COUNCIL_MODELS, DEEP_MODEL } from "../agents.config";
import { TOOL_NAMES } from "../tools/registry";
import { AGENT_NAMES } from "../types";
import { AGENTS, allowedTools } from "./index";
import { sharedContext, taskPrompt } from "./context";
import { loadPrompt } from "./prompts";
import { fixtureData, TODAY } from "../testing";
import { resolvePolicy } from "../policy/schema";

// Los nueve agentes como definiciones: tools que existen, prompts que se leen del disco,
// disparadores con sentido y los modelos de CONSEJO.md §5.

describe("agentes del consejo", () => {
  it("están los nueve, con su prompt en disco", async () => {
    expect(Object.keys(AGENTS).sort()).toEqual([...AGENT_NAMES].sort());
    for (const name of AGENT_NAMES) {
      const prompt = await loadPrompt(name);
      expect(prompt.length, name).toBeGreaterThan(400);
      expect(prompt.startsWith("# "), name).toBe(true);
    }
    expect(await loadPrompt("shared")).toMatch(/No calculas nunca/);
  });

  it("solo usan tools que existen; el Chief of Staff las tiene todas y el abogado del diablo las del revisado", () => {
    for (const name of AGENT_NAMES) for (const tool of AGENTS[name].tools) expect(TOOL_NAMES, `${name}: ${tool}`).toContain(tool);
    expect([...allowedTools("chief_of_staff")].sort()).toEqual([...TOOL_NAMES].sort());
    expect([...allowedTools("devils_advocate", "commercial")].sort()).toEqual(["get_conversion_by_source", "get_past_recommendations", "get_pipeline", "get_policy", "get_stalled_deals", "simulate"]);
    for (const name of AGENT_NAMES.filter((n) => n !== "devils_advocate")) expect(AGENTS[name].tools, name).toContain("get_policy");
  });

  it("disparadores y modelos: diario, semanal y mensual; Opus para el cierre, el abogado del diablo y el Chief of Staff", () => {
    for (const name of AGENT_NAMES) {
      for (const { schedule } of AGENTS[name].schedules) {
        expect(schedule.hour).toBeGreaterThanOrEqual(0);
        expect(schedule.hour).toBeLessThan(24);
        if (schedule.kind === "weekly") expect(schedule.weekday).toBeGreaterThanOrEqual(1);
        if (schedule.kind === "monthly") expect(schedule.day).toBeLessThanOrEqual(28);
      }
      expect(COUNCIL_MODELS).toContain(AGENT_CONFIG[name].model);
    }
    expect(AGENTS.devils_advocate.manualTask).toBeNull();
    expect(AGENTS.devils_advocate.schedules).toEqual([]);
    expect(AGENT_CONFIG.cfo.modelByTask?.monthly_close).toBe(DEEP_MODEL);
    expect(AGENT_CONFIG.devils_advocate.model).toBe(DEEP_MODEL);
    expect(AGENT_CONFIG.chief_of_staff.model).toBe(DEEP_MODEL);
    expect(AGENT_CONFIG.commercial.model).toBe("claude-sonnet-5");
  });

  it("el contexto compartido es determinista y no lleva ni la fecha de hoy ni cifras que copiar", async () => {
    const { data } = fixtureData();
    const rules = await loadPrompt("shared");
    const a = await sharedContext({ rules, data, policy: resolvePolicy(null), today: TODAY });
    const b = await sharedContext({ rules, data, policy: resolvePolicy(null), today: TODAY });
    expect(a).toBe(b);
    expect(a).not.toContain(TODAY);
    expect(a).toMatch(/Política de EJEMPLO/);
    expect(a).toMatch(/Mantenimiento web \(mensual\)/);
    expect(a).not.toMatch(/Gestión de Meta Ads/); // terminó hace meses y no se firmó en el último año
  });

  it("la tarea de hoy lleva la fecha, las tools permitidas y los motivos de los descartes", () => {
    const prompt = taskPrompt({
      agent: "retention",
      task: "scan",
      trigger: "weekly",
      today: TODAY,
      timeZone: "Europe/Madrid",
      tools: ["get_at_risk_clients"],
      maxRecommendations: 3,
      past: [
        {
          id: "r1",
          agent: "retention",
          kind: "decision",
          title: "Subir precios a hostelería",
          summary: "",
          status: "descartada",
          subject: "client:c1",
          dedupeKey: "retention:client:c1",
          impactCents: null,
          confidence: "media",
          urgency: "este_mes",
          requiresProfessionalReview: false,
          decisionNote: "Ya subimos en enero",
          postponedUntil: null,
          decidedAt: null,
          createdAt: "2026-09-01T10:00:00Z",
        },
      ],
      payload: {},
    });
    expect(prompt).toMatch(/sábado, 2026-09-26/);
    expect(prompt).toMatch(/Tus tools: get_at_risk_clients/);
    expect(prompt).toMatch(/Ya subimos en enero/);
  });
});
