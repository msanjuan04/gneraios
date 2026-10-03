// Sin `import "server-only"` (como quote-render.ts): lo usan también Vitest y los scripts.
import { renderToBuffer } from "@react-pdf/renderer";
import { createProposalDocument } from "./proposal-document";
import type { QuoteDocumentData } from "./quote-types";

/** El PDF de la propuesta comercial (portada oscura, resumen, alcance y condiciones). */
export async function renderProposalPdf(data: QuoteDocumentData): Promise<Buffer> {
  return renderToBuffer(createProposalDocument(data));
}
