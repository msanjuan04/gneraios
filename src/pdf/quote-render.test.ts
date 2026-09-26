import { describe, expect, it } from "vitest";
import { renderQuotePdf } from "./quote-render";
import { sampleLongQuote, sampleQuote } from "./quote-samples";
import type { PdfLocale } from "./types";

// Comprobaciones ligeras sobre el binario, como en render.test.ts: qué se imprime se prueba
// en quote-view-model.test.ts.

function expectPdf(pdf: Buffer) {
  expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  expect(pdf.subarray(-6).toString("latin1")).toContain("%%EOF");
}

function pageCount(pdf: Buffer): number {
  return pdf.toString("latin1").match(/\/Type \/Page(?!s)/g)?.length ?? 0;
}

/** Metadatos (título, asunto…): pdfkit los guarda en ASCII o, si no caben, en UTF-16BE. */
function hasMetadata(pdf: Buffer, text: string): boolean {
  return pdf.includes(Buffer.from(text, "latin1")) || pdf.includes(Buffer.from(text, "utf16le").swap16());
}

describe("renderQuotePdf", () => {
  it.each<PdfLocale>(["es", "ca", "en"])("%s: un PDF válido con el número en los metadatos", async (locale) => {
    const pdf = await renderQuotePdf({ ...sampleQuote, locale });
    expectPdf(pdf);
    expect(pageCount(pdf)).toBeGreaterThanOrEqual(1);
    expect(hasMetadata(pdf, "P2026-0007")).toBe(true);
    expect(pdf.toString("latin1")).toContain(`/Lang (${{ es: "es-ES", ca: "ca-ES", en: "en-IE" }[locale]})`);
  });

  it("borrador: sin número, con la marca en el título", async () => {
    const pdf = await renderQuotePdf({ ...sampleQuote, isDraft: true });
    expectPdf(pdf);
    expect(hasMetadata(pdf, "P2026-0007")).toBe(false);
    expect(hasMetadata(pdf, "Borrador")).toBe(true);
  });

  it("60 líneas: pagina en varias hojas", async () => {
    const pdf = await renderQuotePdf(sampleLongQuote(60));
    expectPdf(pdf);
    expect(pageCount(pdf)).toBeGreaterThanOrEqual(2);
  });

  it("rechaza uno enviado sin número", async () => {
    await expect(renderQuotePdf({ ...sampleQuote, number: null })).rejects.toThrow(/número/);
  });
});
