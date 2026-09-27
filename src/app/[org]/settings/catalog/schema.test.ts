import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { translationsError } from "@/domain/catalog";
import {
  bundleFormDefaults,
  catalogBundleFormSchema,
  catalogItemFormSchema,
  itemFormDefaults,
  toBundlePayload,
  toItemValues,
} from "./schema";

const VAT = randomUUID();

function itemInput(overrides: Partial<ReturnType<typeof itemFormDefaults>> = {}) {
  return {
    ...itemFormDefaults(null, { vatRateId: VAT }),
    name: "  Web \n corporativa ",
    description: "Hasta 5 páginas,\nadaptada a móvil.",
    unit_price: "1.800,50",
    default_quantity: "2,5",
    unit_label: "proyecto",
    translations: { ca: { name: "", description: " Fins a 5 pàgines. " }, en: { name: "Corporate website", description: "" } },
    ...overrides,
  };
}

describe("formulario de servicio", () => {
  it("normaliza los textos, lee importes y cantidades a la española y guarda solo lo traducido", () => {
    const parsed = catalogItemFormSchema.parse(itemInput());
    const values = toItemValues(parsed);
    expect(values).toEqual({
      category: "web",
      name: "Web corporativa",
      description: "Hasta 5 páginas, adaptada a móvil.",
      translations: { ca: { description: "Fins a 5 pàgines." }, en: { name: "Corporate website" } },
      billing_type: "one_off",
      unit_label: "proyecto",
      unit_price_cents: 180_050,
      default_quantity: "2.5",
      tax_rate_id: VAT,
      irpf_applies: true,
    });
    expect(translationsError(values.translations)).toBeNull();
  });

  it("una recurrente no guarda unidad: su precio ya es por mes o por año", () => {
    expect(toItemValues(catalogItemFormSchema.parse(itemInput({ billing_type: "monthly" }))).unit_label).toBeNull();
    expect(toItemValues(catalogItemFormSchema.parse(itemInput({ billing_type: "usage", unit_label: "hora" }))).unit_label).toBe("hora");
  });

  it("rechaza lo que no se entiende, con los mensajes del catálogo", () => {
    const issues = (input: Record<string, unknown>) =>
      catalogItemFormSchema.safeParse({ ...itemInput(), ...input }).error?.issues.map((i) => [i.path.join("."), i.message]) ?? [];
    expect(issues({ name: "   " })).toEqual([["name", "required"]]);
    expect(issues({ unit_price: "" })).toEqual([["unit_price", "required"]]);
    expect(issues({ unit_price: "-5" })).toEqual([["unit_price", "money"]]);
    expect(issues({ unit_price: "12,345" })).toEqual([["unit_price", "money"]]);
    expect(issues({ default_quantity: "0" })).toEqual([["default_quantity", "quantity"]]);
    expect(issues({ tax_rate_id: "" })).toEqual([["tax_rate_id", "vatRate"]]);
    expect(issues({ name: "x".repeat(121) })).toEqual([["name", "tooLong"]]);
    expect(issues({ translations: { ca: { name: "x".repeat(121), description: "" }, en: { name: "", description: "" } } })).toEqual([
      ["translations.ca.name", "tooLong"],
    ]);
  });

  it("un servicio guardado vuelve al formulario tal y como se escribe", () => {
    const defaults = itemFormDefaults(
      {
        id: randomUUID(),
        category: "consulting",
        name: "Hora de consultoría",
        description: null,
        translations: { en: { name: "Consulting hour" } },
        billingType: "usage",
        unitLabel: "hora",
        unitPriceCents: 6_050,
        defaultQuantity: "1.5",
        taxRateId: VAT,
        irpfApplies: false,
        isActive: true,
        position: 3,
      },
      { vatRateId: null },
    );
    expect(defaults).toMatchObject({
      unit_price: "60,50",
      default_quantity: "1,5",
      description: "",
      translations: { ca: { name: "", description: "" }, en: { name: "Consulting hour", description: "" } },
    });
    expect(toItemValues(catalogItemFormSchema.parse(defaults))).toMatchObject({ unit_price_cents: 6_050, default_quantity: "1.5", irpf_applies: false });
  });
});

describe("formulario de pack", () => {
  const web = randomUUID();
  const seo = randomUUID();
  const input = {
    ...bundleFormDefaults(null),
    name: "Pack Lanzamiento",
    discount: "12,5",
    items: [
      { item_id: web, quantity: "" },
      { item_id: seo, quantity: "2" },
    ],
  };

  it("pasa al JSON de save_catalog_bundle: descuento en puntos básicos y la cantidad vacía es la del servicio", () => {
    const payload = toBundlePayload(catalogBundleFormSchema.parse(input), { bundleId: null, orgId: "org" });
    expect(payload).toEqual({
      bundle_id: null,
      org_id: "org",
      name: "Pack Lanzamiento",
      description: null,
      translations: {},
      discount_bps: 1_250,
      items: [
        { item_id: web, quantity: null },
        { item_id: seo, quantity: "2" },
      ],
    });
  });

  it("lleva al menos un servicio y no los repite", () => {
    const messages = (patch: Record<string, unknown>) =>
      catalogBundleFormSchema.safeParse({ ...input, ...patch }).error?.issues.map((i) => i.message) ?? [];
    expect(messages({ items: [] })).toEqual(["bundleEmpty"]);
    expect(messages({ items: [{ item_id: web, quantity: "" }, { item_id: web, quantity: "3" }] })).toEqual(["bundleRepeated"]);
    expect(messages({ discount: "120" })).toEqual(["discount"]);
    expect(messages({ items: [{ item_id: web, quantity: "0" }] })).toEqual(["quantity"]);
  });
});
