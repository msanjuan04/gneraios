// Sin `import "server-only"` (como render.ts): lo usan también Vitest y los scripts. Solo
// funciona en el servidor de todas formas: lee las fuentes y el logo del disco.
import { renderToBuffer } from "@react-pdf/renderer";
import { createQuoteDocument } from "./quote-document";
import type { QuoteDocumentData } from "./quote-types";

/**
 * Genera el PDF de un presupuesto (vista previa o el que se envía). Lanza si a uno ya enviado
 * le falta el número.
 */
export async function renderQuotePdf(data: QuoteDocumentData): Promise<Buffer> {
  return renderToBuffer(createQuoteDocument(data));
}
