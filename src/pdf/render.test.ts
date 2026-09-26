import { describe, expect, it } from "vitest";
import { renderInvoicePdf } from "./render";
import {
  buildSampleInvoice,
  sampleCompanyIssuer,
  sampleEuClient,
  sampleLongInvoice,
  sampleQrDataUrl,
  sampleRectifyingInvoice,
  sampleReverseChargeInvoice,
  sampleSpanishInvoice,
} from "./samples";
import type { InvoiceDocumentData, PdfLocale } from "./types";

// Comprobaciones ligeras sobre el binario: el texto de las páginas va comprimido y con los
// glifos de la fuente, así que qué se imprime se prueba en view-model.test.ts.

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

describe("renderInvoicePdf", () => {
  it.each<[string, InvoiceDocumentData]>([
    ["es · ordinaria con IRPF", sampleSpanishInvoice],
    ["en · inversión del sujeto pasivo, sin IRPF", sampleReverseChargeInvoice],
    ["ca · rectificativa en negativo con QR", sampleRectifyingInvoice],
  ])("%s: un PDF válido de una página con el número en los metadatos", async (_, data) => {
    const pdf = await renderInvoicePdf(data);
    expectPdf(pdf);
    expect(pageCount(pdf)).toBe(1);
    expect(hasMetadata(pdf, data.number ?? "")).toBe(true);
    expect(pdf.toString("latin1")).toContain(`/Lang (${{ es: "es-ES", ca: "ca-ES", en: "en-IE" }[data.locale]})`);
  });

  it.each<PdfLocale>(["es", "ca", "en"])("borrador en %s: sin número", async (locale) => {
    const pdf = await renderInvoicePdf({ ...sampleRectifyingInvoice, locale, isDraft: true, number: "R-2027-0099" });
    expectPdf(pdf);
    expect(hasMetadata(pdf, "R-2027-0099")).toBe(false);
    expect(hasMetadata(pdf, { es: "Borrador", ca: "Esborrany", en: "Draft" }[locale])).toBe(true);
  });

  it("regímenes al 0 % con menciones legales, cliente con letras fuera del latin básico", async () => {
    const data = buildSampleInvoice(
      {
        locale: "es",
        kind: "ordinary",
        isDraft: false,
        number: "2026-0050",
        issuedOn: "2026-10-01",
        issuer: sampleCompanyIssuer,
        client: { ...sampleEuClient, legalName: "Łódź Przykład Sp. z o.o.", city: "Łódź", countryCode: "PL" },
        legalNotes: ["Operación exenta de IVA (art. 20 LIVA)", "Operación no sujeta a IVA (art. 69 LIVA)"],
        payment: { method: "cash" },
        notes: "Àà Éé Èè Íí Ïï Òò Óó Úú Üü Çç Ññ · € ª º — col·laboració",
        verifactu: { qrDataUrl: sampleQrDataUrl(), legend: "VERI*FACTU" },
      },
      [
        { description: "Formación", quantity: "1", unitPriceCents: 40_000, discountBps: 0, vatBps: 0, vatRegime: "exempt", billingType: "one_off" },
        { description: "Licencias", quantity: "2.5", unitPriceCents: 1_999, discountBps: 500, vatBps: 0, vatRegime: "not_subject", billingType: "yearly", periodStart: "2026-10-01", periodEnd: "2027-09-30" },
        { description: "Consultoría", quantity: "4", unitPriceCents: 9_000, discountBps: 0, vatBps: 2100, vatRegime: "general", billingType: "one_off" },
      ],
    );
    const pdf = await renderInvoicePdf(data);
    expectPdf(pdf);
    expect(pageCount(pdf)).toBe(1);
  });

  it("60 líneas: pagina en varias hojas", async () => {
    const pdf = await renderInvoicePdf(sampleLongInvoice(60));
    expectPdf(pdf);
    expect(pageCount(pdf)).toBeGreaterThanOrEqual(2);
  });

  it("rechaza una factura emitida sin número", async () => {
    await expect(renderInvoicePdf({ ...sampleSpanishInvoice, number: null })).rejects.toThrow(/número/);
  });
});
