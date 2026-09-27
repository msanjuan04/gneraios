import type { AgentDefinition } from "../types";

/** Retención y upsell (CONSEJO.md §6): clientes en riesgo, renovaciones y venta cruzada. */
export const retention: AgentDefinition = {
  name: "retention",
  dir: "retention",
  tools: ["get_at_risk_clients", "get_renewals", "get_upsell_candidates", "get_receivables", "get_churn", "get_nrr", "get_policy", "get_past_recommendations"],
  manualTask: "scan",
  schedules: [{ task: "scan", trigger: "weekly", schedule: { kind: "weekly", weekday: 3, hour: 8 } }],
  events: ["Factura vencida", "Renovación a 60 días"],
};
