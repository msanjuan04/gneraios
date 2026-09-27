// Sin `import "server-only"`: lo usan también los tests (Vitest). Solo se importa desde el servidor.
//
// Lector de facturas con Claude: el PDF va entero como documento (Claude lo ve como texto y como
// imagen, así que también lee los escaneados) y vuelve el JSON del esquema de
// src/domain/invoice-import/claude-output.ts, con salida estructurada y validado con Zod. Solo se
// usa si hay ANTHROPIC_API_KEY; cualquier fallo (red, límite, rechazo, JSON que no cuadra) lo
// resuelve quien llama pasando al lector de texto. Nunca se registra el contenido del PDF ni la
// respuesta: como mucho, el tipo de error.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { type ClaudeInvoice, claudeInstructions, claudeInvoiceSchema, fromClaudeOutput } from "@/domain/invoice-import/claude-output";
import type { ExtractedInvoice, ExtractionHints } from "@/domain/invoice-import/types";

/** El mismo modelo que usa el consejo en su nivel más alto (src/council/agents.config.ts). */
export const INVOICE_READER_MODEL = "claude-opus-5-5";
/** Si el modelo declina por política, la API reintenta en el que toque según el motivo. */
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
/** Una factura se lee en segundos; si tarda más, mejor el lector de texto que dejar esperando. */
const TIMEOUT_MS = 60_000;

type CreateParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Message = Anthropic.Beta.Messages.BetaMessage;

/** Lo mínimo del SDK que se usa (los tests lo sustituyen por un doble). */
export type MessagesApi = { create(params: CreateParams, options?: { timeout?: number; maxRetries?: number }): Promise<Message> };

export class ClaudeReadError extends Error {
  constructor(readonly reason: "refusal" | "truncated" | "empty" | "invalid_output") {
    super(`claude_${reason}`);
    this.name = "ClaudeReadError";
  }
}

export function claudeConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

let cached: MessagesApi | null = null;
function defaultApi(): MessagesApi {
  cached ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 1 }).beta.messages;
  return cached;
}

// Solo el esquema: el helper trae también una función de parseo que no viaja a la API.
const { type: formatType, schema: formatSchema } = zodOutputFormat(claudeInvoiceSchema);

/** La petición: el PDF como documento, las instrucciones y la salida con el esquema. */
export function buildRequest(pdf: Uint8Array, hints: ExtractionHints): CreateParams {
  return {
    model: INVOICE_READER_MODEL,
    max_tokens: 16_000,
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { effort: "medium", format: { type: formatType, schema: formatSchema } },
    system: claudeInstructions(hints.issuerTaxIds ?? []),
    messages: [
      {
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from(pdf).toString("base64") } },
          { type: "text", text: "Extrae los datos de esta factura." },
        ],
      },
    ],
  };
}

/** Lee la factura con Claude. Lanza si no ha podido (quien llama pasa al lector de texto). */
export async function readWithClaude(pdf: Uint8Array, hints: ExtractionHints, api: MessagesApi = defaultApi()): Promise<ExtractedInvoice> {
  const response = await api.create(buildRequest(pdf, hints), { timeout: TIMEOUT_MS, maxRetries: 1 });
  if (response.stop_reason === "refusal") throw new ClaudeReadError("refusal");
  if (response.stop_reason === "max_tokens") throw new ClaudeReadError("truncated");
  const text = response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
  if (text.trim() === "") throw new ClaudeReadError("empty");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ClaudeReadError("invalid_output");
  }
  const parsed = claudeInvoiceSchema.safeParse(json);
  if (!parsed.success) throw new ClaudeReadError("invalid_output");
  return fromClaudeOutput(parsed.data as ClaudeInvoice);
}

/** Para el registro: el tipo de error, sin mensajes que pudieran llevar datos de la factura. */
export function describeClaudeError(error: unknown): string {
  if (error instanceof ClaudeReadError) return error.reason;
  if (error instanceof Anthropic.APIError) return `api_${error.status ?? "error"}`;
  if (error instanceof Error) return error.name;
  return "unknown";
}
