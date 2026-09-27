// Los nueve agentes del consejo (CONSEJO.md §6).

import type { ToolName } from "../tools/registry";
import type { AgentName } from "../types";
import { cfo } from "./cfo/agent";
import { chiefOfStaff } from "./chief-of-staff/agent";
import { commercial } from "./commercial/agent";
import { devilsAdvocate } from "./devils-advocate/agent";
import { fiscal } from "./fiscal/agent";
import { growth } from "./growth/agent";
import { operations } from "./operations/agent";
import { pricing } from "./pricing/agent";
import { retention } from "./retention/agent";
import type { AgentDefinition } from "./types";

export const AGENTS: Record<AgentName, AgentDefinition> = {
  cfo,
  commercial,
  pricing,
  retention,
  operations,
  growth,
  fiscal,
  devils_advocate: devilsAdvocate,
  chief_of_staff: chiefOfStaff,
};

/** Las tools de un agente (el abogado del diablo usa las del agente que revisa, más la política). */
export function allowedTools(agent: AgentName, reviewing?: AgentName): ReadonlySet<ToolName> {
  if (agent === "devils_advocate") {
    const base = reviewing ? AGENTS[reviewing].tools : [];
    return new Set<ToolName>([...base, "get_policy", "simulate"]);
  }
  return new Set(AGENTS[agent].tools);
}

export type { AgentDefinition, Schedule, ScheduledTask } from "./types";
