// Sin `import "server-only"`: lo usan también los tests (Vitest). Solo se importa desde el servidor.
import { parseInvoiceText } from "@/domain/invoice-import/parse";
import { emptyExtraction, type ExtractedInvoice, type ExtractionHints } from "@/domain/invoice-import/types";
import { claudeConfigured, describeClaudeError, readWithClaude } from "./claude";
import { extractPdfText } from "./pdf-text";

export type ExtractionEngine = "claude" | "text";

export type ExtractOutcome = { engine: ExtractionEngine; extraction: ExtractedInvoice };

export type EngineDeps = {
  claude?: ((pdf: Uint8Array, hints: ExtractionHints) => Promise<ExtractedInvoice>) | null;
  text?: (pdf: Uint8Array, hints: ExtractionHints) => Promise<ExtractedInvoice>;
};

async function readText(pdf: Uint8Array, hints: ExtractionHints): Promise<ExtractedInvoice> {
  const { text } = await extractPdfText(pdf);
  return text.trim() === "" ? emptyExtraction(["no_text"]) : parseInvoiceText(text, hints);
}

/**
 * Lee una factura en PDF: con Claude si está configurado (ANTHROPIC_API_KEY) y, si no o si falla
 * por lo que sea, con el lector de texto. Un PDF que no se puede abrir lanza PdfReadError.
 */
export async function extractInvoice(pdf: Uint8Array, hints: ExtractionHints, deps: EngineDeps = {}): Promise<ExtractOutcome> {
  const claude = deps.claude === undefined ? (claudeConfigured() ? readWithClaude : null) : deps.claude;
  const text = deps.text ?? readText;
  if (claude) {
    try {
      return { engine: "claude", extraction: await claude(pdf, hints) };
    } catch (error) {
      // Solo el tipo de error: ni el PDF ni la respuesta pasan por el registro.
      console.warn(`[invoice-import] Claude no ha podido leer la factura (${describeClaudeError(error)}): se usa el lector de texto`);
    }
  }
  return { engine: "text", extraction: await text(pdf, hints) };
}
