import { describe, expect, it } from "vitest";
import {
  creditorIdCheckDigits,
  formatCreditorId,
  normalizeBic,
  normalizeCreditorId,
  parseCreditorId,
  proposeSpanishCreditorId,
  validateBic,
  validateCreditorId,
} from "./creditor-id";

/**
 * Recalcula MOD 97-10 de forma independiente (con BigInt sobre la cadena completa, sin trocear):
 * identificador nacional + país + dígitos de control, letras → 10-35. Válido si el resto es 1.
 */
function independentMod97(creditorId: string): bigint {
  const national = creditorId.slice(7);
  const digits = [...`${national}${creditorId.slice(0, 2)}${creditorId.slice(2, 4)}`]
    .map((ch) => (/[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch))
    .join("");
  return BigInt(digits) % BigInt(97);
}

describe("identificador de acreedor (ICS)", () => {
  it("valida los ejemplos publicados del EPC y del Bundesbank", () => {
    // Bundesbank (identificador de pruebas), Italia y Francia: ejemplos de la documentación del EPC.
    for (const id of ["DE98ZZZ09999999999", "IT66ZZZA1B2C3D4E5F6G7H8", "FR72ZZZ123456"]) {
      expect(validateCreditorId(id), id).toBe(true);
      expect(independentMod97(id), id).toBe(BigInt(1));
    }
    expect(creditorIdCheckDigits("DE", "09999999999")).toBe("98");
  });

  it("propone el ICS español a partir del NIF: ES + control + 000 + NIF", () => {
    // CIF (sociedad) y DNI (autónomo) sintéticos con su carácter de control correcto.
    expect(proposeSpanishCreditorId("B12345674")).toBe("ES11000B12345674");
    expect(proposeSpanishCreditorId("12345678Z")).toBe("ES5800012345678Z");
    for (const id of ["ES11000B12345674", "ES5800012345678Z"]) {
      expect(validateCreditorId(id), id).toBe(true);
      expect(independentMod97(id), id).toBe(BigInt(1));
    }
  });

  it("el código comercial (sufijo) no entra en los dígitos de control", () => {
    expect(proposeSpanishCreditorId("B12345674", "001")).toBe("ES11001B12345674");
    expect(proposeSpanishCreditorId("b-12345674", "a1z")).toBe("ES11A1ZB12345674");
    expect(validateCreditorId("ES11A1ZB12345674")).toBe(true);
  });

  it("no propone nada con un NIF o un sufijo no válidos", () => {
    expect(proposeSpanishCreditorId("B12345675")).toBeNull();
    expect(proposeSpanishCreditorId("")).toBeNull();
    expect(proposeSpanishCreditorId("B12345674", "00")).toBeNull();
    expect(proposeSpanishCreditorId("B12345674", "0-0")).toBeNull();
  });

  it("normaliza y rechaza dígitos de control, estructuras y longitudes españolas incorrectas", () => {
    expect(normalizeCreditorId(" es11 000-b12345674 ")).toBe("ES11000B12345674");
    expect(validateCreditorId("es11 000 b12345674")).toBe(true);
    expect(validateCreditorId("ES12000B12345674")).toBe(false);
    expect(validateCreditorId("ES11000B1234567")).toBe(false);
    expect(validateCreditorId("ESXX000B12345674")).toBe(false);
    expect(validateCreditorId("")).toBe(false);
  });

  it("separa y formatea sus partes", () => {
    expect(parseCreditorId("ES11000B12345674")).toEqual({
      countryCode: "ES",
      checkDigits: "11",
      businessCode: "000",
      nationalId: "B12345674",
    });
    expect(formatCreditorId("ES11000B12345674")).toBe("ES11 000 B12345674");
  });
});

describe("BIC", () => {
  it("acepta 8 u 11 caracteres con país en letras", () => {
    expect(validateBic("CAIXESBBXXX")).toBe(true);
    expect(validateBic("caix es bb")).toBe(true);
    expect(normalizeBic("caix es bb")).toBe("CAIXESBB");
    expect(validateBic("CAIX1SBBXXX")).toBe(false);
    expect(validateBic("CAIXESB")).toBe(false);
    expect(validateBic("CAIXESBBXX")).toBe(false);
  });
});
