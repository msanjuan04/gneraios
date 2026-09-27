import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { scanOutputSchema } from "../agents/schemas";
import { toolSpecs } from "../tools/registry";
import { ClaudeRuntime, type MessagesApi } from "./claude";
import type { RuntimeRequest } from "./types";

// El adaptador de Claude con un doble de la API: bucle de tools, historial solo por añadidura,
// caché del prefijo, regeneración con los problemas, rechazo por política y coste estimado.

type Params = Parameters<MessagesApi["create"]>[0];

function message(content: unknown[], stop_reason: string, usage: Partial<Record<string, number>> = {}, model = "claude-sonnet-5") {
  return {
    id: `msg_${Math.random()}`,
    type: "message",
    role: "assistant",
    model,
    content,
    stop_reason,
    stop_sequence: null,
    stop_details: null,
    usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, ...usage },
  } as unknown as Awaited<ReturnType<MessagesApi["create"]>>;
}

function fakeApi(responses: (Awaited<ReturnType<MessagesApi["create"]>> | Error)[]): MessagesApi & { calls: Params[] } {
  const calls: Params[] = [];
  return {
    calls,
    async create(params) {
      calls.push(structuredClone(params));
      const next = responses.shift();
      if (!next) throw new Error("sin más respuestas");
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

const valid = { recommendations: [], silence_reason: "Nada relevante esta semana." };

function request(overrides: Partial<RuntimeRequest> = {}): RuntimeRequest & { toolCalls: string[] } {
  const toolCalls: string[] = [];
  return {
    toolCalls,
    agent: "retention",
    task: "scan",
    model: "claude-sonnet-5",
    effort: "low",
    system: { shared: "Reglas del consejo…", agent: "Eres retención…" },
    prompt: "Hoy es sábado…",
    tools: toolSpecs(),
    handleTool: async (name) => {
      toolCalls.push(name);
      return { content: JSON.stringify({ call: "t1", tool: name, metrics: [] }), isError: false };
    },
    output: { schema: scanOutputSchema, name: "scan" },
    validate: () => [],
    maxRetries: 2,
    maxToolRounds: 4,
    maxOutputTokens: 12_000,
    ...overrides,
  };
}

describe("ClaudeRuntime", () => {
  it("bucle de tools con el prefijo cacheado, razonamiento adaptativo y el historial tal cual", async () => {
    const thinking = { type: "thinking", thinking: "", signature: "sig" };
    const api = fakeApi([
      message([thinking, { type: "tool_use", id: "tu_1", name: "get_receivables", input: {} }], "tool_use", { cache_creation_input_tokens: 5000 }),
      message([{ type: "text", text: JSON.stringify(valid) }], "end_turn", { cache_read_input_tokens: 5000 }),
    ]);
    const req = request();
    const result = await new ClaudeRuntime({ messages: api }).run(req);
    expect(result).toMatchObject({ status: "ok", attempts: 1, toolRounds: 1, output: valid });
    expect(req.toolCalls).toEqual(["get_receivables"]);

    const first = api.calls[0]!;
    expect(first.model).toBe("claude-sonnet-5");
    expect(first.thinking).toEqual({ type: "adaptive" });
    expect(first.output_config?.effort).toBe("low");
    expect(first.output_config?.format?.type).toBe("json_schema");
    expect(first.cache_control).toEqual({ type: "ephemeral" });
    expect((first.system as { cache_control?: unknown }[])[0]!.cache_control).toEqual({ type: "ephemeral" });
    expect(first.tools?.map((t) => (t as { name: string }).name)).toEqual(toolSpecs().map((t) => t.name));
    expect(first).not.toHaveProperty("temperature");
    expect(first.betas).toBeUndefined();

    // La segunda llamada lleva el turno del asistente sin tocar (con su bloque de razonamiento) y los resultados.
    const second = api.calls[1]!;
    expect(second.messages).toHaveLength(3);
    expect(second.messages[1]).toEqual({ role: "assistant", content: [thinking, { type: "tool_use", id: "tu_1", name: "get_receivables", input: {} }] });
    expect(second.messages[2]!.content).toEqual([{ type: "tool_result", tool_use_id: "tu_1", content: expect.any(String), is_error: false }]);

    // 2.000 in + 200 out + 5.000 escritura a 2,5 + 1.000 in + 200 out + 5.000 lectura a 0,2 (USD/MTok).
    expect(result.usage).toEqual({ inputTokens: 2000, outputTokens: 400, cacheReadTokens: 5000, cacheWriteTokens: 5000 });
    expect(result.costUsdMicros).toBe(2000 * 2 + 400 * 10 + 5000 * 2.5 + 5000 * 0.2);
  });

  it("si los guardarraíles fallan, añade los problemas como mensaje nuevo y regenera", async () => {
    const api = fakeApi([
      message([{ type: "text", text: JSON.stringify({ recommendations: [], silence_reason: null }) }], "end_turn"),
      message([{ type: "text", text: "```json\n" + JSON.stringify(valid) + "\n```" }], "end_turn"),
    ]);
    const req = request({ validate: (o) => ((o as { silence_reason: string | null }).silence_reason ? [] : ["Explica el silencio."]) });
    const result = await new ClaudeRuntime({ messages: api }).run(req);
    expect(result).toMatchObject({ status: "ok", attempts: 2 });
    const retry = api.calls[1]!.messages;
    expect(retry).toHaveLength(3);
    expect(retry[2]).toMatchObject({ role: "user" });
    expect(String(retry[2]!.content)).toMatch(/Explica el silencio/);
  });

  it("tras dos regeneraciones sin arreglarlo, rechaza con los problemas", async () => {
    const bad = () => message([{ type: "text", text: JSON.stringify({ recommendations: [], silence_reason: null }) }], "end_turn");
    const api = fakeApi([bad(), bad(), bad()]);
    const result = await new ClaudeRuntime({ messages: api }).run(request({ validate: () => ["Cifra inventada: 9.000"] }));
    expect(result).toMatchObject({ status: "rejected", attempts: 3, issues: ["Cifra inventada: 9.000"] });
  });

  it("el modelo profundo pide el reintento en otro modelo si declina; un rechazo se devuelve limpio", async () => {
    const api = fakeApi([{ ...message([], "refusal"), stop_details: { type: "refusal", category: "cyber", explanation: null } } as never]);
    const result = await new ClaudeRuntime({ messages: api }).run(request({ model: "claude-opus-5-5" }));
    expect(api.calls[0]!.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(api.calls[0]).toMatchObject({ fallbacks: "default" });
    expect(result).toMatchObject({ status: "refused" });
    expect(result.error).toMatch(/cyber/);
  });

  it("para antes de pasarse del presupuesto", async () => {
    const api = fakeApi([message([{ type: "tool_use", id: "tu_1", name: "get_pipeline", input: {} }], "tool_use", { input_tokens: 1_000_000 })]);
    const result = await new ClaudeRuntime({ messages: api }).run(request({ shouldStop: (cost) => (cost > 0 ? "Presupuesto agotado" : null) }));
    expect(result).toMatchObject({ status: "budget_exceeded", error: "Presupuesto agotado" });
    expect(api.calls).toHaveLength(1);
  });

  it("un error pasajero de la API se marca para reintentar el trabajo más tarde", async () => {
    const overloaded = new Anthropic.InternalServerError(500, { type: "error", error: { type: "api_error", message: "overloaded" } }, "overloaded", new Headers());
    const result = await new ClaudeRuntime({ messages: fakeApi([overloaded]) }).run(request());
    expect(result).toMatchObject({ status: "error", retryable: true });
  });

  it("sin clave no se puede crear", () => {
    const previous = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      expect(() => new ClaudeRuntime()).toThrow(/ANTHROPIC_API_KEY/);
    } finally {
      if (previous !== undefined) process.env.ANTHROPIC_API_KEY = previous;
    }
  });
});
