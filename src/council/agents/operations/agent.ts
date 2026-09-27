import type { AgentDefinition } from "../types";

/** Operaciones y capacidad (CONSEJO.md §6): carga por socio, cuellos de botella, contratar o externalizar. */
export const operations: AgentDefinition = {
  name: "operations",
  dir: "operations",
  tools: ["get_capacity", "get_pipeline", "get_mrr_history", "get_expenses", "simulate", "get_policy", "get_past_recommendations"],
  manualTask: "scan",
  schedules: [{ task: "scan", trigger: "weekly", schedule: { kind: "weekly", weekday: 4, hour: 8 } }],
  events: ["Deal grande ganado"],
};
