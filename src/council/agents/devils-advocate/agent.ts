import type { AgentDefinition } from "../types";

/**
 * Abogado del diablo (CONSEJO.md §6): revisa las recomendaciones de impacto alto antes de
 * publicarlas. Usa las mismas tools que el agente revisado (tools vacío = las suyas) y no se lanza
 * a mano ni tiene horario: lo llama el runner.
 */
export const devilsAdvocate: AgentDefinition = {
  name: "devils_advocate",
  dir: "devils-advocate",
  tools: [],
  manualTask: null,
  schedules: [],
  events: ["Antes de publicar una recomendación por encima del umbral de impacto alto"],
};
