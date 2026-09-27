// Adaptador de Groq (Chat Completions compatible con OpenAI, con tool calling): el mismo contrato
// que el de Claude (src/council/runtime/claude.ts), para ejecutar el consejo con un modelo abierto
// (GPT-OSS). El bucle de tools, el presupuesto antes de cada llamada, la salida validada con Zod y
// la regeneración con los problemas son los mismos; lo que cambia es el formato de la API.
//
// - Groq no admite el modo JSON (response_format) junto a las tools, así que la respuesta final se
//   entrega con una tool más, «json», cuyos parámetros son el esquema de salida (es como GPT-OSS
//   lo intenta hacer por su cuenta); también vale un JSON en texto. Se valida igualmente con Zod.
// - Si el modelo genera una llamada a una tool mal formada (tool_use_failed), se le dice y se repite,
//   como con cualquier salida no válida.
// - Historial solo por añadidura: el razonamiento no se reenvía, las correcciones van al final.
// - Solo las tools del agente (sin caché de prompt, cada token cuenta) y, si Groq pide esperar por
//   su límite de tokens por minuto, se espera lo que dice y se repite la misma llamada.

import { z } from "zod";
import type { Usage } from "../store/types";
import { estimateGroqCostUsdMicros, groqModelFor } from "./provider";
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

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const TIMEOUT_MS = 120_000;
/** La tool con la que el modelo entrega la respuesta final (el nombre que usa GPT-OSS por costumbre). */
const FINAL_TOOL = "json";
const FINAL_TOOL_DESCRIPTION = "Entrega la respuesta final: el objeto completo del esquema. Llámala una sola vez, cuando hayas terminado con las demás tools.";

type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

type Completion = {
  model?: string;
  choices: { finish_reason: string | null; message: { content: string | null; tool_calls?: ToolCall[] } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } | null };
};

/** Lo mínimo de fetch que usa el adaptador (los tests lo sustituyen por un doble). */
export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  headers?: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

export type GroqRuntimeOptions = {
  apiKey?: string;
  fetch?: FetchLike;
  env?: Record<string, string | undefined>;
  /** Para los tests: esperar sin esperar. */
  sleep?: (ms: number) => Promise<void>;
};

/** Lo que se espera como mucho por el límite de tokens por minuto: por llamada y en toda la ejecución. */
const MAX_WAIT_PER_CALL_MS = 65_000;
const MAX_WAIT_PER_RUN_MS = 240_000;

export class GroqRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
    /** Cuánto pide Groq que se espere (retry-after o «try again in 28.02s»), en ms. */
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
  }
}

/** «Please try again in 28.0275s» / «in 1m2.5s» / «in 450ms» → milisegundos. */
export function retryAfterFromMessage(message: string): number | null {
  const ms = /try again in\s+([\d.]+)ms\b/i.exec(message);
  if (ms) return Math.ceil(Number(ms[1]));
  const match = /try again in\s+(?:(\d+)m)?(?:([\d.]+)s)?/i.exec(message);
  if (!match || (!match[1] && !match[2])) return null;
  const total = Math.ceil((Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0)) * 1000);
  return total > 0 ? total : null;
}

/** Los errores que merece la pena reintentar más tarde: límite de uso, caída o red. */
export function isRetryableGroqError(error: unknown): boolean {
  if (error instanceof GroqRequestError) return error.status === 429 || error.status >= 500;
  return error instanceof TypeError || (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError"));
}

function usageOf(completion: Completion): Usage {
  const cached = completion.usage?.prompt_tokens_details?.cached_tokens ?? 0;
  const prompt = completion.usage?.prompt_tokens ?? 0;
  return { inputTokens: Math.max(0, prompt - cached), outputTokens: completion.usage?.completion_tokens ?? 0, cacheReadTokens: cached, cacheWriteTokens: 0 };
}

/** JSON Schema de la salida (sin la cabecera $schema), para el mensaje de sistema y response_format. */
function outputJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { io: "output", unrepresentable: "any" }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

export class GroqRuntime implements AgentRuntime {
  readonly id = "groq";
  private readonly apiKey: string;
  private readonly fetchImpl: FetchLike;
  private readonly env: Record<string, string | undefined>;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: GroqRuntimeOptions = {}) {
    this.env = opts.env ?? process.env;
    const apiKey = opts.apiKey ?? this.env.GROQ_API_KEY?.trim();
    if (!apiKey && !opts.fetch) throw new Error("Falta GROQ_API_KEY: el consejo no puede llamar a Groq.");
    this.apiKey = apiKey ?? "test";
    this.fetchImpl = opts.fetch ?? ((url, init) => fetch(url, init));
    this.sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  private async complete(body: Record<string, unknown>): Promise<Completion> {
    const res = await this.fetchImpl(GROQ_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let code: string | null = null;
      let message = text.slice(0, 500) || `HTTP ${res.status}`;
      try {
        const parsed = JSON.parse(text) as { error?: { code?: string; message?: string } };
        code = parsed.error?.code ?? null;
        message = parsed.error?.message ?? message;
      } catch {
        // El cuerpo no es JSON: se queda el texto.
      }
      const header = res.headers?.get("retry-after");
      const retryAfterMs = header && Number.isFinite(Number(header)) ? Math.ceil(Number(header) * 1000) : retryAfterFromMessage(message);
      throw new GroqRequestError(res.status, code, message, retryAfterMs);
    }
    return (await res.json()) as Completion;
  }

  async run(request: RuntimeRequest): Promise<RuntimeResult> {
    const model = groqModelFor(request.model, this.env);
    const schema = outputJsonSchema(request.output.schema);
    const allowed = request.allowedTools ? new Set(request.allowedTools) : null;
    const tools = [
      ...request.tools
        .filter((tool) => !allowed || allowed.has(tool.name))
        .map((tool) => ({ type: "function" as const, function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } })),
      // GPT-OSS entrega la respuesta final llamando a una tool «json»: se le da, con el esquema de salida.
      { type: "function" as const, function: { name: FINAL_TOOL, description: FINAL_TOOL_DESCRIPTION, parameters: schema } },
    ];
    const messages: ChatMessage[] = [
      {
        role: "system",
        content: [
          request.system.shared,
          request.system.agent,
          `## Respuesta final\n\nCuando termines con las demás tools, entrega la respuesta llamando una sola vez a la tool \`${FINAL_TOOL}\` con el objeto completo (el que describe este JSON Schema). Si no puedes llamar a tools, responde solo con ese objeto JSON, sin texto alrededor.\n\n${JSON.stringify(schema)}`,
        ].join("\n\n"),
      },
      { role: "user", content: request.prompt },
    ];
    let usage = EMPTY_USAGE;
    let cost = 0;
    let rounds = 0;
    let attempts = 0;
    let lastOutput: unknown = null;
    let issues: string[] = [];
    let usedModel = model;
    let waited = 0;

    const done = (status: RuntimeResult["status"], error: string | null = null, retryable = false): RuntimeResult => ({
      status,
      output: lastOutput,
      issues,
      attempts,
      toolRounds: rounds,
      usage,
      costUsdMicros: cost,
      model: usedModel,
      error,
      retryable,
    });

    /** Comprueba una respuesta final (esquema y guardarraíles): la lista de problemas (vacía = vale). */
    const check = (value: unknown): string[] => {
      const parsed = request.output.schema.safeParse(value);
      if (!parsed.success) return schemaIssues(parsed.error);
      lastOutput = parsed.data;
      return request.validate(parsed.data);
    };
    /** Una respuesta que no vale cuenta como intento; pasado el máximo, se acaba con los problemas. */
    const failAttempt = (problems: string[]): RuntimeResult | null => {
      attempts += 1;
      issues = problems;
      if (attempts > request.maxRetries) return done(lastOutput === null ? "invalid_output" : "rejected", issues.join(" | ").slice(0, 2000));
      return null;
    };
    const feedback = () => feedbackMessage(issues, attempts, request.maxRetries);

    for (let turn = 0; turn < request.maxToolRounds + request.maxRetries + 4; turn++) {
      const stop = request.shouldStop?.(cost);
      if (stop) return done("budget_exceeded", stop);

      const body: Record<string, unknown> = {
        model,
        messages,
        tools,
        tool_choice: "auto",
        max_completion_tokens: request.maxOutputTokens,
        ...(model.startsWith("openai/gpt-oss") ? { reasoning_effort: request.effort } : {}),
      };

      let completion: Completion;
      try {
        completion = await this.complete(body);
      } catch (error) {
        // Límite de tokens por minuto: se espera lo que pide Groq y se repite la misma llamada.
        if (error instanceof GroqRequestError && error.status === 429 && error.retryAfterMs !== null) {
          const wait = error.retryAfterMs + 500;
          if (wait <= MAX_WAIT_PER_CALL_MS && waited + wait <= MAX_WAIT_PER_RUN_MS) {
            waited += wait;
            await this.sleep(wait);
            turn -= 1;
            continue;
          }
        }
        // Una llamada a una tool mal formada: se le dice y se repite (cuenta como intento).
        if (error instanceof GroqRequestError && error.status === 400 && error.code === "tool_use_failed") {
          const stopped = failAttempt([
            `La llamada a la tool no era válida (${error.message.slice(0, 240)}). Usa solo las tools de la lista; para la respuesta final, llama a «${FINAL_TOOL}» con el objeto completo.`,
          ]);
          if (stopped) return stopped;
          messages.push({ role: "user", content: feedback() });
          continue;
        }
        const message = error instanceof Error ? error.message : String(error);
        return done("error", message, isRetryableGroqError(error));
      }

      const step = usageOf(completion);
      usage = addUsage(usage, step);
      usedModel = completion.model || model;
      cost += estimateGroqCostUsdMicros(usedModel, step);

      const choice = completion.choices[0];
      if (!choice) return done("error", "Groq no ha devuelto ninguna respuesta.", true);
      const calls = choice.message.tool_calls ?? [];

      if (calls.length > 0 && choice.finish_reason !== "length") {
        messages.push({ role: "assistant", content: choice.message.content ?? "", tool_calls: calls });
        const final = calls.find((c) => c.function.name === FINAL_TOOL);
        if (final) {
          // La respuesta final llega como argumentos de la tool «json».
          let value: unknown = null;
          let problems: string[];
          try {
            value = JSON.parse(final.function.arguments || "{}");
            problems = check(value);
          } catch {
            problems = ["Los argumentos de la respuesta final no son un JSON válido."];
          }
          if (problems.length === 0) {
            attempts += 1;
            issues = [];
            return done("ok");
          }
          const stopped = failAttempt(problems);
          if (stopped) return stopped;
          // Toda tool pedida necesita su respuesta en el historial: la final lleva los problemas.
          for (const call of calls) {
            messages.push({ role: "tool", tool_call_id: call.id, content: call === final ? feedback() : "No se ha ejecutado: corrige primero la respuesta final." });
          }
          continue;
        }
        rounds += 1;
        for (const call of calls) {
          if (rounds > request.maxToolRounds) {
            messages.push({ role: "tool", tool_call_id: call.id, content: `Límite de llamadas a tools de esta ejecución: entrega ya la respuesta con «${FINAL_TOOL}» con lo que tienes.` });
            continue;
          }
          let input: unknown = {};
          try {
            input = call.function.arguments ? JSON.parse(call.function.arguments) : {};
          } catch {
            messages.push({ role: "tool", tool_call_id: call.id, content: "Los argumentos no son un JSON válido: vuelve a llamar a la tool con un objeto JSON." });
            continue;
          }
          const reply = await request.handleTool(call.function.name, input);
          messages.push({ role: "tool", tool_call_id: call.id, content: reply.isError ? `ERROR: ${reply.content}` : reply.content });
        }
        continue;
      }

      // Respuesta en texto: también vale si es el JSON final.
      const text = choice.message.content ?? "";
      messages.push({ role: "assistant", content: text });
      let problems: string[];
      if (choice.finish_reason === "length") problems = ["La respuesta se cortó por longitud: responde más breve, solo con el JSON."];
      else {
        const json = parseJsonOutput(text);
        problems = json.ok ? check(json.value) : [json.error];
      }
      if (problems.length === 0) {
        attempts += 1;
        issues = [];
        return done("ok");
      }
      const stopped = failAttempt(problems);
      if (stopped) return stopped;
      messages.push({ role: "user", content: feedback() });
    }
    return done(lastOutput === null ? "invalid_output" : "rejected", "Demasiadas vueltas sin una respuesta válida.");
  }
}
