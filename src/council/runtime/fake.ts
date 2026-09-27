// FakeRuntime: el mismo contrato que Claude, sin red, para los tests y los evals. Un guion decide
// qué tools llama el "agente" y qué JSON devuelve en cada intento; las tools se ejecutan de verdad
// (contra el fixture) y la salida pasa por el mismo esquema y los mismos guardarraíles, con las
// mismas regeneraciones. Los tokens se estiman por longitud (deterministas) y el coste con la tabla
// de precios del modelo pedido.

import { estimateCostUsdMicros } from "./cost";
import { addUsage, EMPTY_USAGE, type AgentRuntime, type RuntimeRequest, type RuntimeResult, schemaIssues } from "./types";

export type FakeReply = { content: string; isError: boolean; json: unknown };

export type FakeSession = {
  request: RuntimeRequest;
  /** 1 en la primera salida, 2 y 3 en las regeneraciones. */
  attempt: number;
  /** Los problemas de la salida anterior (vacío en el primer intento). */
  feedback: string[];
  /** Llama a una tool como lo haría el modelo. */
  call(name: string, input?: unknown): Promise<FakeReply>;
};

export type FakeScript = (session: FakeSession) => Promise<unknown> | unknown;

const tokens = (text: string) => Math.ceil(text.length / 4);

export class FakeRuntime implements AgentRuntime {
  readonly id = "fake";
  readonly requests: RuntimeRequest[] = [];

  /** `scripts`: un guion por "agente:tarea" (o por agente), o una función que elige el guion. */
  constructor(private readonly scripts: Record<string, FakeScript> | ((request: RuntimeRequest) => FakeScript | null)) {}

  private scriptFor(request: RuntimeRequest): FakeScript | null {
    if (typeof this.scripts === "function") return this.scripts(request);
    return this.scripts[`${request.agent}:${request.task}`] ?? this.scripts[request.agent] ?? null;
  }

  async run(request: RuntimeRequest): Promise<RuntimeResult> {
    this.requests.push(request);
    const script = this.scriptFor(request);
    let usage = EMPTY_USAGE;
    let rounds = 0;
    let feedback: string[] = [];
    let lastOutput: unknown = null;
    const base = tokens(request.system.shared) + tokens(request.system.agent) + tokens(request.prompt);
    const result = (status: RuntimeResult["status"], attempts: number, issues: string[], error: string | null = null): RuntimeResult => ({
      status,
      output: lastOutput,
      issues,
      attempts,
      toolRounds: rounds,
      usage,
      costUsdMicros: estimateCostUsdMicros(request.model, usage),
      model: request.model,
      error,
    });
    if (!script) return result("error", 0, [], `FakeRuntime: no hay guion para ${request.agent}:${request.task}`);

    for (let attempt = 1; attempt <= request.maxRetries + 1; attempt++) {
      const stop = request.shouldStop?.(estimateCostUsdMicros(request.model, usage));
      if (stop) return result("budget_exceeded", attempt - 1, feedback, stop);
      let read = 0;
      const session: FakeSession = {
        request,
        attempt,
        feedback,
        call: async (name, input = {}) => {
          rounds += 1;
          if (rounds > request.maxToolRounds) {
            return { content: JSON.stringify({ error: "Límite de llamadas a tools de esta ejecución" }), isError: true, json: null };
          }
          const reply = await request.handleTool(name, input);
          read += tokens(reply.content);
          return { ...reply, json: JSON.parse(reply.content) as unknown };
        },
      };
      let raw: unknown;
      try {
        raw = await script(session);
      } catch (error) {
        return result("error", attempt, [], error instanceof Error ? error.message : String(error));
      }
      usage = addUsage(usage, { inputTokens: base + read, outputTokens: tokens(JSON.stringify(raw ?? null)), cacheReadTokens: 0, cacheWriteTokens: 0 });
      const parsed = request.output.schema.safeParse(raw);
      if (!parsed.success) {
        feedback = schemaIssues(parsed.error);
        if (attempt > request.maxRetries) return result("invalid_output", attempt, feedback);
        continue;
      }
      lastOutput = parsed.data;
      const issues = request.validate(parsed.data);
      if (issues.length === 0) return result("ok", attempt, []);
      feedback = issues;
      if (attempt > request.maxRetries) return result("rejected", attempt, issues);
    }
    return result("rejected", request.maxRetries + 1, feedback);
  }
}
