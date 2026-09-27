// AgentRuntime: lo único que sabe del proveedor del modelo (CONSEJO.md §5). Hoy Claude por API;
// mañana un modelo local con el mismo contrato. Las tools, los esquemas de salida, los
// guardarraíles y los evals no dependen de él.

import type { z } from "zod";
import type { Effort } from "../agents.config";
import type { Usage } from "../store/types";
import type { ToolSpec } from "../tools/registry";
import type { AgentName, Task } from "../types";

/** Ejecuta una tool que pide el modelo y devuelve lo que ve (JSON) y si es un error. */
export type ToolHandler = (name: string, input: unknown) => Promise<{ content: string; isError: boolean }>;

export type RuntimeRequest = {
  agent: AgentName;
  task: Task;
  model: string;
  effort: Effort;
  /** El contexto compartido (se cachea: igual para todos los agentes de la org) y el del agente. */
  system: { shared: string; agent: string };
  /** El primer mensaje: la tarea de hoy. */
  prompt: string;
  tools: readonly ToolSpec[];
  handleTool: ToolHandler;
  output: { schema: z.ZodType; name: string };
  /** Guardarraíles sobre una salida ya válida por esquema: la lista de problemas (vacía = bien). */
  validate: (output: unknown) => string[];
  /** Regeneraciones como mucho cuando la salida no vale (2 en el consejo). */
  maxRetries: number;
  maxToolRounds: number;
  maxOutputTokens: number;
  /** Se consulta antes de cada llamada al modelo con el coste acumulado; un texto = parar (presupuesto). */
  shouldStop?: (costUsdMicros: number) => string | null;
};

export type RuntimeStatus = "ok" | "invalid_output" | "rejected" | "budget_exceeded" | "refused" | "error";

export type RuntimeResult = {
  status: RuntimeStatus;
  /** La última salida válida por esquema (aunque la hayan rechazado los guardarraíles). */
  output: unknown | null;
  /** Los problemas de la última salida. */
  issues: string[];
  /** Salidas producidas (1 + regeneraciones). */
  attempts: number;
  toolRounds: number;
  usage: Usage;
  costUsdMicros: number;
  /** El modelo que respondió. */
  model: string;
  error: string | null;
  /** Un error pasajero (límite de uso, caída): el trabajo se puede reintentar más tarde. */
  retryable?: boolean;
};

export interface AgentRuntime {
  /** claude, fake, local… (se guarda en agent_runs.runtime). */
  readonly id: string;
  run(request: RuntimeRequest): Promise<RuntimeResult>;
}

export const EMPTY_USAGE: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  };
}

/** Texto de los problemas de una salida para pedir que se rehaga (añadido al final: nunca se edita el historial). */
export function feedbackMessage(issues: readonly string[], attempt: number, maxRetries: number): string {
  return [
    `Tu respuesta no pasa las comprobaciones del consejo (intento ${attempt} de ${maxRetries + 1}):`,
    ...issues.map((issue) => `- ${issue}`),
    "",
    "Corrígelo y responde otra vez con el JSON completo. Puedes volver a llamar a las tools si te falta una cifra; nunca la calcules tú.",
  ].join("\n");
}

/** Extrae el JSON de la respuesta del modelo (tolera un bloque ```json … ```). */
export function parseJsonOutput(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  const body = fenced ? fenced[1]! : trimmed;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end < start) return { ok: false, error: "La respuesta no es un objeto JSON." };
  try {
    return { ok: true, value: JSON.parse(body.slice(start, end + 1)) };
  } catch (error) {
    return { ok: false, error: `JSON no válido: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** Problemas de esquema en una línea por campo. */
export function schemaIssues(error: z.ZodError): string[] {
  return error.issues.slice(0, 12).map((issue) => `Campo ${issue.path.join(".") || "(raíz)"}: ${issue.message}`);
}
