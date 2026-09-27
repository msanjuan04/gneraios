// Cuándo trabaja cada agente, como clave de i18n (council.cadence.*) y sus valores.

import type { AgentDefinition } from "@/council/agents";

export type Cadence = { key: "daily" | "weekly" | "monthly" | "beforePublishing" | "manual"; values: { weekday?: number; day?: number; hour?: number } };

export function cadenceOf(agent: AgentDefinition): Cadence {
  const first = agent.schedules[0];
  if (!first) return { key: agent.name === "devils_advocate" ? "beforePublishing" : "manual", values: {} };
  const s = first.schedule;
  if (s.kind === "daily") return { key: "daily", values: { hour: s.hour } };
  if (s.kind === "weekly") return { key: "weekly", values: { weekday: s.weekday, hour: s.hour } };
  return { key: "monthly", values: { day: s.day, hour: s.hour } };
}
