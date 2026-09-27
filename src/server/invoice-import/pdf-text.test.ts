import { Document, type DocumentProps, Page, renderToBuffer, StyleSheet, Text, View } from "@react-pdf/renderer";
import { createElement as h, type ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { parseInvoiceText } from "@/domain/invoice-import/parse";
import { renderInvoicePdf } from "@/pdf/render";
import { sampleRectifyingInvoice, sampleReverseChargeInvoice, sampleSpanishInvoice } from "@/pdf/samples";
import { extractPdfText, looksLikePdf, PdfReadError } from "./pdf-text";

// El lector de texto con PDF de verdad: los de la plantilla de GNERAI OS (src/pdf) y uno con el
// aspecto de otra herramienta, dibujado aquí con react-pdf. Todos con datos inventados.

async function read(pdf: Buffer, issuerTaxIds: string[]) {
  const { text } = await extractPdfText(new Uint8Array(pdf));
  return parseInvoiceText(text, { issuerTaxIds });
}

const styles = StyleSheet.create({
  page: { padding: 48, fontSize: 10, fontFamily: "Helvetica" },
  row: { flexDirection: "row" },
  right: { marginLeft: "auto", textAlign: "right" },
  cell: { width: 70, textAlign: "right" },
  desc: { flexGrow: 1 },
  block: { marginTop: 18 },
});

/** Una factura con el aspecto de la app de facturas antigua (cabecera a dos columnas, «Cliente:»). */
function legacyInvoice(): ReactElement<DocumentProps> {
  const row = (cells: string[], bold = false) =>
    h(
      View,
      { style: [styles.row, { marginTop: 4 }] },
      h(Text, { style: [styles.desc, bold ? { fontFamily: "Helvetica-Bold" } : {}] }, cells[0]),
      ...cells.slice(1).map((c) => h(Text, { style: styles.cell }, c)),
    );
  const total = (label: string, value: string) =>
    h(View, { style: [styles.row, { marginTop: 3 }] }, h(Text, { style: { marginLeft: "auto", width: 120 } }, label), h(Text, { style: styles.cell }, value));
  return h<DocumentProps>(
    Document,
    {},
    h(
      Page,
      { size: "A4", style: styles.page },
      h(
        View,
        { style: styles.row },
        h(View, null, h(Text, null, "Marc Sanjuan Sard"), h(Text, null, "NIF: 12345678Z"), h(Text, null, "Carrer Major 1"), h(Text, null, "08301 Mataró (Barcelona)")),
        h(View, { style: styles.right }, h(Text, { style: { fontSize: 18 } }, "FACTURA"), h(Text, null, "Nº Factura: 2025-0036"), h(Text, null, "Fecha: 15/03/2025")),
      ),
      h(
        View,
        { style: styles.block },
        h(Text, null, "Cliente:"),
        h(Text, null, "Restaurant del Port SL"),
        h(Text, null, "CIF: B12345674"),
        h(Text, null, "Passeig Marítim 3"),
        h(Text, null, "08301 Mataró (Barcelona)"),
      ),
      h(
        View,
        { style: styles.block },
        row(["Concepto", "Cantidad", "Precio", "Importe"], true),
        row(["Mantenimiento web marzo 2025", "1", "150,00 €", "150,00 €"]),
        row(["Campaña Meta Ads · marzo", "1", "750,00 €", "750,00 €"]),
      ),
      h(View, { style: styles.block }, total("Base imponible", "900,00 €"), total("IVA (21%)", "189,00 €"), total("IRPF (-15%)", "-135,00 €"), total("TOTAL", "954,00 €")),
      h(View, { style: styles.block }, h(Text, null, "Forma de pago: Transferencia bancaria"), h(Text, null, "Vencimiento: 14/04/2025"), h(Text, { style: { marginTop: 12, fontSize: 16 } }, "PAGADA 20/04/2025")),
    ),
  );
}

describe("extractPdfText + parseInvoiceText con PDF de verdad", () => {
  it("la plantilla de GNERAI OS (autónomo con IRPF, descuento y periodos)", async () => {
    const e = await read(await renderInvoicePdf(sampleSpanishInvoice), ["00000000T"]);
    expect(e.number?.value).toBe("2026-0042");
    expect(e.issuedOn?.value).toBe("2026-10-15");
    expect(e.dueOn?.value).toBe("2026-11-14");
    expect(e.issuer.taxId?.value).toBe("00000000T");
    expect(e.issuer.name?.value).toBe("Laia Mostra Exemple");
    expect(e.recipient.taxId?.value).toBe("B00000018");
    expect(e.recipient.name?.value).toBe("Cal Exemple Restauració SL");
    expect(e.recipient.address?.value).toBe("Plaça de la Mostra, 3, baixos");
    expect(e.recipient.postalCode?.value).toBe("08330");
    expect(e.recipient.city?.value).toBe("Premià de Mar");
    expect(e.baseCents).toEqual({ value: sampleSpanishInvoice.totals.subtotalCents, confidence: "high" });
    expect(e.vatCents?.value).toBe(sampleSpanishInvoice.totals.vatCents);
    expect(e.vatBps?.value).toBe(2100);
    expect(e.irpfCents?.value).toBe(sampleSpanishInvoice.totals.irpfCents);
    expect(e.irpfBps?.value).toBe(1500);
    expect(e.totalCents).toEqual({ value: sampleSpanishInvoice.totals.totalCents, confidence: "high" });
    expect(e.paymentMethod?.value).toBe("transfer");
    expect(e.lines.map((l) => [l.description, l.quantity, l.unitPriceCents, l.discountBps, l.amountCents])).toEqual(
      sampleSpanishInvoice.lines.map((l) => [l.description, l.quantity.replace(/\.?0+$/, ""), l.unitPriceCents, l.discountBps || null, l.baseCents]),
    );
    expect(e.lines.map((l) => [l.periodStart, l.periodEnd])).toEqual(sampleSpanishInvoice.lines.map((l) => [l.periodStart ?? null, l.periodEnd ?? null]));
    expect(e.warnings).toEqual([]);
  });

  it("la plantilla en inglés con inversión del sujeto pasivo", async () => {
    const e = await read(await renderInvoicePdf(sampleReverseChargeInvoice), [sampleReverseChargeInvoice.issuer.taxId!]);
    expect(e.number?.value).toBe(sampleReverseChargeInvoice.number);
    expect(e.issuedOn?.value).toBe(sampleReverseChargeInvoice.issuedOn);
    expect(e.totalCents?.value).toBe(sampleReverseChargeInvoice.totals.totalCents);
    expect(e.vatCents?.value).toBe(0);
    expect(e.vatRegime?.value).toBe("reverse_charge_eu");
  });

  it("una rectificativa de la plantilla (en catalán) se avisa", async () => {
    const e = await read(await renderInvoicePdf(sampleRectifyingInvoice), [sampleRectifyingInvoice.issuer.taxId!]);
    expect(e.warnings).toContain("rectifying");
    expect(e.number?.value).toBe(sampleRectifyingInvoice.number);
  });

  it("otra herramienta: la app de facturas antigua, con sello de pagada", async () => {
    const e = await read(await renderToBuffer(legacyInvoice()), ["12345678Z"]);
    expect(e.number).toEqual({ value: "2025-0036", confidence: "high" });
    expect(e.issuedOn?.value).toBe("2025-03-15");
    expect(e.dueOn?.value).toBe("2025-04-14");
    expect(e.recipient.taxId?.value).toBe("B12345674");
    expect(e.recipient.name?.value).toBe("Restaurant del Port SL");
    expect([e.baseCents?.value, e.vatCents?.value, e.irpfCents?.value, e.totalCents?.value]).toEqual([90_000, 18_900, 13_500, 95_400]);
    expect(e.lines.map((l) => [l.description, l.amountCents])).toEqual([
      ["Mantenimiento web marzo 2025", 15_000],
      ["Campaña Meta Ads · marzo", 75_000],
    ]);
    expect(e.paid).toEqual({ value: true, confidence: "high" });
    expect(e.paidOn).toEqual({ value: "2025-04-20", confidence: "high" });
  });

  it("un fichero que no es un PDF", async () => {
    const bytes = new TextEncoder().encode("esto no es un pdf");
    expect(looksLikePdf(bytes)).toBe(false);
    await expect(extractPdfText(bytes)).rejects.toBeInstanceOf(PdfReadError);
    expect(looksLikePdf(new TextEncoder().encode("%PDF-1.7\n..."))).toBe(true);
  });
});
