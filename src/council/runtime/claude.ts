// Adaptador de Claude (Messages API con tool use). El bucle de tools lo lleva este fichero porque
// el runtime es intercambiable (un modelo local tendrá su propio bucle con el mismo contrato), el
// presupuesto se comprueba antes de cada llamada y la salida pasa por los guardarraíles con
// regeneración.
//
// - Caché: las tools (las mismas para todos los agentes, en orden estable) y el contexto base
//   compartido van al principio con un punto de caché: son el prefijo común de todas las
//   ejecuciones de la org. La conversación se cachea además con el cache_control de nivel superior.
// - Historial solo por añadidura: los bloques de razonamiento se devuelven tal cual y las
//   correcciones se añaden como mensajes nuevos, nunca editando los anteriores.
// - Salida: JSON con el esquema del agente (salida estructurada) y validado con Zod.
// - Sin temperatura ni presupuesto de tokens de razonamiento: los modelos actuales usan razonamiento
//   adaptativo y el esfuerzo se fija con output_config.effort.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { DEEP_MODEL } from "../agents.config";
import type { Usage } from "../store/types";
import { estimateCostUsdMicros } from "./cost";
import {
  addUsage,
  EMPTY_USAGE,
  feedbackMessage,
  parseJsonOutput,
  schemaIssues,
  type AgentRuntime,
  type RuntimeRequest,
  type RuntimeResult,
} from "./types";

type CreateParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Message = Anthropic.Beta.Messages.BetaMessage;

/** Lo mínimo del SDK que usa el adaptador (los tests lo sustituyen por un doble). */
export type MessagesApi = { create(params: CreateParams): Promise<Message> };

export type ClaudeRuntimeOptions = {
  apiKey?: string;
  /** Para los tests: un cliente falso con la misma forma que `client.beta.messages`. */
  messages?: MessagesApi;
  /** Reintento en otro modelo si el pedido declina por política (recomendado para Opus). */
  refusalFallbacks?: boolean;
};

const FALLBACK_BETA = "server-side-fallback-2026-07-01";

function usageOf(message: Message): Usage {
  return {
    inputTokens: message.usage.input_tokens ?? 0,
    outputTokens: message.usage.output_tokens ?? 0,
    cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
  };
}

/** Los errores de la API que merece la pena reintentar más tarde (límite de uso, caída, red). */
export function isRetryableError(error: unknown): boolean {
  return (
    error instanceof Anthropic.RateLimitError ||
    error instanceof Anthropic.InternalServerError ||
    error instanceof Anthropic.APIConnectionError ||
    (error instanceof Anthropic.APIError && (error.status === 529 || error.status === 503))
  );
}

export class ClaudeRuntime implements AgentRuntime {
  readonly id = "claude";
  private readonly messages: MessagesApi;
  private readonly refusalFallbacks: boolean;

  constructor(opts: ClaudeRuntimeOptions = {}) {
    if (opts.messages) this.messages = opts.messages;
    else {
      const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
      if (!apiKey) throw new Error("Falta ANTHROPIC_API_KEY: el consejo no puede llamar a Claude.");
      this.messages = new Anthropic({ apiKey, maxRetries: 2 }).beta.messages;
    }
    this.refusalFallbacks = opts.refusalFallbacks ?? true;
  }

  async run(request: RuntimeRequest): Promise<RuntimeResult> {
    const tools: Anthropic.Beta.Messages.BetaTool[] = request.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema as Anthropic.Beta.Messages.BetaTool.InputSchema,
    }));
    const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [{ role: "user", content: request.prompt }];
    // Solo el esquema (el helper trae también una función de parseo que no viaja a la API).
    const { type, schema } = zodOutputFormat(request.output.schema as z.ZodType as never);
    let format: { type: typeof type; schema: typeof schema } | null = { type, schema };
    let usage = EMPTY_USAGE;
    let cost = 0;
    let rounds = 0;
    let attempts = 0;
    let model = request.model;
    let lastOutput: unknown = null;
    let issues: string[] = [];

    const done = (status: RuntimeResult["status"], error: string | null = null, retryable = false): RuntimeResult => ({
      status,
      output: lastOutput,
      issues,
      attempts,
      toolRounds: rounds,
      usage,
      costUsdMicros: cost,
      model,
      error,
      retryable,
    });

    for (let turn = 0; turn < request.maxToolRounds + request.maxRetries + 4; turn++) {
      const stop = request.shouldStop?.(cost);
      if (stop) return done("budget_exceeded", stop);

      const fallbacks = this.refusalFallbacks && request.model === DEEP_MODEL;
      const params: CreateParams = {
        model: request.model,
        max_tokens: request.maxOutputTokens,
        system: [
          { type: "text", text: request.system.shared, cache_control: { type: "ephemeral" } },
          { type: "text", text: request.system.agent },
        ],
        tools,
        messages,
        thinking: { type: "adaptive" },
        output_config: { effort: request.effort, ...(format ? { format } : {}) },
        cache_control: { type: "ephemeral" },
        ...(fallbacks ? { betas: [FALLBACK_BETA], fallbacks: "default" as const } : {}),
      };

      let response: Message;
      try {
        response = await this.messages.create(params);
      } catch (error) {
        // Si la salida estructurada no se admite junto a las tools, se sigue solo con Zod.
        if (format && error instanceof Anthropic.BadRequestError && /output_config|format|json_schema/i.test(error.message)) {
          format = null;
          continue;
        }
        const message = error instanceof Error ? error.message : String(error);
        return done("error", message, isRetryableError(error));
      }
      usage = addUsage(usage, usageOf(response));
      model = response.model || request.model;
      cost += estimateCostUsdMicros(model, usageOf(response));

      if (response.stop_reason === "refusal") {
        const category = response.stop_details?.category ?? "sin categoría";
        return done("refused", `El modelo ha declinado la petición (${category}).`);
      }
      messages.push({ role: "assistant", content: response.content });

      const toolUses = response.content.filter((block): block is Anthropic.Beta.Messages.BetaToolUseBlock => block.type === "tool_use");
      if (toolUses.length > 0 && response.stop_reason !== "max_tokens") {
        rounds += 1;
        const results: Anthropic.Beta.Messages.BetaToolResultBlockParam[] = await Promise.all(
          toolUses.map(async (use) => {
            if (rounds > request.maxToolRounds) {
              return { type: "tool_result" as const, tool_use_id: use.id, is_error: true, content: "Límite de llamadas a tools de esta ejecución: responde ya con el JSON con lo que tienes." };
            }
            const reply = await request.handleTool(use.name, use.input);
            return { type: "tool_result" as const, tool_use_id: use.id, content: reply.content, is_error: reply.isError };
          }),
        );
        messages.push({ role: "user", content: results });
        continue;
      }
      if (response.stop_reason === "pause_turn") continue;

      attempts += 1;
      if (response.stop_reason === "max_tokens") {
        issues = ["La respuesta se cortó por longitud: responde más breve, solo con el JSON."];
      } else {
        const text = response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
        const json = parseJsonOutput(text);
        if (!json.ok) {
          issues = [json.error];
        } else {
          const parsed = request.output.schema.safeParse(json.value);
          if (!parsed.success) issues = schemaIssues(parsed.error);
          else {
            lastOutput = parsed.data;
            issues = request.validate(parsed.data);
            if (issues.length === 0) return done("ok");
          }
        }
      }
      if (attempts > request.maxRetries) return done(lastOutput === null ? "invalid_output" : "rejected", issues.join(" | ").slice(0, 2000));
      messages.push({ role: "user", content: feedbackMessage(issues, attempts, request.maxRetries) });
    }
    return done(lastOutput === null ? "invalid_output" : "rejected", "Demasiadas vueltas sin una respuesta válida.");
  }
}

/** ¿Está configurada la clave de la API? (sin clave el consejo explica cómo conectarlo y no ejecuta nada). */
export function isClaudeConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}
