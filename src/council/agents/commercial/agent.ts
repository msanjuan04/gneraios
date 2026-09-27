import type { AgentDefinition } from "../types";

/** Director comercial (CONSEJO.md §6): deals parados, siguiente mejor acción, fuentes que convierten. */
export const commercial: AgentDefinition = {
  name: "commercial",
  dir: "commercial",
  tools: ["get_pipeline", "get_stalled_deals", "get_conversion_by_source", "get_policy", "get_past_recommendations"],
  manualTask: "scan",
  schedules: [{ task: "scan", trigger: "daily", schedule: { kind: "daily", hour: 8 } }],
  events: ["Deal sin movimiento X días", "Deal perdido"],
};
