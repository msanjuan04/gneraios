import { describe, expect, it } from "vitest";
import { pricingKind } from "./pricing";
import { STARTER_BUNDLES, STARTER_ITEMS, starterPositions } from "./starter";
import { catalogTextError, lineDescription, localizedTexts, translationsError } from "./text";
import { CATALOG_LIMITS, CATALOG_LOCALES } from "./types";

describe("catálogo de ejemplo", () => {
  it("son los once servicios de una agencia, sin repetir nombre ni clave", () => {
    expect(STARTER_ITEMS.map((i) => i.name)).toEqual([
      "Web corporativa",
      "Tienda online",
      "Landing page",
      "SEO mensual",
      "Auditoría SEO",
      "Gestión Google Ads (mensual)",
      "Gestión Meta Ads (mensual)",
      "Branding",
      "Mantenimiento web (mensual)",
      "Hosting (anual)",
      "Hora de consultoría",
    ]);
    expect(new Set(STARTER_ITEMS.map((i) => i.key)).size).toBe(STARTER_ITEMS.length);
    expect(STARTER_ITEMS.find((i) => i.key === "hosting-anual")?.billingType).toBe("yearly");
    expect(STARTER_ITEMS.find((i) => i.key === "hora-consultoria")?.billingType).toBe("usage");
    expect(STARTER_ITEMS.filter((i) => pricingKind(i.billingType) === "recurring").map((i) => i.key)).toEqual([
      "seo-mensual",
      "google-ads",
      "meta-ads",
      "mantenimiento-web",
      "hosting-anual",
    ]);
  });

  it("todos sus textos y traducciones valen para la base de datos y caben en una línea", () => {
    for (const source of [...STARTER_ITEMS, ...STARTER_BUNDLES]) {
      expect(catalogTextError(source.name, CATALOG_LIMITS.name), source.name).toBeNull();
      if (source.description) expect(catalogTextError(source.description, CATALOG_LIMITS.description), source.name).toBeNull();
      expect(translationsError(source.translations), source.name).toBeNull();
      for (const locale of CATALOG_LOCALES) {
        expect(lineDescription(localizedTexts(source, locale)).length).toBeLessThanOrEqual(500);
      }
    }
    for (const item of STARTER_ITEMS) {
      if (item.unitLabel) expect(catalogTextError(item.unitLabel, CATALOG_LIMITS.unitLabel)).toBeNull();
      expect(item.unitPriceCents).toBeGreaterThan(0);
    }
  });

  it("los packs apuntan a servicios del ejemplo, sin repetirlos", () => {
    const keys = new Set(STARTER_ITEMS.map((i) => i.key));
    expect(STARTER_BUNDLES.map((b) => b.name)).toEqual(["Pack Lanzamiento", "Pack Crecimiento"]);
    for (const bundle of STARTER_BUNDLES) {
      expect(bundle.items.every((entry) => keys.has(entry.key)), bundle.name).toBe(true);
      expect(new Set(bundle.items.map((entry) => entry.key)).size).toBe(bundle.items.length);
      expect(bundle.discountBps).toBeGreaterThan(0);
    }
  });

  it("cada servicio va detrás de los de su categoría", () => {
    const positions = starterPositions();
    expect(positions.get("web-corporativa")).toBe(0);
    expect(positions.get("tienda-online")).toBe(1);
    expect(positions.get("landing-page")).toBe(2);
    expect(positions.get("seo-mensual")).toBe(0);
    expect(positions.get("auditoria-seo")).toBe(1);
    expect(positions.get("hora-consultoria")).toBe(0);
  });
});
