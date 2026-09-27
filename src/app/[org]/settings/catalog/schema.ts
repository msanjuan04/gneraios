import { z } from "zod";
import {
  buildTranslations,
  CATALOG_BILLING_TYPES,
  CATALOG_CATEGORIES,
  CATALOG_LIMITS,
  type CatalogBillingType,
  type CatalogBundle,
  type CatalogCategory,
  type CatalogItem,
  type CatalogTranslations,
  centsToInput,
  discountToInput,
  normalizeCatalogText,
  parseDiscountInput,
  parseQuantityInput,
  pricingKind,
  quantityToInput,
  TRANSLATED_LOCALES,
} from "@/domain/catalog";
import { parseMoneyInput } from "@/domain/money";

/**
 * Formularios del catálogo (servicio y pack), compartidos por los paneles (cliente) y las acciones
 * (servidor). Todo llega como texto, escrito a la española, y se convierte aquí a céntimos, puntos
 * básicos y cantidades. Los textos se normalizan (un espacio entre palabras, sin saltos de línea):
 * acaban en la descripción de una línea. Los mensajes son claves de `catalog.validation.*` o, si
 * no están ahí, de `validation.*`.
 */

/** Texto normalizado de hasta `max` caracteres (vacío vale: los obligatorios lo exigen aparte). */
const catalogText = (max: number) => z.string().transform(normalizeCatalogText).pipe(z.string().max(max, "tooLong"));
const requiredCatalogText = (max: number) => catalogText(max).pipe(z.string().min(1, "required"));

const translationFields = z.object({
  name: catalogText(CATALOG_LIMITS.name),
  description: catalogText(CATALOG_LIMITS.description),
});
const translationsSchema = z.object({ ca: translationFields, en: translationFields });

export type TranslationsFormInput = z.input<typeof translationsSchema>;

function translationsDefaults(translations: CatalogTranslations = {}): TranslationsFormInput {
  const out = {} as TranslationsFormInput;
  for (const locale of TRANSLATED_LOCALES) {
    out[locale] = { name: translations[locale]?.name ?? "", description: translations[locale]?.description ?? "" };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Servicio
// ---------------------------------------------------------------------------

export const catalogItemFormSchema = z.object({
  category: z.enum(CATALOG_CATEGORIES),
  name: requiredCatalogText(CATALOG_LIMITS.name),
  description: catalogText(CATALOG_LIMITS.description),
  billing_type: z.enum(CATALOG_BILLING_TYPES),
  unit_label: catalogText(CATALOG_LIMITS.unitLabel),
  unit_price: z.string().superRefine((value, ctx) => {
    if (value.trim() === "") ctx.addIssue({ code: "custom", message: "required" });
    else if ((parseMoneyInput(value) ?? -1) < 0) ctx.addIssue({ code: "custom", message: "money" });
  }),
  default_quantity: z.string().refine((value) => parseQuantityInput(value) !== null, "quantity"),
  tax_rate_id: z.guid("vatRate"),
  irpf_applies: z.boolean(),
  translations: translationsSchema,
});

export type CatalogItemFormInput = z.input<typeof catalogItemFormSchema>;
export type CatalogItemFormValues = z.output<typeof catalogItemFormSchema>;

/** Lo que se guarda de un servicio (catalog_items), ya validado. */
export type CatalogItemValues = {
  category: CatalogCategory;
  name: string;
  description: string | null;
  translations: CatalogTranslations;
  billing_type: CatalogBillingType;
  unit_label: string | null;
  unit_price_cents: number;
  /** Texto con punto decimal ("2.5"). */
  default_quantity: string;
  tax_rate_id: string;
  irpf_applies: boolean;
};

function valid<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Formulario sin validar");
  return value;
}

/** Valores validados → fila. Una recurrente no lleva unidad: su precio ya es por mes o por año. */
export function toItemValues(values: CatalogItemFormValues): CatalogItemValues {
  return {
    category: values.category,
    name: values.name,
    description: values.description || null,
    translations: buildTranslations(values.translations),
    billing_type: values.billing_type,
    unit_label: pricingKind(values.billing_type) === "recurring" ? null : values.unit_label || null,
    unit_price_cents: valid(parseMoneyInput(values.unit_price)),
    default_quantity: valid(parseQuantityInput(values.default_quantity)),
    tax_rate_id: values.tax_rate_id,
    irpf_applies: values.irpf_applies,
  };
}

/** Un servicio guardado (o uno nuevo, con el IVA por defecto) → formulario. */
export function itemFormDefaults(
  item: CatalogItem | null,
  defaults: { vatRateId: string | null; category?: CatalogCategory; billingType?: CatalogBillingType },
): CatalogItemFormInput {
  if (!item) {
    return {
      category: defaults.category ?? "web",
      name: "",
      description: "",
      billing_type: defaults.billingType ?? "one_off",
      unit_label: "",
      unit_price: "",
      default_quantity: "1",
      tax_rate_id: defaults.vatRateId ?? "",
      irpf_applies: true,
      translations: translationsDefaults(),
    };
  }
  return {
    category: item.category,
    name: item.name,
    description: item.description ?? "",
    billing_type: item.billingType,
    unit_label: item.unitLabel ?? "",
    unit_price: centsToInput(item.unitPriceCents),
    default_quantity: quantityToInput(item.defaultQuantity),
    tax_rate_id: item.taxRateId,
    irpf_applies: item.irpfApplies,
    translations: translationsDefaults(item.translations),
  };
}

// ---------------------------------------------------------------------------
// Pack
// ---------------------------------------------------------------------------

const bundleEntrySchema = z.object({
  item_id: z.guid(),
  /** Vacía: la cantidad por defecto del servicio. */
  quantity: z.string().refine((value) => value.trim() === "" || parseQuantityInput(value) !== null, "quantity"),
});

export const catalogBundleFormSchema = z.object({
  name: requiredCatalogText(CATALOG_LIMITS.name),
  description: catalogText(CATALOG_LIMITS.description),
  /** En porcentaje ("10", "12,5"); vacío es sin descuento. */
  discount: z.string().refine((value) => parseDiscountInput(value) !== null, "discount"),
  translations: translationsSchema,
  items: z
    .array(bundleEntrySchema)
    .min(1, "bundleEmpty")
    .max(CATALOG_LIMITS.bundleItems, "bundleTooMany")
    .refine((items) => new Set(items.map((entry) => entry.item_id)).size === items.length, "bundleRepeated"),
});

export type CatalogBundleFormInput = z.input<typeof catalogBundleFormSchema>;
export type CatalogBundleFormValues = z.output<typeof catalogBundleFormSchema>;

/** JSON de save_catalog_bundle. */
export type SaveBundlePayload = {
  bundle_id: string | null;
  org_id: string;
  name: string;
  description: string | null;
  translations: CatalogTranslations;
  discount_bps: number;
  items: { item_id: string; quantity: string | null }[];
};

export function toBundlePayload(values: CatalogBundleFormValues, opts: { bundleId: string | null; orgId: string }): SaveBundlePayload {
  return {
    bundle_id: opts.bundleId,
    org_id: opts.orgId,
    name: values.name,
    description: values.description || null,
    translations: buildTranslations(values.translations),
    discount_bps: valid(parseDiscountInput(values.discount)),
    items: values.items.map((entry) => ({
      item_id: entry.item_id,
      quantity: entry.quantity.trim() === "" ? null : valid(parseQuantityInput(entry.quantity)),
    })),
  };
}

export function bundleFormDefaults(bundle: CatalogBundle | null): CatalogBundleFormInput {
  return {
    name: bundle?.name ?? "",
    description: bundle?.description ?? "",
    discount: bundle ? discountToInput(bundle.discountBps) : "",
    translations: translationsDefaults(bundle?.translations),
    items: (bundle?.items ?? []).map((entry) => ({
      item_id: entry.itemId,
      quantity: entry.quantity === null ? "" : quantityToInput(entry.quantity),
    })),
  };
}
