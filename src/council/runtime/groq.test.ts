import { describe, expect, it } from "vitest";
import { DEEP_MODEL } from "../agents.config";
import { scanOutputSchema } from "../agents/schemas";
import { toolSpecs } from "../tools/registry";
import { type FetchLike, GroqRuntime, retryAfterFromMessage } from "./groq";
import { councilProvider, estimateGroqCostUsdMicros, groqModelFor } from "./provider";
import type { RuntimeRequest } from "./types";

// El adaptador de Groq con un doble de la API: bucle de tools, esquema en el sistema y en
// response_format, regeneración con los problemas, errores de Groq y coste estimado.

type Body = { model: string; messages: { role: string; content?: string; tool_calls?: unknown[]; tool_call_id?: string }[]; response_format?: unknown; tool_choice?: string; reasoning_effort?: string };
type Reply = { status?: number; body: unknown };

function fakeFetch(replies: Reply[]): FetchLike & { bodies: Body[] } {
  const bodies: Body[] = [];
  const fn = (async (_url, init) => {
    bodies.push(JSON.parse(init.body) as Body);
    const next = replies.shift();
    if (!next) throw new Error("sin más respuestas");
    const status = next.status ?? 200;
    return { ok: status < 400, status, json: async () => next.body, text: async () => JSON.stringify(next.body) };
  }) as FetchLike & { bodies: Body[] };
  fn.bodies = bodies;
  return fn;
}

const completion = (message: Record<string, unknown>, finish = "stop", usage = { prompt_tokens: 1000, completion_tokens: 200 }) => ({
  body: { model: "openai/gpt-oss-120b", choices: [{ finish_reason: finish, message }], usage },
});
const toolCall = (name: string, args = "{}") => completion({ content: null, tool_calls: [{ id: `call_${name}`, type: "function", function: { name, arguments: args } }] }, "tool_calls");
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
    prompt: "Hoy es domingo…",
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

describe("GroqRuntime", () => {
  it("bucle de tools con el esquema en el sistema (sin modo JSON: Groq no lo admite con tools) y la salida validada", async () => {
    const api = fakeFetch([toolCall("get_receivables"), completion({ content: JSON.stringify(valid) })]);
    const req = request();
    const result = await new GroqRuntime({ fetch: api, env: {} }).run(req);
    expect(result).toMatchObject({ status: "ok", attempts: 1, toolRounds: 1, output: valid, model: "openai/gpt-oss-120b" });
    expect(req.toolCalls).toEqual(["get_receivables"]);

    const first = api.bodies[0]!;
    expect(first.model).toBe("openai/gpt-oss-120b");
    expect(first.reasoning_effort).toBe("low");
    expect(first.response_format).toBeUndefined();
    expect(first.messages[0]!.content).toContain("JSON Schema");
    // El historial crece por el final: la llamada del modelo y la respuesta de la tool.
    const second = api.bodies[1]!;
    expect(second.messages.slice(2).map((m) => m.role)).toEqual(["assistant", "tool"]);
    expect(second.messages[3]!.tool_call_id).toBe("call_get_receivables");
    expect(result.costUsdMicros).toBe(estimateGroqCostUsdMicros("openai/gpt-oss-120b", { inputTokens: 2000, outputTokens: 400, cacheReadTokens: 0, cacheWriteTokens: 0 }));
  });

  it("si la salida no pasa los guardarraíles, se le dicen los problemas y lo rehace", async () => {
    const api = fakeFetch([completion({ content: "no es JSON" }), completion({ content: JSON.stringify({ recommendations: "mal" }) }), completion({ content: JSON.stringify(valid) })]);
    const result = await new GroqRuntime({ fetch: api, env: {} }).run(request());
    expect(result).toMatchObject({ status: "ok", attempts: 3 });
    expect(api.bodies[1]!.messages.at(-1)!.content).toContain("no pasa las comprobaciones");
  });

  it("sin salida válida tras los reintentos, se rechaza con los problemas", async () => {
    const api = fakeFetch([0, 1, 2].map(() => completion({ content: JSON.stringify(valid) })));
    const result = await new GroqRuntime({ fetch: api, env: {} }).run(request({ validate: () => ["Falta evidencia."] }));
    expect(result).toMatchObject({ status: "rejected", attempts: 3, issues: ["Falta evidencia."] });
  });

  it("la respuesta final puede llegar por la tool «json», con el esquema de salida como parámetros", async () => {
    const api = fakeFetch([toolCall("get_receivables"), toolCall("json", JSON.stringify(valid))]);
    const result = await new GroqRuntime({ fetch: api, env: {} }).run(request());
    expect(result).toMatchObject({ status: "ok", attempts: 1, toolRounds: 1, output: valid });
    const sent = api.bodies[0] as unknown as { tools: { function: { name: string; parameters: { properties?: Record<string, unknown> } } }[] };
    const final = sent.tools.find((t) => t.function.name === "json")!;
    expect(Object.keys(final.function.parameters.properties ?? {})).toEqual(expect.arrayContaining(["recommendations", "silence_reason"]));
  });

  it("si la respuesta de la tool «json» no vale, se le devuelven los problemas en su respuesta y lo rehace", async () => {
    const api = fakeFetch([toolCall("json", JSON.stringify({ recommendations: "mal" })), toolCall("json", JSON.stringify(valid))]);
    const result = await new GroqRuntime({ fetch: api, env: {} }).run(request());
    expect(result).toMatchObject({ status: "ok", attempts: 2 });
    const reply = api.bodies[1]!.messages.at(-1)!;
    expect(reply).toMatchObject({ role: "tool", tool_call_id: "call_json" });
    expect(reply.content).toContain("no pasa las comprobaciones");
  });

  it("una llamada a tool mal formada se corrige en la misma ejecución", async () => {
    const api = fakeFetch([
      { status: 400, body: { error: { message: "Failed to call a function", code: "tool_use_failed" } } },
      completion({ content: JSON.stringify(valid) }),
    ]);
    const result = await new GroqRuntime({ fetch: api, env: {} }).run(request());
    expect(result.status).toBe("ok");
    expect(api.bodies[1]!.messages.at(-1)!.content).toContain("La llamada a la tool no era válida");
  });

  it("el límite de uso es un error que se reintenta más tarde; una clave mala, no", async () => {
    const limited = await new GroqRuntime({ fetch: fakeFetch([{ status: 429, body: { error: { message: "Rate limit reached" } } }]), env: {} }).run(request());
    expect(limited).toMatchObject({ status: "error", retryable: true });
    const unauthorized = await new GroqRuntime({ fetch: fakeFetch([{ status: 401, body: { error: { message: "Invalid API Key" } } }]), env: {} }).run(request());
    expect(unauthorized).toMatchObject({ status: "error", retryable: false });
  });

  it("para el presupuesto antes de llamar", async () => {
    const api = fakeFetch([]);
    const result = await new GroqRuntime({ fetch: api, env: {} }).run(request({ shouldStop: () => "Presupuesto del mes agotado." }));
    expect(result).toMatchObject({ status: "budget_exceeded", error: "Presupuesto del mes agotado." });
    expect(api.bodies).toHaveLength(0);
  });
});

describe("límite de tokens por minuto de Groq", () => {
  it("lee cuánto hay que esperar", () => {
    expect(retryAfterFromMessage("Please try again in 28.0275s. Need more tokens?")).toBe(28_028);
    expect(retryAfterFromMessage("try again in 1m2.5s")).toBe(62_500);
    expect(retryAfterFromMessage("try again in 450ms")).toBe(450);
    expect(retryAfterFromMessage("Rate limit reached")).toBeNull();
  });

  it("espera lo que pide Groq y repite la misma llamada; solo envía las tools del agente", async () => {
    const waits: number[] = [];
    const api = fakeFetch([
      { status: 429, body: { error: { message: "Rate limit reached for model on tokens per minute (TPM). Please try again in 2.5s." } } },
      completion({ content: JSON.stringify(valid) }),
    ]);
    const req = request({ allowedTools: ["get_receivables", "get_at_risk_clients"] });
    const result = await new GroqRuntime({ fetch: api, env: {}, sleep: async (ms) => void waits.push(ms) }).run(req);
    expect(result.status).toBe("ok");
    expect(waits).toEqual([3_000]);
    const sent = api.bodies[0] as unknown as { tools: { function: { name: string } }[] };
    expect(sent.tools.map((t) => t.function.name).sort()).toEqual(["get_at_risk_clients", "get_receivables", "json"]);
  });

  it("si la espera es demasiado larga, deja el trabajo para más tarde", async () => {
    const api = fakeFetch([{ status: 429, body: { error: { message: "Please try again in 5m0s." } } }]);
    const result = await new GroqRuntime({ fetch: api, env: {}, sleep: async () => {} }).run(request());
    expect(result).toMatchObject({ status: "error", retryable: true });
  });
});

describe("proveedor del consejo", () => {
  it("Claude si hay clave de Anthropic, si no Groq; COUNCIL_PROVIDER manda", () => {
    expect(councilProvider({})).toBeNull();
    expect(councilProvider({ GROQ_API_KEY: "gsk_x" })).toBe("groq");
    expect(councilProvider({ ANTHROPIC_API_KEY: "sk-ant-x", GROQ_API_KEY: "gsk_x" })).toBe("anthropic");
    expect(councilProvider({ COUNCIL_PROVIDER: "groq", ANTHROPIC_API_KEY: "sk-ant-x", GROQ_API_KEY: "gsk_x" })).toBe("groq");
    expect(councilProvider({ COUNCIL_PROVIDER: "groq", ANTHROPIC_API_KEY: "sk-ant-x" })).toBeNull();
  });

  it("el modelo de Groq para el diario y para el profundo", () => {
    expect(groqModelFor("claude-sonnet-5", {})).toBe("openai/gpt-oss-120b");
    expect(groqModelFor(DEEP_MODEL, { GROQ_MODEL: "openai/gpt-oss-20b" })).toBe("openai/gpt-oss-20b");
    expect(groqModelFor(DEEP_MODEL, { GROQ_MODEL: "openai/gpt-oss-20b", GROQ_DEEP_MODEL: "openai/gpt-oss-120b" })).toBe("openai/gpt-oss-120b");
    expect(groqModelFor("claude-sonnet-5", { GROQ_MODEL: "openai/gpt-oss-20b", GROQ_DEEP_MODEL: "openai/gpt-oss-120b" })).toBe("openai/gpt-oss-20b");
  });
});
