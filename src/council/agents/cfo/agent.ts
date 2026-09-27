import type { AgentDefinition } from "../types";

/** CFO · Tesorería y reparto (CONSEJO.md §6). Cierre mensual el día 5 con la propuesta de reparto. */
export const cfo: AgentDefinition = {
  name: "cfo",
  dir: "cfo",
  tools: [
    "get_monthly_close",
    "get_revenue",
    "get_mrr_history",
    "get_receivables",
    "get_concentration",
    "get_expenses",
    "get_cash_position",
    "get_cash_forecast",
    "get_runway",
    "get_tax_provisions",
    "get_policy",
    "simulate",
    "get_past_recommendations",
  ],
  manualTask: "monthly_close",
  schedules: [{ task: "monthly_close", trigger: "monthly_close", schedule: { kind: "monthly", day: 5, hour: 8 } }],
  events: ["Cobro grande", "Gasto recurrente nuevo", "Runway por debajo del colchón de la política"],
};
