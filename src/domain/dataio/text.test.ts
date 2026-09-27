import { describe, expect, it } from "vitest";
import { cleanText, decodeText, decodeUtf8Strict, decodeWindows1252, encodeUtf8, normalizeKey } from "./text";

const bytes = (...values: number[]) => Uint8Array.from(values);

describe("decodeText", () => {
  it("UTF-8 con BOM (el «CSV UTF-8» de Excel): quita la BOM", () => {
    const decoded = decodeText(bytes(0xef, 0xbb, 0xbf, ...encodeUtf8("Razón social;Año")));
    expect(decoded).toEqual({ text: "Razón social;Año", encoding: "utf-8", bom: true });
  });

  it("UTF-8 sin BOM", () => {
    expect(decodeText(encodeUtf8("Mataró · 1.234,56 €"))).toEqual({ text: "Mataró · 1.234,56 €", encoding: "utf-8", bom: false });
  });

  it("si no es UTF-8 válido, Windows-1252 (el «CSV delimitado por comas» de Excel en español)", () => {
    // "Razón;Año;€ 12" en Windows-1252: ó = F3, ñ = F1, € = 80.
    const cp1252 = bytes(0x52, 0x61, 0x7a, 0xf3, 0x6e, 0x3b, 0x41, 0xf1, 0x6f, 0x3b, 0x80, 0x20, 0x31, 0x32);
    expect(decodeText(cp1252)).toEqual({ text: "Razón;Año;€ 12", encoding: "windows-1252", bom: false });
  });

  it("UTF-16 con BOM (el «Texto Unicode» de Excel)", () => {
    const le = bytes(0xff, 0xfe, 0x4e, 0x00, 0xcd, 0x00, 0x46, 0x00);
    expect(decodeText(le)).toEqual({ text: "NÍF", encoding: "utf-16le", bom: true });
    const be = bytes(0xfe, 0xff, 0x00, 0x4e, 0x00, 0xcd);
    expect(decodeText(be)).toEqual({ text: "NÍ", encoding: "utf-16be", bom: true });
  });

  it("UTF-8 estricto rechaza secuencias truncadas, largas de más y sustitutos", () => {
    expect(decodeUtf8Strict(bytes(0xc3))).toBeNull();
    expect(decodeUtf8Strict(bytes(0xc0, 0xaf))).toBeNull();
    expect(decodeUtf8Strict(bytes(0xe0, 0x80, 0xaf))).toBeNull();
    expect(decodeUtf8Strict(bytes(0xed, 0xa0, 0x80))).toBeNull();
    expect(decodeUtf8Strict(bytes(0xf4, 0x90, 0x80, 0x80))).toBeNull();
    expect(decodeUtf8Strict(bytes(0xf0, 0x9f, 0x98, 0x80))).toBe("😀");
  });

  it("Windows-1252 decodifica las comillas tipográficas y deja los huecos como controles C1", () => {
    expect(decodeWindows1252(bytes(0x93, 0x61, 0x94, 0x81))).toBe("“a”\u0081");
  });
});

describe("normalizeKey y cleanText", () => {
  it("claves de comparación sin acentos, con % y € como palabras", () => {
    expect(normalizeKey("  Nº Factura ")).toBe("n factura");
    expect(normalizeKey("% IVA")).toBe("pct iva");
    expect(normalizeKey("IVA (%)")).toBe("iva pct");
    expect(normalizeKey("Importe (€)")).toBe("importe eur");
    expect(normalizeKey("Razón Social")).toBe("razon social");
    expect(normalizeKey("cliente.nombre")).toBe("cliente nombre");
    expect(normalizeKey("Adreça")).toBe("adreca");
  });

  it("limpia espacios (también los no separables) y recorta", () => {
    expect(cleanText("  Port  Mataró \t SL  ")).toBe("Port Mataró SL");
    expect(cleanText("   ")).toBeNull();
    expect(cleanText("abcdef", 3)).toBe("abc");
  });

  it("encodeUtf8 es la inversa del decodificador", () => {
    const text = "Façana · 21 % · 😀 · €";
    expect(decodeUtf8Strict(encodeUtf8(text))).toBe(text);
  });
});
