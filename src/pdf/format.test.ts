import { describe, expect, it } from "vitest";
import caCatalog from "@/i18n/messages/ca/pdf.json";
import enCatalog from "@/i18n/messages/en/pdf.json";
import esCatalog from "@/i18n/messages/es/pdf.json";
import { formatPdfDate, formatPeriod, formatQuantity, intlLocale, pdfText, postalLine } from "./format";
import { countryName, getPdfLabels, interpolate } from "./labels";

type Catalog = { [key: string]: string | Catalog };

function keys(catalog: Catalog, prefix = ""): string[] {
  return Object.entries(catalog)
    .flatMap(([key, value]) => (typeof value === "string" ? [prefix + key] : keys(value, `${prefix}${key}.`)))
    .sort();
}

const EU = "AT BE BG CY CZ DE DK EE ES FI FR GR HR HU IE IT LT LU LV MT NL PL PT RO SE SI SK".split(" ");

describe("catálogos del PDF", () => {
  it("ca y en tienen exactamente las mismas claves que es", () => {
    const es = keys(esCatalog);
    expect(keys(caCatalog)).toEqual(es);
    expect(keys(enCatalog)).toEqual(es);
  });

  it("traen los países de la UE, GB, US, CH y AD en los tres idiomas", () => {
    for (const catalog of [esCatalog, caCatalog, enCatalog]) {
      const countries: Record<string, string> = catalog.pdf.countries;
      for (const code of [...EU, "GB", "US", "CH", "AD"]) expect(countries[code], code).toBeTruthy();
    }
  });

  it("ningún texto usa sintaxis ICU que interpolate no entienda", () => {
    for (const catalog of [esCatalog, caCatalog, enCatalog]) {
      const json = JSON.stringify(catalog);
      expect(json).not.toMatch(/\{\w+,/); // sin plural/select
    }
  });
});

describe("getPdfLabels", () => {
  it("devuelve el idioma pedido", () => {
    expect(getPdfLabels("es").document.rectifying).toBe("Factura rectificativa");
    expect(getPdfLabels("ca").document.draft).toBe("Esborrany");
    expect(getPdfLabels("en").totals.total).toBe("Total due");
  });
});

describe("interpolate", () => {
  it("sustituye los argumentos y deja intactos los desconocidos", () => {
    expect(interpolate("Página {current} / {total}", { current: 1, total: 3 })).toBe("Página 1 / 3");
    expect(interpolate("IVA {rate} {x}", { rate: "21 %" })).toBe("IVA 21 % {x}");
  });
});

describe("countryName", () => {
  it("traduce desde el catálogo", () => {
    expect(countryName("FR", "es")).toBe("Francia");
    expect(countryName("fr", "ca")).toBe("França");
    expect(countryName(" FR ", "en")).toBe("France");
  });

  it("cae a Intl.DisplayNames y, si el código no vale, al propio código", () => {
    expect(countryName("JP", "es")).toBe("Japón");
    expect(countryName("1", "en")).toBe("1");
  });
});

describe("formato", () => {
  it("usa es-ES, ca-ES y en-IE", () => {
    expect(intlLocale("es")).toBe("es-ES");
    expect(intlLocale("ca")).toBe("ca-ES");
    expect(intlLocale("en")).toBe("en-IE");
  });

  it("fechas en DD/MM/YYYY y periodos con raya", () => {
    expect(formatPdfDate("2026-10-01")).toBe("01/10/2026");
    expect(formatPeriod("2026-10-01", "2026-10-31")).toBe("01/10/2026 – 31/10/2026");
    expect(formatPeriod(null, "2026-10-31")).toBe("31/10/2026");
    expect(formatPeriod(null, null)).toBeNull();
    expect(() => formatPdfDate("2026-02-30")).toThrow();
  });

  it("cantidades con hasta 3 decimales en el idioma del documento", () => {
    expect(formatQuantity("1.000", "es")).toBe("1");
    expect(formatQuantity("3.500", "es")).toBe("3,5");
    expect(formatQuantity("1234.125", "ca")).toBe("1.234,125");
    expect(formatQuantity("1234.125", "en")).toBe("1,234.125");
    expect(formatQuantity("-2", "es")).toBe("-2");
    expect(formatQuantity("n/a", "es")).toBe("n/a");
  });

  it("dirección postal con la provincia entre paréntesis si no es la población", () => {
    const base = { legalName: "X", countryCode: "ES" };
    expect(postalLine({ ...base, postalCode: "08301", city: "Mataró", province: "Barcelona" })).toBe(
      "08301 Mataró (Barcelona)",
    );
    expect(postalLine({ ...base, postalCode: "08001", city: "Barcelona", province: "Barcelona" })).toBe(
      "08001 Barcelona",
    );
    expect(postalLine({ ...base, province: "Girona" })).toBe("Girona");
    expect(postalLine(base)).toBeNull();
  });

  it("pdfText compone los acentos y quita lo que Manrope no trae", () => {
    expect(pdfText("Mataró")).toBe("Mataró");
    expect(pdfText("1 000")).toBe("1 000");
    expect(pdfText("B‑00")).toBe("B-00");
  });
});
