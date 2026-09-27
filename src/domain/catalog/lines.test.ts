import { describe, expect, it } from "vitest";
import { computeLine } from "../tax";
import { bundleLines, catalogLineAmounts, catalogTotals, itemLine, resolveVatRateId } from "./lines";
import type { CatalogBundle, CatalogItem, CatalogVatRate } from "./types";

const vat21: CatalogVatRate = { id: "iva21", name: "IVA 21 %", rateBps: 2100, regime: "general", isDefault: true, archived: false };
const exempt: CatalogVatRate = { id: "exento", name: "Exento", rateBps: 0, regime: "exempt", isDefault: false, archived: false };
const archived18: CatalogVatRate = { id: "iva18", name: "IVA 18 %", rateBps: 1800, regime: "general", isDefault: false, archived: true };
const RATES = [vat21, exempt, archived18];

function item(id: string, overrides: Partial<CatalogItem> = {}): CatalogItem {
  return {
    id,
    category: "web",
    name: id,
    description: null,
    translations: {},
    billingType: "one_off",
    unitLabel: null,
    unitPriceCents: 100_000,
    defaultQuantity: "1",
    taxRateId: vat21.id,
    irpfApplies: true,
    isActive: true,
    position: 0,
    ...overrides,
  };
}

function bundle(entries: CatalogBundle["items"], discountBps = 1_000): CatalogBundle {
  return { id: "pack", name: "Pack", description: null, translations: {}, discountBps, isActive: true, position: 0, items: entries };
}

const web = item("web", {
  name: "Web corporativa",
  description: "Hasta 5 páginas.",
  translations: { en: { name: "Corporate website", description: "Up to 5 pages." } },
  unitPriceCents: 180_000,
});
const seo = item("seo", { name: "SEO mensual", category: "seo", billingType: "monthly", unitPriceCents: 45_000 });
const hosting = item("hosting", { name: "Hosting", category: "hosting", billingType: "yearly", unitPriceCents: 18_000 });
const hour = item("hour", { name: "Hora de consultoría", category: "consulting", billingType: "usage", unitPriceCents: 6_000, defaultQuantity: "2.5" });

describe("línea de un servicio", () => {
  it("sale en el idioma del documento, con la cantidad por defecto y sin descuento", () => {
    expect(itemLine(web, "en")).toEqual({
      itemId: "web",
      description: "Corporate website — Up to 5 pages.",
      billingType: "one_off",
      quantity: "1",
      unitPriceCents: 180_000,
      discountBps: 0,
      taxRateId: "iva21",
      irpfApplies: true,
    });
    expect(itemLine(web, "ca").description).toBe("Web corporativa — Hasta 5 páginas.");
    expect(itemLine(hour, "es")).toMatchObject({ billingType: "usage", quantity: "2.5" });
  });

  it("un IVA archivado se cambia por el de por defecto; uno vigente se respeta", () => {
    const old = item("old", { taxRateId: archived18.id });
    expect(itemLine(old, "es", { vatRates: RATES }).taxRateId).toBe("iva21");
    expect(itemLine(old, "es").taxRateId).toBe("iva18");
    expect(itemLine(item("exempt", { taxRateId: exempt.id }), "es", { vatRates: RATES }).taxRateId).toBe("exento");
    // Sin uno por defecto, el primero vigente; sin ninguno vigente, el del servicio.
    expect(resolveVatRateId("iva18", [archived18, { ...exempt }, { ...vat21, isDefault: false }])).toBe("exento");
    expect(resolveVatRateId("iva18", [archived18])).toBe("iva18");
  });
});

describe("líneas de un pack", () => {
  it("salen en su orden, con el descuento del pack en cada una y su cantidad (o la del servicio)", () => {
    const { lines, skipped } = bundleLines(
      bundle([
        { itemId: "seo", quantity: null },
        { itemId: "web", quantity: null },
        { itemId: "hour", quantity: "10" },
      ]),
      [web, seo, hour],
      "en",
    );
    expect(skipped).toEqual([]);
    expect(lines.map((l) => [l.itemId, l.billingType, l.quantity, l.discountBps])).toEqual([
      ["seo", "monthly", "1", 1_000],
      ["web", "one_off", "1", 1_000],
      ["hour", "usage", "10", 1_000],
    ]);
    expect(lines[1]!.description).toBe("Corporate website — Up to 5 pages.");
  });

  it("deja fuera, y los devuelve aparte, los servicios archivados o que ya no están", () => {
    const { lines, skipped } = bundleLines(
      bundle([
        { itemId: "web", quantity: null },
        { itemId: "gone", quantity: null },
        { itemId: "seo", quantity: "2" },
      ]),
      [web, { ...seo, isActive: false }],
      "es",
    );
    expect(lines.map((l) => l.itemId)).toEqual(["web"]);
    expect(skipped).toEqual([
      { itemId: "gone", quantity: null },
      { itemId: "seo", quantity: "2" },
    ]);
  });

  it("el descuento se redondea en cada línea (medio céntimo hacia fuera), como en una factura", () => {
    const thirds = ["a", "b", "c"].map((id) => item(id, { unitPriceCents: 33_333 }));
    const { lines } = bundleLines(bundle(thirds.map((t) => ({ itemId: t.id, quantity: null }))), thirds, "es");
    const bases = lines.map((l) => catalogLineAmounts(l, 2100).baseCents);
    // 10 % de 333,33 € son 33,33 €: cada base, 300,00 €. Sobre el total serían 899,99 €.
    expect(bases).toEqual([30_000, 30_000, 30_000]);
    expect(catalogTotals(lines, RATES).one_off).toMatchObject({ grossCents: 99_999, discountCents: 9_999, baseCents: 90_000 });

    const half = bundleLines(bundle([{ itemId: "x", quantity: null }]), [item("x", { unitPriceCents: 12_345 })], "es").lines[0]!;
    expect(catalogLineAmounts(half, 2100)).toEqual(
      computeLine({ quantity: "1", unitPriceCents: 12_345, discountBps: 1_000, vatBps: 2100, irpfBps: 0, irpfApplies: false }),
    );
    expect(catalogLineAmounts(half, 2100)).toMatchObject({ discountCents: 1_235, baseCents: 11_110, vatCents: 2_333 });
  });

  it("los totales van por tipo: lo puntual, lo mensual, lo anual y lo de uso nunca se suman", () => {
    const { lines } = bundleLines(
      bundle([
        { itemId: "web", quantity: null },
        { itemId: "seo", quantity: null },
        { itemId: "hosting", quantity: null },
        { itemId: "hour", quantity: "1" },
      ]),
      [web, seo, { ...hosting, taxRateId: exempt.id }, hour],
      "es",
    );
    const totals = catalogTotals(lines, RATES);
    expect(Object.keys(totals)).toEqual(["one_off", "monthly", "yearly", "usage"]);
    expect(totals.one_off).toEqual({ grossCents: 180_000, discountCents: 18_000, baseCents: 162_000, vatCents: 34_020, totalCents: 196_020, lines: 1 });
    expect(totals.monthly).toMatchObject({ baseCents: 40_500, vatCents: 8_505, totalCents: 49_005 });
    // Exento: sin IVA.
    expect(totals.yearly).toMatchObject({ baseCents: 16_200, vatCents: 0, totalCents: 16_200 });
    expect(totals.usage).toMatchObject({ baseCents: 5_400, lines: 1 });
    expect(catalogTotals([], RATES)).toEqual({});
  });
});
