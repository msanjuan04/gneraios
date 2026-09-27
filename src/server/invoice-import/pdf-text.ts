// Sin `import "server-only"`: lo usan también los tests (Vitest). Solo se importa desde el servidor.
import { getDocumentProxy } from "unpdf";
import { layoutPages, type PositionedText } from "@/domain/invoice-import/layout";

/** Las facturas ocupan una o dos páginas: más allá no se lee (un PDF enorme no bloquea el servidor). */
export const MAX_PDF_PAGES = 12;

export class PdfReadError extends Error {
  constructor(readonly reason: "invalid" | "encrypted") {
    super(`pdf_${reason}`);
    this.name = "PdfReadError";
  }
}

/** ¿Empieza como un PDF? (La cabecera puede ir tras unos bytes de basura: se mira el primer KB.) */
export function looksLikePdf(bytes: Uint8Array): boolean {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
  return head.includes("%PDF-");
}

type TextItemLike = { str?: string; transform?: number[]; width?: number; height?: number };

/**
 * La capa de texto del PDF con las columnas alineadas (src/domain/invoice-import/layout.ts). Un PDF
 * escaneado devuelve texto vacío. Nunca registra su contenido.
 */
export async function extractPdfText(bytes: Uint8Array): Promise<{ text: string; pages: number }> {
  let document: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    // Copia: pdf.js se queda con el buffer que recibe.
    document = await getDocumentProxy(new Uint8Array(bytes));
  } catch (error) {
    throw new PdfReadError(error instanceof Error && error.name === "PasswordException" ? "encrypted" : "invalid");
  }
  try {
    const pages: PositionedText[][] = [];
    for (let number = 1; number <= Math.min(document.numPages, MAX_PDF_PAGES); number += 1) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      pages.push(
        (content.items as TextItemLike[]).flatMap((item) => {
          if (typeof item.str !== "string" || !item.transform) return [];
          return [{ str: item.str, x: item.transform[4] ?? 0, y: item.transform[5] ?? 0, width: item.width ?? 0, height: item.height ?? 0 }];
        }),
      );
      page.cleanup();
    }
    return { text: layoutPages(pages), pages: document.numPages };
  } finally {
    await document.loadingTask.destroy();
  }
}
