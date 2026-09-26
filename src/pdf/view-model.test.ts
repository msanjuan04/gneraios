import { describe, expect, it } from "vitest";
import {
  buildSampleInvoice,
  sampleCompanyIssuer,
  sampleEuClient,
  sampleLongInvoice,
  sampleRectifyingInvoice,
  sampleReverseChargeInvoice,
  sampleSpanishClient,
  sampleSpanishInvoice,
} from "./samples";
import type { InvoiceDocumentData, PdfLocale } from "./types";
import { buildInvoiceView } from "./view-model";

/** Intl separa cifra y símbolo con un espacio duro (U+00A0); en los tests se leen como espacios. */
function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value).replaceAll("\u00a0", " ")) as T;
}

function view(data: InvoiceDocumentData) {
  return plain(buildInvoiceView(data));
}

function totalsOf(data: InvoiceDocumentData) {
  return Object.fromEntries(view(data).totals.rows.map((row) => [row.label, row.value]));
}

describe("factura ordinaria en español con IRPF", () => {
  const es = view(sampleSpanishInvoice);

  it("cabecera: tipo, número y fechas en DD/MM/YYYY", () => {
    expect(es.documentType).toBe("Factura");
    expect(es.headline).toBe("2026-0042");
    expect(es.title).toBe("Factura 2026-0042");
    expect(es.draft).toBeNull();
    expect(es.dates).toEqual([
      { label: "Fecha de emisión", value: "15/10/2026" },
      { label: "Vencimiento", value: "14/11/2026" },
    ]);
    expect(es.language).toBe("es-ES");
  });

  it("totales con separador de miles, IRPF en negativo y total a pagar", () => {
    expect(totalsOf(sampleSpanishInvoice)).toEqual({
      "Base imponible": "3.289,19 €",
      "IVA 21 %": "690,73 €",
      "Retención IRPF 15 %": "-493,38 €",
    });
    expect(es.totals.total).toEqual({ label: "Total a pagar", value: "3.486,54 €" });
    // El importe y el símbolo no se separan nunca de línea.
    expect(buildInvoiceView(sampleSpanishInvoice).totals.total.value).toBe("3.486,54\u00a0€");
    // Un solo tipo: el desglose no repite la base.
    expect(es.totals.rows.every((row) => row.hint === null)).toBe(true);
  });

  it("líneas: descuento solo porque una lo lleva, sin columna de IVA y con el periodo debajo", () => {
    expect(es.table.headers.discount).toBe("Dto.");
    expect(es.table.headers.vat).toBeNull();
    const [web, photo, social, support] = es.table.rows;
    expect(web).toMatchObject({ quantity: "1", unitPrice: "2.400,00 €", discount: "", base: "2.400,00 €" });
    expect(web.detail).toBeNull();
    expect(photo).toMatchObject({ discount: "10 %", base: "405,00 €" });
    expect(social.detail).toBe("Mensual · 15/10/2026 – 31/10/2026");
    expect(social.base).toBe("274,19 €");
    expect(support).toMatchObject({ quantity: "3,5", detail: "Por consumo · 01/09/2026 – 30/09/2026" });
  });

  it("partes: NIF, dirección completa y sin país entre dos partes españolas", () => {
    expect(es.issuer).toEqual({
      heading: "Emisor",
      name: "Laia Mostra Exemple",
      tradeName: "GNERAI",
      lines: [
        "NIF 00000000T",
        "Passeig de l'Exemple, 7, 3r 2a",
        "08350 Arenys de Mar (Barcelona)",
        "laia@example.com · +34 600 000 000",
      ],
    });
    expect(es.client.heading).toBe("Cliente");
    expect(es.client.lines).not.toContain("España");
  });

  it("pago por transferencia con el IBAN del emisor en grupos de 4", () => {
    expect(es.payment).toEqual({
      title: "Datos de pago",
      rows: [
        { label: "Forma de pago", value: "Transferencia bancaria" },
        { label: "IBAN", value: "ES00 0000 0000 0000 0000 0000" },
        { label: "Titular", value: "Laia Mostra Exemple" },
        { label: "Vencimiento", value: "14/11/2026" },
      ],
    });
    expect(es.footer.registryInfo).toBeNull();
    expect(buildInvoiceView(sampleSpanishInvoice).footer.pageLabel(1, 2)).toBe("Página 1 / 2");
    expect(es.runningHeader).toBe("Factura 2026-0042 · Cal Exemple Restauració SL");
  });
});

describe("cliente de la UE con inversión del sujeto pasivo (en)", () => {
  const en = view(sampleReverseChargeInvoice);

  it("sin IRPF, con el 0 % nombrado por su régimen y la mención legal tal cual", () => {
    expect(totalsOf(sampleReverseChargeInvoice)).toEqual({
      "Taxable amount": "€5,112.50",
      "Reverse charge": "€0.00",
    });
    expect(en.totals.total).toEqual({ label: "Total due", value: "€5,112.50" });
    expect(en.legalNotes?.items).toEqual(sampleReverseChargeInvoice.legalNotes);
    expect(en.table.headers.discount).toBeNull();
  });

  it("fecha de operación distinta y países de las dos partes, traducidos", () => {
    expect(en.dates.map((date) => date.label)).toEqual(["Issue date", "Date of supply", "Due date"]);
    expect(en.dates[1].value).toBe("31/10/2026");
    expect(en.issuer.lines).toContain("Spain");
    expect(en.client.lines).toContain("Ireland");
    expect(en.client.heading).toBe("Bill to");
    expect(en.footer.registryInfo).toContain("Registro Mercantil");
    expect(en.table.rows[3].quantity).toBe("12.5");
  });
});

describe("rectificativa en catalán", () => {
  const ca = view(sampleRectifyingInvoice);

  it("recuadro con la factura rectificada, su fecha y el motivo", () => {
    expect(ca.documentType).toBe("Factura rectificativa");
    expect(ca.rectifies).toEqual({
      number: { label: "Factura rectificada", value: "2026-0118" },
      issuedOn: { label: "Data d'emissió", value: "15/12/2026" },
      reason: { label: "Motiu de la rectificació", value: sampleRectifyingInvoice.rectifies?.reason },
    });
  });

  it("importes en negativo tal como llegan", () => {
    expect(ca.table.rows.map((row) => row.base)).toEqual(["-50,00 €", "-600,00 €"]);
    expect(totalsOf(sampleRectifyingInvoice)).toEqual({
      "Base imposable": "-650,00 €",
      "IVA 21 %": "-136,50 €",
    });
    expect(ca.totals.total).toEqual({ label: "Total factura", value: "-786,50 €" });
    expect(ca.payment).toBeNull();
  });

  it("pasa el QR y la leyenda de Verifactu", () => {
    expect(ca.verifactu?.qrDataUrl).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(ca.verifactu?.legend).toBe("Factura verificable en la sede electrónica de la AEAT");
    expect(view(sampleSpanishInvoice).verifactu).toBeNull();
  });

  it("una rectificativa de IRPF devuelve la retención: se imprime en positivo", () => {
    const withIrpf = buildSampleInvoice(
      { ...sampleRectifyingInvoice, locale: "es" },
      [
        {
          description: "Abono",
          quantity: "1",
          unitPriceCents: -10_000,
          discountBps: 0,
          vatBps: 2100,
          vatRegime: "general",
          billingType: "one_off",
        },
      ],
      1500,
    );
    expect(totalsOf(withIrpf)["Retención IRPF 15 %"]).toBe("15,00 €");
    expect(view(withIrpf).totals.total.value).toBe("-106,00 €");
  });
});

describe("borradores", () => {
  const marks: Record<PdfLocale, string> = { es: "BORRADOR", ca: "ESBORRANY", en: "DRAFT" };

  it.each(Object.entries(marks))("%s: marca visible y sin número aunque lo traiga", (locale, mark) => {
    const draft = view({ ...sampleSpanishInvoice, locale: locale as PdfLocale, isDraft: true, number: "2026-9999" });
    expect(draft.draft?.mark).toBe(mark);
    expect(draft.headline).not.toContain("9999");
    expect(draft.title).not.toContain("9999");
    expect(draft.runningHeader).not.toContain("9999");
  });

  it("el título dice que es un borrador", () => {
    const draft = view({ ...sampleSpanishInvoice, isDraft: true, number: null });
    expect(draft.headline).toBe("Borrador");
    expect(draft.title).toBe("Factura · Borrador");
    expect(draft.runningHeader).toBe("Factura · Borrador · Cal Exemple Restauració SL");
    expect(draft.draft?.notice).toBe("Documento sin validez fiscal hasta su emisión");
  });
});

describe("regímenes al 0 %", () => {
  const mixed = buildSampleInvoice(
    {
      locale: "es",
      kind: "ordinary",
      isDraft: false,
      number: "2026-0050",
      issuedOn: "2026-10-01",
      issuer: sampleCompanyIssuer,
      client: sampleEuClient,
      legalNotes: ["Operación exenta de IVA (art. 20 LIVA)", "  ", "Operación no sujeta a IVA (art. 69 LIVA)"],
    },
    [
      { description: "A", quantity: "1", unitPriceCents: 10_000, discountBps: 0, vatBps: 2100, vatRegime: "general", billingType: "one_off" },
      { description: "B", quantity: "1", unitPriceCents: 20_000, discountBps: 0, vatBps: 0, vatRegime: "exempt", billingType: "one_off" },
      { description: "C", quantity: "1", unitPriceCents: 30_000, discountBps: 0, vatBps: 0, vatRegime: "not_subject", billingType: "one_off" },
      { description: "D", quantity: "1", unitPriceCents: 5_000, discountBps: 0, vatBps: 0, vatRegime: "general", billingType: "one_off" },
    ],
  );
  const mixedView = view(mixed);

  it("cada grupo con su etiqueta y, al haber varios, la base de cada uno", () => {
    expect(mixedView.totals.rows.slice(1)).toEqual([
      { label: "IVA 21 %", hint: "sobre 100,00 €", value: "21,00 €" },
      { label: "IVA 0 %", hint: "sobre 50,00 €", value: "0,00 €" },
      { label: "Exento de IVA", hint: "sobre 200,00 €", value: "0,00 €" },
      { label: "No sujeto a IVA", hint: "sobre 300,00 €", value: "0,00 €" },
    ]);
  });

  it("con tipos distintos aparece la columna de IVA; las menciones vacías se omiten", () => {
    expect(mixedView.table.headers.vat).toBe("IVA");
    expect(mixedView.table.rows.map((row) => row.vat)).toEqual(["21 %", "0 %", "0 %", "0 %"]);
    expect(mixedView.legalNotes).toEqual({
      title: "Menciones legales",
      items: ["Operación exenta de IVA (art. 20 LIVA)", "Operación no sujeta a IVA (art. 69 LIVA)"],
    });
    expect(mixedView.issuer.lines).toContain("España");
    expect(mixedView.client.lines).toContain("Irlanda");
  });
});

describe("pago", () => {
  it("domiciliación: la cuenta de cargo es la del pago, nunca la del emisor", () => {
    expect(view(sampleLongInvoice(1)).payment?.rows).toEqual([
      { label: "Forma de pago", value: "Domiciliación bancaria (SEPA)" },
      { label: "Cuenta de cargo", value: "ES00 0000 0000 0000 0000 0000" },
      { label: "Vencimiento", value: "31/10/2026" },
    ]);
  });

  it("tarjeta: solo la forma de pago y el vencimiento", () => {
    expect(view({ ...sampleSpanishInvoice, locale: "ca", payment: { method: "card" } }).payment?.rows).toEqual([
      { label: "Forma de pagament", value: "Targeta" },
      { label: "Venciment", value: "14/11/2026" },
    ]);
  });
});

describe("validación", () => {
  it("una factura emitida sin número no se imprime", () => {
    expect(() => buildInvoiceView({ ...sampleSpanishInvoice, number: null })).toThrow(/número/);
    expect(() => buildInvoiceView({ ...sampleSpanishInvoice, number: "  " })).toThrow(/número/);
  });

  it("una rectificativa emitida debe decir qué factura rectifica", () => {
    expect(() => buildInvoiceView({ ...sampleRectifyingInvoice, rectifies: null })).toThrow(/rectifica/);
    expect(() => buildInvoiceView({ ...sampleRectifyingInvoice, isDraft: true, rectifies: null })).not.toThrow();
  });

  it("el nombre comercial igual a la razón social no se repite", () => {
    const same = view({
      ...sampleSpanishInvoice,
      client: { ...sampleSpanishClient, tradeName: sampleSpanishClient.legalName },
    });
    expect(same.client.tradeName).toBeNull();
  });
});
