import { describe, expect, it } from "vitest";
import {
  buildTranslations,
  catalogTextError,
  isTranslated,
  lineDescription,
  localizedTexts,
  normalizeCatalogText,
  readTranslations,
  translationsError,
} from "./text";
import type { CatalogTexts } from "./types";

const web: CatalogTexts = {
  name: "Web corporativa",
  description: "Diseño y desarrollo de una web de hasta 5 páginas.",
  translations: {
    ca: { description: "Disseny i desenvolupament d'un web de fins a 5 pàgines." },
    en: { name: "Corporate website", description: "Design and development of a website of up to 5 pages." },
  },
};

describe("textos del catálogo", () => {
  it("normaliza espacios y saltos de línea a un solo espacio", () => {
    expect(normalizeCatalogText("  Web\n corporativa\t\t(5 páginas)  ")).toBe("Web corporativa (5 páginas)");
    expect(normalizeCatalogText(" \n ")).toBe("");
  });

  it("valida como la base de datos: longitud por caracteres, sin espacios en los extremos ni caracteres de control", () => {
    expect(catalogTextError("SEO mensual", 120)).toBeNull();
    expect(catalogTextError("", 120)).toBe("required");
    expect(catalogTextError("x".repeat(121), 120)).toBe("tooLong");
    // Un emoji es un carácter para char_length, aunque sean dos unidades UTF-16.
    expect(catalogTextError(`${"x".repeat(119)}🚀`, 120)).toBeNull();
    expect(catalogTextError(" SEO", 120)).toBe("invalid");
    expect(catalogTextError("SEO ", 120)).toBe("invalid");
    expect(catalogTextError("SEO\nmensual", 120)).toBe("invalid");
    expect(catalogTextError("SEO\u0085mensual", 120)).toBe("invalid");
  });
});

describe("traducciones", () => {
  it("valen un objeto con ca y en, cada uno con nombre y/o descripción", () => {
    expect(translationsError({})).toBeNull();
    expect(translationsError(web.translations)).toBeNull();
    expect(translationsError({ ca: { name: "Botiga en línia" } })).toBeNull();
  });

  it.each([
    ["no es un objeto", []],
    ["null", null],
    ["un idioma que no se traduce", { es: { name: "Web" } }],
    ["un idioma desconocido", { fr: { name: "Site web" } }],
    ["un idioma vacío", { ca: {} }],
    ["un idioma que no es un objeto", { ca: "Web corporativa" }],
    ["un campo desconocido", { en: { title: "Website" } }],
    ["un texto vacío", { en: { name: "" } }],
    ["un texto con espacios en los extremos", { en: { name: " Website" } }],
    ["un texto que no es texto", { en: { name: 12 } }],
    ["un nombre demasiado largo", { en: { name: "x".repeat(121) } }],
    ["una descripción demasiado larga", { en: { description: "x".repeat(376) } }],
  ])("no valen con %s", (_, value) => {
    expect(translationsError(value)).toBe("invalid");
  });

  it("se construyen desde el formulario normalizadas y sin vacíos", () => {
    expect(
      buildTranslations({
        ca: { name: "  ", description: " Disseny\n i desenvolupament " },
        en: { name: "", description: "" },
      }),
    ).toEqual({ ca: { description: "Disseny i desenvolupament" } });
    expect(translationsError(buildTranslations({ ca: { name: " x " }, en: { description: "y" } }))).toBeNull();
  });

  it("se leen de la base de datos descartando lo que no tiene forma", () => {
    expect(readTranslations({ ca: { name: "Botiga", extra: 1 }, en: { name: "" }, fr: { name: "x" } })).toEqual({ ca: { name: "Botiga" } });
    expect(readTranslations("nope")).toEqual({});
  });
});

describe("texto en el idioma del documento", () => {
  it("cada campo sale traducido o, si falta, en castellano", () => {
    expect(localizedTexts(web, "es")).toEqual({ name: "Web corporativa", description: web.description });
    expect(localizedTexts(web, "en")).toEqual({ name: "Corporate website", description: "Design and development of a website of up to 5 pages." });
    // Sin nombre en catalán: el castellano; la descripción, la catalana.
    expect(localizedTexts(web, "ca")).toEqual({ name: "Web corporativa", description: "Disseny i desenvolupament d'un web de fins a 5 pàgines." });
    expect(localizedTexts({ ...web, translations: {} }, "ca")).toEqual({ name: "Web corporativa", description: web.description });
    expect(isTranslated(web, "ca")).toBe(true);
    expect(isTranslated({ ...web, translations: {} }, "en")).toBe(false);
  });

  it("la línea es «nombre — descripción», o solo el nombre", () => {
    expect(lineDescription({ name: "SEO mensual", description: "Contenidos e informe mensual." })).toBe("SEO mensual — Contenidos e informe mensual.");
    expect(lineDescription({ name: "Branding", description: null })).toBe("Branding");
    expect(lineDescription({ name: "Branding", description: "  " })).toBe("Branding");
    // Con los límites del catálogo, siempre cabe en los 500 caracteres de una línea.
    expect(lineDescription({ name: "x".repeat(120), description: "y".repeat(375) }).length).toBeLessThanOrEqual(500);
  });
});
