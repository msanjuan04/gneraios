// Sin `import "server-only"` (como render.ts): lo usan también Vitest y los scripts. Solo
// funciona en el servidor de todas formas: lee las fuentes y el logo del disco.
import { renderToBuffer } from "@react-pdf/renderer";
import type { ClientMonthReport } from "@/domain/reports";
import { createReportDocument } from "./report-document";

/** Genera el PDF del informe mensual de un cliente (no se guarda: se genera cada vez). */
export async function renderClientReportPdf(report: ClientMonthReport): Promise<Buffer> {
  return renderToBuffer(createReportDocument(report));
}
