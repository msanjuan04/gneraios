import { describe, expect, it } from "vitest";
import { seriesCodeFromFormat } from "./series-code";

describe("seriesCodeFromFormat", () => {
  it("toma lo que no es año ni número", () => {
    expect(seriesCodeFromFormat("{yyyy}-BRK-{n:3}")).toBe("BRK");
    expect(seriesCodeFromFormat("MS-{yyyy}/{n:3}")).toBe("MS");
    expect(seriesCodeFromFormat("F{yy}/{n}")).toBe("F");
    expect(seriesCodeFromFormat("GN-{yyyy}-A/{n:4}")).toBe("GN-A");
    expect(seriesCodeFromFormat("fact.{n}")).toBe("FACT");
  });

  it("sin letras propias es «H» (histórico) y nunca pasa de 12", () => {
    expect(seriesCodeFromFormat("{yyyy}-{n:4}")).toBe("H");
    expect(seriesCodeFromFormat("{yyyy}-FACTURACION-ANTIGUA-{n:3}")).toBe("FACTURACION");
    expect(seriesCodeFromFormat("{yyyy}-FACTURACION-ANTIGUA-{n:3}")).toMatch(/^[A-Z0-9-]{1,12}$/);
  });

  it("si el código ya está cogido, le añade un número", () => {
    expect(seriesCodeFromFormat("{yyyy}-{n:4}", ["F", "R", "H"])).toBe("H-2");
    expect(seriesCodeFromFormat("{yyyy}-BRK-{n:3}", ["brk", "BRK-2"])).toBe("BRK-3");
  });

  it("quita acentos", () => {
    expect(seriesCodeFromFormat("{yyyy}-DISEÑO-{n}")).toBe("DISENO");
  });
});
