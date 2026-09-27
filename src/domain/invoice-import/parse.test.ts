import { describe, expect, it } from "vitest";
import { type FixtureExpectation, INVOICE_FIXTURES, type InvoiceFixture, RECTIFYING_FIXTURE } from "./fixtures";
import { parseInvoiceText, readInvoiceNumber } from "./parse";
import type { ExtractedInvoice } from "./types";

type Check = { field: string; expected: unknown; actual: unknown };

/** Cada dato esperado de la factura frente a lo leído (con los nombres de las líneas por orden). */
function checks(extraction: ExtractedInvoice, expected: FixtureExpectation): Check[] {
  const out: Check[] = [];
  const add = (field: keyof FixtureExpectation, actual: unknown) => {
    if (expected[field] !== undefined) out.push({ field, expected: expected[field], actual });
  };
  add("number", extraction.number?.value);
  add("series", extraction.series?.value);
  add("issuedOn", extraction.issuedOn?.value);
  add("dueOn", extraction.dueOn?.value);
  add("operationOn", extraction.operationOn?.value);
  add("issuerTaxId", extraction.issuer.taxId?.value);
  add("issuerName", extraction.issuer.name?.value);
  add("recipientTaxId", extraction.recipient.taxId?.value);
  add("recipientName", extraction.recipient.name?.value);
  add("recipientAddress", extraction.recipient.address?.value);
  add("recipientPostalCode", extraction.recipient.postalCode?.value);
  add("recipientCity", extraction.recipient.city?.value);
  add("recipientCountry", extraction.recipient.countryCode?.value);
  add("baseCents", extraction.baseCents?.value);
  add("vatBps", extraction.vatBps?.value ?? null);
  add("vatCents", extraction.vatCents?.value);
  add("irpfBps", extraction.irpfBps?.value);
  add("irpfCents", extraction.irpfCents?.value);
  add("totalCents", extraction.totalCents?.value);
  add("paymentMethod", extraction.paymentMethod?.value);
  add("paid", extraction.paid?.value ?? null);
  add("paidOn", extraction.paidOn?.value ?? null);
  if (expected.lines) {
    const actual = extraction.lines.map((l) => {
      const want = expected.lines![extraction.lines.indexOf(l)];
      return {
        description: l.description,
        amountCents: l.amountCents,
        ...(want?.quantity !== undefined && { quantity: l.quantity }),
        ...(want?.unitPriceCents !== undefined && { unitPriceCents: l.unitPriceCents }),
      };
    });
    out.push({ field: "lines", expected: expected.lines, actual });
  }
  return out;
}

const parse = (fixture: InvoiceFixture) => parseInvoiceText(fixture.text, { issuerTaxIds: fixture.issuerTaxIds });

describe("parseInvoiceText · facturas de ejemplo", () => {
  it.each(INVOICE_FIXTURES.map((f) => [f.name, f] as const))("%s: lee todos los datos", (_, fixture) => {
    const extraction = parse(fixture);
    const wrong = checks(extraction, fixture.expected).filter((c) => JSON.stringify(c.expected) !== JSON.stringify(c.actual));
    expect(wrong).toEqual([]);
  });

  it("acierta en todos los datos de todas las facturas de ejemplo", () => {
    let total = 0;
    let right = 0;
    for (const fixture of INVOICE_FIXTURES) {
      for (const check of checks(parse(fixture), fixture.expected)) {
        total += 1;
        if (JSON.stringify(check.expected) === JSON.stringify(check.actual)) right += 1;
      }
    }
    expect(total).toBeGreaterThan(120);
    expect(right / total).toBe(1);
  });
});

describe("parseInvoiceText · confianza y avisos", () => {
  const byName = (name: string) => parse(INVOICE_FIXTURES.find((f) => f.name === name)!);

  it("lo impreso con etiqueta y que cuadra es seguro", () => {
    const e = byName("app de facturas");
    expect(e.number?.confidence).toBe("high");
    expect(e.dueOn?.confidence).toBe("high");
    expect([e.baseCents, e.vatCents, e.irpfCents, e.totalCents].map((f) => f?.confidence)).toEqual(["high", "high", "high", "high"]);
    expect(e.issuer.taxId?.confidence).toBe("high");
    expect(e.recipient.taxId?.confidence).toBe("high");
    expect(e.lines.every((l) => l.confidence === "high")).toBe(true);
    expect(e.warnings).toEqual([]);
  });

  it("una etiqueta genérica («Fecha», «Número», el título «FACTURA») rebaja la confianza", () => {
    expect(byName("app de facturas").issuedOn?.confidence).toBe("medium");
    expect(byName("sello de pagada").number?.confidence).toBe("medium");
    expect(byName("plantilla con espaciado de letras").number?.confidence).toBe("medium");
  });

  it("una fecha sin etiqueta es una suposición", () => {
    expect(byName("carta de Word").issuedOn).toEqual({ value: "2025-02-05", confidence: "low" });
  });

  it("lo que no está impreso se deduce, con menos confianza", () => {
    const e = byName("pendiente, sin tabla ni total");
    expect(e.totalCents).toEqual({ value: 67_840, confidence: "medium" });
    expect(e.lines).toEqual([]);
  });

  it("varios tipos de IVA: suma las cuotas y lo avisa", () => {
    const e = byName("dos tipos de IVA");
    expect(e.warnings).toContain("multiple_vat_rates");
    expect(e.lines.map((l) => l.vatBps)).toEqual([2100, 1000]);
  });

  it("inversión del sujeto pasivo: IVA a cero con su régimen", () => {
    const e = byName("inglés, inversión del sujeto pasivo");
    expect(e.vatRegime?.value).toBe("reverse_charge_eu");
    expect(e.recipient.countryCode?.value).toBe("FR");
  });

  it("cobrada o pendiente, y la fecha de cobro aparte de la de la factura", () => {
    const catalan = byName("catalán con fecha de cobro");
    expect(catalan.paid).toEqual({ value: true, confidence: "high" });
    expect(catalan.paidOn).toEqual({ value: "2024-03-28", confidence: "high" });
    expect(catalan.issuedOn?.value).toBe("2024-03-03");
    const stamp = byName("sello de pagada");
    expect(stamp.paid).toEqual({ value: true, confidence: "high" });
    // «Fecha de pago» a veces es el vencimiento: se propone, pero con menos seguridad.
    expect(stamp.paidOn).toEqual({ value: "2025-06-25", confidence: "medium" });
    expect(byName("pendiente, sin tabla ni total").paid).toEqual({ value: false, confidence: "medium" });
    expect(byName("app de facturas").paid).toBeNull();
  });

  it("sin saber con qué NIF factura la org, el primero sin etiqueta es el emisor (con poca seguridad)", () => {
    const app = parseInvoiceText(INVOICE_FIXTURES.find((f) => f.name === "app de facturas")!.text);
    expect(app.issuer.taxId).toEqual({ value: "12345678Z", confidence: "low" });
    expect(app.recipient.taxId).toEqual({ value: "B12345674", confidence: "high" });
    // «De:» y «Para:» son etiquetas genéricas: deciden, con algo menos de seguridad.
    const letter = parseInvoiceText(INVOICE_FIXTURES.find((f) => f.name === "carta de Word")!.text);
    expect(letter.issuer.taxId).toEqual({ value: "11111111H", confidence: "medium" });
    expect(letter.recipient.taxId).toEqual({ value: "A08000002", confidence: "medium" });
  });

  it("las etiquetas de rol mandan sobre el orden", () => {
    // El cliente va primero y la org no ha dicho su NIF: «FACTURAR A» decide.
    const text = `FACTURAR A\nCliente Uno SL\nCIF B65432106\n\nEMISOR\nGNERAI SL\nCIF B09876541\n\nFactura nº 1\nFecha: 01/02/2025\nTotal: 121,00 €`;
    const e = parseInvoiceText(text);
    expect(e.recipient.taxId?.value).toBe("B65432106");
    expect(e.issuer.taxId?.value).toBe("B09876541");
  });

  it("una rectificativa se reconoce y se avisa, sin confundir el número de la rectificada", () => {
    const e = parse(RECTIFYING_FIXTURE);
    expect(e.warnings).toContain("rectifying");
    expect(e.number?.value).toBe("R-2025-0003");
    expect(e.issuedOn?.value).toBe("2025-04-30");
  });

  it("un NIF con el carácter de control mal no se lee", () => {
    const e = parseInvoiceText("Factura nº 2025-0001\nFecha: 01/02/2025\nCliente: Uno SL\nCIF: B12345670\nTotal: 121,00 €");
    expect(e.recipient.taxId).toBeNull();
  });

  it("un PDF sin texto (escaneado)", () => {
    expect(parseInvoiceText("   \n \n").warnings).toEqual(["no_text"]);
    expect(parseInvoiceText("").number).toBeNull();
  });

  it("importes en otra moneda", () => {
    const e = parseInvoiceText("Invoice number: 12\nInvoice date: 01/02/2025\nSubtotal $1,000.00\nTotal due $1,000.00\nUSD");
    expect(e.warnings).toContain("foreign_currency");
  });
});

describe("readInvoiceNumber", () => {
  it.each([
    [": 2025-0042", "2025-0042"],
    ["Nº F2025/012 de 15/03/2025", "F2025/012"],
    ["# MS-2025/007.", "MS-2025/007"],
    ["n.º 42", "42"],
  ])("«%s» → %s", (text, number) => {
    expect(readInvoiceNumber(text)).toBe(number);
  });

  it.each(["15/03/2025", "1.234,56", "rectificativa", "", "no se admiten devoluciones"])("«%s» no es un número de factura", (text) => {
    expect(readInvoiceNumber(text)).toBeNull();
  });
});
