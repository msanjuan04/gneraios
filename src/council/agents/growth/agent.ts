import type { AgentDefinition } from "../types";

/** Crecimiento y SEO (CONSEJO.md §6): qué canal trae clientes que pagan y dónde invertir. */
export const growth: AgentDefinition = {
  name: "growth",
  dir: "growth",
  tools: ["get_seo_summary", "get_conversion_by_source", "get_revenue", "get_policy", "get_past_recommendations"],
  manualTask: "scan",
  schedules: [{ task: "scan", trigger: "monthly", schedule: { kind: "monthly", day: 15, hour: 8 } }],
  events: [],
};
