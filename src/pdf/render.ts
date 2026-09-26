// Sin `import "server-only"`: ese paquete lanza en cuanto se importa fuera de Next (Vitest,
// `tsx scripts/…`), y este módulo se usa desde los dos. Solo funciona en el servidor de todas
// formas: lee las fuentes y el logo del disco con `node:path` y `process.cwd()`.
import { renderToBuffer } from "@react-pdf/renderer";
import { createInvoiceDocument } from "./invoice-document";
import type { InvoiceDocumentData } from "./types";

/**
 * Genera el PDF de una factura. Manrope se registra la primera vez y las siguientes
 * llamadas reutilizan las fuentes ya cargadas. Lanza si a una factura emitida le falta el
 * número o, si es rectificativa, la factura que corrige.
 */
export async function renderInvoicePdf(data: InvoiceDocumentData): Promise<Buffer> {
  return renderToBuffer(createInvoiceDocument(data));
}
