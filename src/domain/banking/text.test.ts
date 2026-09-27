import { describe, expect, it } from "vitest";
import { findIbans, findInvoiceNumber, findTaxIds, matchName, normalizeText, ruleKey, significantWords, tokenSet } from "./text";

describe("texto de los movimientos", () => {
  it("normaliza y se queda con las palabras que identifican", () => {
    expect(normalizeText("Cafè l'Àvia, S.L.")).toBe("CAFE L AVIA S L");
    expect(significantWords("COMPRA TARJ. 5402XXXXXXXX1234 GOOGLE *ADS8246910 G.CO/HELPPAY#")).toEqual(["GOOGLE", "ADS", "HELPPAY"]);
    expect(significantWords("TRANSFERENCIA A FAVOR DE ORIOL PONS DEV SL")).toEqual(["ORIOL", "PONS", "DEV"]);
  });

  it("encuentra el número de una factura escrito de cualquier forma", () => {
    const text = (t: string) => normalizeText(t);
    expect(findInvoiceNumber("2026-0051", text("TRANSF FRA 2026-0051"))).toBe("exact");
    expect(findInvoiceNumber("2026-0051", text("FACTURA 2026/51"))).toBe("exact");
    expect(findInvoiceNumber("2026-0051", text("PAGO 20260051"))).toBe("exact");
    expect(findInvoiceNumber("2026-0051", text("FRA 2026-0052"))).toBeNull();
    expect(findInvoiceNumber("2026-0051", text("FRA 2026-00510"))).toBeNull();
    expect(findInvoiceNumber("2026-0051", text("REF 12026-0051"))).toBeNull();
    // Con letras de serie: exacto si las lleva, suelto si el banco se las ha comido.
    expect(findInvoiceNumber("GS2026-0003", text("FRA GS2026-0003"))).toBe("exact");
    expect(findInvoiceNumber("GS2026-0003", text("FRA 2026-0003"))).toBe("loose");
    // La ordinaria no se confunde con la rectificativa de la misma numeración.
    expect(findInvoiceNumber("2026-0003", text("ABONO R2026-0003"))).toBeNull();
    // Un número corto sin letras no se busca.
    expect(findInvoiceNumber("51", text("PAGO 51"))).toBeNull();
  });

  it("encuentra NIF e IBAN aunque vengan con separadores o el prefijo ES", () => {
    expect([...findTaxIds(normalizeText("ORD. B-12345674 PAGO"))]).toEqual(["B12345674"]);
    expect([...findTaxIds(normalizeText("NIF ESB12345674"))]).toEqual(["B12345674"]);
    expect([...findTaxIds(normalizeText("DNI 12345678Z"))]).toEqual(["12345678Z"]);
    expect([...findTaxIds(normalizeText("B12345675"))]).toEqual([]);
    expect([...findIbans(normalizeText("TRASPASO A ES79 2100 0813 6101 2345 6789"))]).toEqual(["ES7921000813610123456789"]);
  });

  it("reconoce un nombre entero, o al menos una palabra distintiva, y las siglas de la TGSS y la AEAT", () => {
    const text = tokenSet("TRANSFERENCIA DE RESTAURANT CAN SORRA SL CONCEPTO FRA 2026-0051");
    expect(matchName("Restaurant Can Sorra", text)).toBe("strong");
    expect(matchName("Restaurant del Port", text)).toBeNull();
    expect(matchName("Adobe Systems Software Ireland", tokenSet("ADOBE *CREATIVE CLD"))).toBe("partial");
    expect(matchName("Tesorería General de la Seguridad Social", tokenSet("RECIBO TGSS REGIMEN ESPECIAL AUTONOMOS"))).toBe("strong");
    expect(tokenSet("PAGO AGENCIA TRIBUTARIA MOD 303").has("AEAT")).toBe(true);
  });

  it("la clave de una regla: las palabras justas para identificar al comercio o a quien paga", () => {
    expect(ruleKey("COMPRA TARJ. 5402XXXXXXXX1234 GOOGLE *ADS8246910 G.CO/HELPPAY#")).toBe("GOOGLE ADS");
    expect(ruleKey("TRANSF DE RESTAURANT CAN SORRA SL FRA 2026-0051")).toBe("RESTAURANT CAN SORRA");
    expect(ruleKey("NETFLIX.COM")).toBe("NETFLIX");
    expect(ruleKey("TRANSFERENCIA 2026-0051")).toBeNull();
    expect(ruleKey("RESTAURANT HOTEL")).toBeNull();
  });
});
