import { describe, expect, it } from "vitest";
import { formatInvoiceNumber, isValidSeriesFormat } from "./number-format";

describe("formatInvoiceNumber", () => {
  it("reproduce el formato de la app de facturas (YYYY-NNNN)", () => {
    expect(formatInvoiceNumber("{yyyy}-{n:4}", 2026, 38)).toBe("2026-0038");
  });

  it("admite prefijo, año corto y número sin relleno", () => {
    expect(formatInvoiceNumber("R{yy}/{n}", 2027, 7)).toBe("R27/7");
  });

  it("no recorta números más largos que el relleno", () => {
    expect(formatInvoiceNumber("{yyyy}-{n:2}", 2026, 1234)).toBe("2026-1234");
  });

  it("rechaza números no positivos y años fuera de rango", () => {
    expect(() => formatInvoiceNumber("{yyyy}-{n:4}", 2026, 0)).toThrow();
    expect(() => formatInvoiceNumber("{yyyy}-{n:4}", 1999, 1)).toThrow();
  });
});

describe("isValidSeriesFormat", () => {
  it("exige el número, y el año si la serie se reinicia cada año", () => {
    expect(isValidSeriesFormat("{yyyy}-{n:4}", true)).toBe(true);
    expect(isValidSeriesFormat("F-{n:5}", true)).toBe(false);
    expect(isValidSeriesFormat("F-{n:5}", false)).toBe(true);
    expect(isValidSeriesFormat("{yyyy}", false)).toBe(false);
  });
});
