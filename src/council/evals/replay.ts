// Respuestas grabadas y registro de lo que ve el agente.
//
// - replayScript: convierte los intentos grabados de un escenario en un guion de FakeRuntime. Las
//   tools se ejecutan de verdad contra los datos del escenario; solo la "decisión" del modelo
//   (qué tools llama y qué JSON devuelve) viene grabada.
// - RecordingRuntime: envuelve cualquier runtime (el falso o Claude) y apunta la tarea de cada
//   ejecución y las respuestas de las tools, para puntuar después sin depender del runner.

import type { FakeScript } from "../runtime/fake";
import type { AgentRuntime, RuntimeRequest, RuntimeResult } from "../runtime/types";
import type { ReplayAttempt } from "./types";

type Placeholders = { calls: string[]; recs: string[] };

function substitute(value: unknown, p: Placeholders): unknown {
  if (typeof value === "string") {
    const call = /^@call:(\d+)$/.exec(value);
    if (call) return p.calls[Number(call[1])] ?? value;
    const rec = /^@rec:(\d+)$/.exec(value);
    if (rec) return p.recs[Number(rec[1])] ?? value;
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => substitute(v, p));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substitute(v, p)]));
  return value;
}

/** El guion de un agente: en el intento N usa la grabación N (o la última si hay menos). */
export function replayScript(attempts: readonly ReplayAttempt[], existingIds: readonly string[]): FakeScript {
  return async (session) => {
    const attempt = attempts[Math.min(session.attempt, attempts.length) - 1]!;
    const calls: string[] = [];
    for (const call of attempt.calls) {
      const reply = await session.call(call.name, call.input ?? {});
      const id = reply.json && typeof reply.json === "object" ? (reply.json as { call?: unknown }).call : undefined;
      calls.push(typeof id === "string" ? id : "");
    }
    return substitute(attempt.output, { calls, recs: [...existingIds] });
  };
}

export type CapturedReply = { name: string; input: unknown; content: string; isError: boolean };
export type CapturedRun = { agent: string; task: string; model: string; prompt: string; replies: CapturedReply[] };

/** Apunta lo que recibe y lo que ve cada ejecución, sea cual sea el runtime de debajo. */
export class RecordingRuntime implements AgentRuntime {
  readonly runs: CapturedRun[] = [];
  readonly id: string;

  constructor(private readonly inner: AgentRuntime) {
    this.id = inner.id;
  }

  async run(request: RuntimeRequest): Promise<RuntimeResult> {
    const captured: CapturedRun = { agent: request.agent, task: request.task, model: request.model, prompt: request.prompt, replies: [] };
    this.runs.push(captured);
    return this.inner.run({
      ...request,
      handleTool: async (name, input) => {
        const reply = await request.handleTool(name, input);
        captured.replies.push({ name, input, ...reply });
        return reply;
      },
    });
  }
}
