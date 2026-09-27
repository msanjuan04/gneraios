// Los prompts viven en src/council/agents/<agente>/prompt.md y se leen del disco al ejecutar (con
// caché por proceso). Las rutas se escriben enteras, con process.cwd() como hace el PDF, para que
// el trazado de ficheros de Next las incluya en la imagen de producción.

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AgentName } from "../types";

const LOADERS: Record<AgentName | "shared", () => Promise<string>> = {
  shared: () => readFile(path.join(process.cwd(), "src/council/agents/shared.md"), "utf8"),
  cfo: () => readFile(path.join(process.cwd(), "src/council/agents/cfo/prompt.md"), "utf8"),
  commercial: () => readFile(path.join(process.cwd(), "src/council/agents/commercial/prompt.md"), "utf8"),
  pricing: () => readFile(path.join(process.cwd(), "src/council/agents/pricing/prompt.md"), "utf8"),
  retention: () => readFile(path.join(process.cwd(), "src/council/agents/retention/prompt.md"), "utf8"),
  operations: () => readFile(path.join(process.cwd(), "src/council/agents/operations/prompt.md"), "utf8"),
  growth: () => readFile(path.join(process.cwd(), "src/council/agents/growth/prompt.md"), "utf8"),
  fiscal: () => readFile(path.join(process.cwd(), "src/council/agents/fiscal/prompt.md"), "utf8"),
  devils_advocate: () => readFile(path.join(process.cwd(), "src/council/agents/devils-advocate/prompt.md"), "utf8"),
  chief_of_staff: () => readFile(path.join(process.cwd(), "src/council/agents/chief-of-staff/prompt.md"), "utf8"),
};

const cache = new Map<string, Promise<string>>();

/** El prompt de un agente (o el compartido). Lanza con un mensaje claro si no se encuentra. */
export function loadPrompt(name: AgentName | "shared"): Promise<string> {
  let hit = cache.get(name);
  if (!hit) {
    hit = LOADERS[name]().catch((error: unknown) => {
      cache.delete(name);
      throw new Error(
        `No se encuentra el prompt de ${name} (${error instanceof Error ? error.message : String(error)}). En producción, src/council/agents/**/*.md tiene que estar en outputFileTracingIncludes.`,
      );
    });
    cache.set(name, hit);
  }
  return hit;
}
