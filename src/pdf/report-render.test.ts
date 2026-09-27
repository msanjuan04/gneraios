import { describe, expect, it } from "vitest";
import type { ReportLocale } from "@/domain/reports";
import { renderClientReportPdf } from "./report-render";
import { sampleLongReport, sampleReport } from "./report-samples";

// Comprobaciones ligeras sobre el binario, como en render.test.ts: qué se imprime se prueba en
// report-view-model.test.ts.

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

describe("renderClientReportPdf", () => {
  it.each<[ReportLocale, string]>([
    ["es", "Agosto de 2026"],
    ["ca", "Agost de 2026"],
    ["en", "August 2026"],
  ])("%s: un PDF válido con el mes en los metadatos", async (locale, headline) => {
    const pdf = await renderClientReportPdf(sampleReport(locale));
    expectPdf(pdf);
    expect(pageCount(pdf)).toBeGreaterThanOrEqual(1);
    expect(hasMetadata(pdf, headline)).toBe(true);
    expect(pdf.toString("latin1")).toContain(`/Lang (${{ es: "es-ES", ca: "ca-ES", en: "en-IE" }[locale]})`);
  });

  it("sin web, sin horas y sin nada hecho: sigue siendo un informe", async () => {
    const pdf = await renderClientReportPdf(sampleReport("es", { webGate: "section_off", web: null, projects: [], activities: [], files: [], invoices: [] }));
    expectPdf(pdf);
    expect(pageCount(pdf)).toBe(1);
  });

  it("con horas y un mes muy cargado: pagina en varias hojas", async () => {
    const pdf = await renderClientReportPdf(sampleLongReport(80));
    expectPdf(pdf);
    expect(pageCount(pdf)).toBeGreaterThanOrEqual(2);
  });
});
