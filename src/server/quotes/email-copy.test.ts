import { describe, expect, it } from "vitest";
import { renderQuoteEmail } from "./email-copy";

const params = {
  title: "Web corporativa",
  issuerName: "GNERAI",
  validUntil: "2026-10-26",
  oneOffCents: 461_010,
  monthlyCents: 42_350,
  yearlyCents: null,
  hasUsage: true,
};

/** Intl separa cifra y símbolo con un espacio duro (U+00A0); en los tests se leen como espacios. */
const plain = (text: string) => text.replaceAll(" ", " ");

describe("email del presupuesto", () => {
  it("en español: título, resumen por tipo (sin mezclar) y validez", () => {
    const { subject, body } = renderQuoteEmail("es", params);
    expect(subject).toBe("Presupuesto: Web corporativa · GNERAI");
    expect(plain(body)).toContain("– Pago único: 4.610,10 €\n– Cuota mensual: 423,50 €/mes\n– Servicios por uso");
    expect(body).toContain("Es válido hasta el 26/10/2026.");
    expect(body).not.toContain("Cuota anual");
  });

  it("en catalán y en inglés, con su formato de importes", () => {
    expect(plain(renderQuoteEmail("ca", params).body)).toContain("– Pagament únic: 4.610,10 €");
    const en = renderQuoteEmail("en", { ...params, yearlyCents: 29_040, hasUsage: false });
    expect(en.subject).toBe("Quote: Web corporativa · GNERAI");
    expect(plain(en.body)).toContain("– Yearly fee: €290.40/year\nAmounts include VAT.");
  });

  it("sin líneas no hay resumen", () => {
    const { body } = renderQuoteEmail("es", { ...params, oneOffCents: null, monthlyCents: null, hasUsage: false });
    expect(body).not.toContain("IVA incluido");
  });
});
