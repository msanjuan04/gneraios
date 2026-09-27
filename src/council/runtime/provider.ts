// Qué proveedor de IA usa el consejo: Claude (Anthropic) o Groq (modelos abiertos con la API
// compatible con OpenAI). Se elige con COUNCIL_PROVIDER; si no se dice, el que tenga clave
// (Claude primero). El resto del consejo (tools, esquemas, guardarraíles, evals) no cambia.

import { DEEP_MODEL } from "../agents.config";
import type { Usage } from "../store/types";

export type CouncilProvider = "anthropic" | "groq";

export function councilProvider(env: Record<string, string | undefined> = process.env): CouncilProvider | null {
  const wanted = env.COUNCIL_PROVIDER?.trim().toLowerCase();
  const anthropic = Boolean(env.ANTHROPIC_API_KEY?.trim());
  const groq = Boolean(env.GROQ_API_KEY?.trim());
  if (wanted === "groq") return groq ? "groq" : null;
  if (wanted === "anthropic" || wanted === "claude") return anthropic ? "anthropic" : null;
  if (anthropic) return "anthropic";
  if (groq) return "groq";
  return null;
}

/** ¿Tiene el consejo con qué ejecutar a los agentes? (sin clave explica cómo conectarlo y no ejecuta nada). */
export function isCouncilConfigured(): boolean {
  return councilProvider() !== null;
}

/** Los modelos de Groq por defecto: el grande para todo (el diario es barato igualmente). */
export const GROQ_DEFAULT_MODEL = "openai/gpt-oss-120b";

/**
 * El modelo de Groq que corresponde al de Claude que pide el agente: el profundo (Chief of Staff,
 * cierre, abogado del diablo) y el diario se pueden cambiar con GROQ_DEEP_MODEL y GROQ_MODEL.
 */
export function groqModelFor(councilModel: string, env: Record<string, string | undefined> = process.env): string {
  const daily = env.GROQ_MODEL?.trim() || GROQ_DEFAULT_MODEL;
  const deep = env.GROQ_DEEP_MODEL?.trim() || daily;
  return councilModel === DEEP_MODEL ? deep : daily;
}

/**
 * Precios aproximados de Groq en USD por millón de tokens, solo para estimar el coste de cada
 * ejecución y aplicar el presupuesto (la factura real es la de Groq). Un modelo sin precio
 * conocido se estima con el más caro de la tabla, para que el presupuesto nunca se quede corto.
 */
export const GROQ_PRICES_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  "openai/gpt-oss-120b": { input: 0.15, output: 0.75 },
  "openai/gpt-oss-20b": { input: 0.1, output: 0.5 },
  "qwen/qwen3.8-27b": { input: 0.3, output: 0.6 },
};

export function estimateGroqCostUsdMicros(model: string, usage: Usage): number {
  const known = GROQ_PRICES_USD_PER_MTOK[model];
  const price = known ?? Object.values(GROQ_PRICES_USD_PER_MTOK).reduce((a, b) => (b.output > a.output ? b : a));
  return Math.round((usage.inputTokens + usage.cacheReadTokens) * price.input + usage.outputTokens * price.output);
}
