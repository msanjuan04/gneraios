import type { AgentDefinition } from "../types";

/** Fiscal y cumplimiento (CONSEJO.md §6): IVA, IS, retenciones y Verifactu, siempre con revisión profesional. */
export const fiscal: AgentDefinition = {
  name: "fiscal",
  dir: "fiscal",
  tools: ["get_tax_provisions", "get_cash_position", "get_revenue", "get_policy", "get_past_recommendations"],
  manualTask: "scan",
  schedules: [{ task: "scan", trigger: "monthly", schedule: { kind: "monthly", day: 1, hour: 8 } }],
  events: ["Cierre trimestral"],
};
