import { describe, expect, it } from "vitest";
import { buildSampleQuote, sampleQuote } from "./quote-samples";
import type { QuoteDocumentData } from "./quote-types";
import { buildQuoteView } from "./quote-view-model";
import { sampleEuClient } from "./samples";

/** Intl separa cifra y símbolo con un espacio duro (U+00A0); en los tests se leen como espacios. */
function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value).replaceAll(" ", " ")) as T;
}

const view = (data: QuoteDocumentData) => plain(buildQuoteView(data));
const totalsOf = (totals: { rows: { label: string; value: string }[]; total: { label: string; value: string } }) => ({
  ...Object.fromEntries(totals.rows.map((row) => [row.label, row.value])),
  [totals.total.label]: totals.total.value,
});

describe("presupuesto en español", () => {
  const es = view(sampleQuote);

  it("cabecera: tipo, número, título y fechas; sin marca de borrador", () => {
    expect(es.documentType).toBe("Presupuesto");
    expect(es.headline).toBe("P2026-0007");
    expect(es.subtitle).toBe("Web corporativa y mantenimiento");
    expect(es.title).toBe("Presupuesto P2026-0007");
    expect(es.draft).toBeNull();
    expect(es.dates).toEqual([
      { label: "Fecha", value: "01/10/2026" },
      { label: "Válido hasta", value: "31/10/2026" },
    ]);
    expect([es.issuer.heading, es.client.heading]).toEqual(["Emisor", "Cliente"]);
  });

  it("el resumen deja cada cosa por su lado: pago único, cuota mensual, anual y por uso", () => {
    expect(es.summary).toEqual({
      title: "Resumen",
      items: [
        { label: "Pago único", value: "4.610,10 €" },
        { label: "Cuota mensual", value: "423,50 €/mes" },
        { label: "Cuota anual", value: "290,40 €/año" },
        { label: "Por uso", value: "según consumo" },
      ],
      note: "IVA incluido",
    });
  });

  it("pago único: sus líneas, sus totales y el plan de pagos con lo que cobra cada pago", () => {
    const oneOff = es.oneOff!;
    expect(oneOff.title).toBe("Pago único");
    expect(oneOff.table.headers.discount).toBe("Dto.");
    expect(oneOff.table.headers.vat).toBeNull();
    expect(oneOff.table.rows.map((r) => [r.description, r.quantity, r.unitPrice, r.discount, r.amount])).toEqual([
      ["Diseño y desarrollo web", "1", "3.000,00 €", "", "3.000,00 €"],
      ["Sesión de fotografía", "2", "450,00 €", "10 %", "810,00 €"],
    ]);
    expect(totalsOf(oneOff.totals)).toEqual({ "Base imponible": "3.810,00 €", "IVA 21 %": "800,10 €", "Total pago único": "4.610,10 €" });
    expect(oneOff.plan?.rows).toEqual([
      { label: "Inicio del proyecto", when: "A la aceptación", percent: "50 %", amount: "1.905,00 €", total: "2.305,05 €" },
      { label: "Entrega final", when: "A la entrega", percent: "50 %", amount: "1.905,00 €", total: "2.305,05 €" },
    ]);
  });

  it("cuotas recurrentes: €/mes y €/año, con su inicio, y un total por cada ciclo", () => {
    const recurring = es.recurring!;
    expect(recurring.table.rows.map((r) => [r.description, r.detail, r.amount])).toEqual([
      ["Mantenimiento web", "Mensual · Desde la aceptación", "150,00 €/mes"],
      ["SEO local", "Mensual · Desde el 01/11/2026", "200,00 €/mes"],
      ["Hosting y dominio", "Anual · Desde la aceptación", "240,00 €/año"],
    ]);
    expect(recurring.totals.map(totalsOf)).toEqual([
      { "Base mensual": "350,00 €/mes", "IVA 21 %": "73,50 €/mes", "Total mensual": "423,50 €/mes" },
      { "Base anual": "240,00 €/año", "IVA 21 %": "50,40 €/año", "Total anual": "290,40 €/año" },
    ]);
  });

  it("por uso: el precio de cada uso, sin total; validez, observaciones y aceptación", () => {
    expect(es.usage?.table.rows.map((r) => [r.detail, r.amount])).toEqual([["Por uso · Desde la aceptación", "375,00 €/uso"]]);
    expect(es.validity).toEqual({ title: "Válido hasta", text: "Este presupuesto es válido hasta el 31/10/2026." });
    expect(es.notes?.text).toBe("Incluye dos rondas de cambios sobre el diseño.");
    expect(es.acceptance.fields).toEqual(["Nombre y cargo", "Fecha", "Firma"]);
    expect(es.acceptance.accepted).toBeNull();
  });

  it("aceptado: la fecha sustituye a los huecos de firma", () => {
    const accepted = view({ ...sampleQuote, acceptedOn: "2026-10-05" });
    expect(accepted.acceptance).toMatchObject({ accepted: "Aceptado el 05/10/2026", text: null, fields: [] });
  });
});

describe("borradores, idiomas y casos límite", () => {
  it("un borrador no lleva número aunque lo traiga", () => {
    const draft = view({ ...sampleQuote, isDraft: true });
    expect(draft.headline).toBe("Borrador");
    expect(draft.draft).toEqual({ mark: "BORRADOR", notice: "Borrador: sin número hasta que se envíe" });
    expect(draft.title).toBe("Presupuesto · Borrador");
    expect(() => buildQuoteView({ ...sampleQuote, number: null })).toThrow(/número/);
  });

  it("en inglés y en catalán, con sus ciclos y el país de las dos partes si una es extranjera", () => {
    const en = view({ ...sampleQuote, locale: "en", client: sampleEuClient });
    expect(en.documentType).toBe("Quote");
    expect([en.issuer.heading, en.client.heading]).toEqual(["From", "Prepared for"]);
    expect(en.summary?.items.map((i) => i.value)).toEqual(["€4,610.10", "€423.50/month", "€290.40/year", "as used"]);
    expect(en.oneOff?.plan?.rows[0]?.when).toBe("On acceptance");
    expect(en.issuer.lines).toContain("Spain");

    const ca = view({ ...sampleQuote, locale: "ca" });
    expect(ca.documentType).toBe("Pressupost");
    expect(ca.recurring?.totals[1]?.total).toEqual({ label: "Total anual", value: "290,40 €/any" });
    expect(ca.validity?.text).toBe("Aquest pressupost és vàlid fins al 31/10/2026.");
  });

  it("sin líneas no hay resumen ni secciones; sin plan, la sección puntual va sin él", () => {
    const empty = view(buildSampleQuote({ ...sampleQuote, isDraft: true }, []));
    expect([empty.summary, empty.oneOff, empty.recurring, empty.usage]).toEqual([null, null, null, null]);
    const noPlan = view(
      buildSampleQuote(sampleQuote, [
        { description: "Web", billingType: "one_off", quantity: "1", unitPriceCents: 100_000, discountBps: 0, vatBps: 0, vatRegime: "reverse_charge_eu" },
        { description: "Logo", billingType: "one_off", quantity: "1", unitPriceCents: 50_000, discountBps: 0, vatBps: 2100, vatRegime: "general" },
      ]),
    );
    expect(noPlan.oneOff?.plan).toBeNull();
    // Dos tipos: la columna de IVA aparece y el desglose indica la base de cada uno.
    expect(noPlan.oneOff?.table.headers.vat).toBe("IVA");
    expect(noPlan.oneOff?.totals.rows.map((r) => [r.label, r.hint, r.value])).toEqual([
      ["Base imponible", null, "1.500,00 €"],
      ["IVA 21 %", "sobre 500,00 €", "105,00 €"],
      ["Inversión del sujeto pasivo", "sobre 1.000,00 €", "0,00 €"],
    ]);
  });
});
