import { TOOL_NAMES } from "../../tools/registry";
import type { AgentDefinition } from "../types";

/** Chief of Staff (CONSEJO.md §6): el briefing del lunes con 3-5 decisiones, caja y semáforo por área. */
export const chiefOfStaff: AgentDefinition = {
  name: "chief_of_staff",
  dir: "chief-of-staff",
  tools: TOOL_NAMES,
  manualTask: "weekly_briefing",
  schedules: [{ task: "weekly_briefing", trigger: "weekly_briefing", schedule: { kind: "weekly", weekday: 1, hour: 8 } }],
  events: ["Cierre mensual", "Bajo demanda"],
};
