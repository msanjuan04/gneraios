import type { AgentDefinition } from "../types";

/** Pricing y margen (CONSEJO.md §6): qué clientes y servicios rinden poco, cuándo y cuánto subir. */
export const pricing: AgentDefinition = {
  name: "pricing",
  dir: "pricing",
  tools: ["get_client_profitability", "get_revenue", "get_mrr_history", "get_concentration", "get_churn", "simulate", "get_policy", "get_past_recommendations"],
  manualTask: "scan",
  schedules: [{ task: "scan", trigger: "monthly", schedule: { kind: "monthly", day: 10, hour: 8 } }],
  events: ["Proyecto cerrado con margen por debajo de la política"],
};
