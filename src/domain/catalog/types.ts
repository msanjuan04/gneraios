// Catálogo de servicios (supabase/migrations/…_catalogo.sql): los servicios que se presupuestan una
// y otra vez, con su precio base, y packs de servicios con descuento. Tipos del dominio, sin I/O:
// dinero en céntimos, porcentajes en puntos básicos y cantidades en texto (numeric(12,3)).

import type { Bps, Cents } from "../money";
import type { VatRegime } from "../tax";

/** En el orden en que se listan. Mismos valores que el enum `catalog_category`. */
export const CATALOG_CATEGORIES = [
  "web",
  "seo",
  "ads",
  "branding",
  "social",
  "hosting",
  "maintenance",
  "consulting",
  "other",
] as const;
export type CatalogCategory = (typeof CATALOG_CATEGORIES)[number];

/**
 * El mismo enum (`billing_type`) que las líneas de presupuesto, contrato y factura, en el orden en
 * que los agrupa un presupuesto: puntual, mensual, anual y por uso.
 */
export const CATALOG_BILLING_TYPES = ["one_off", "monthly", "yearly", "usage"] as const;
export type CatalogBillingType = (typeof CATALOG_BILLING_TYPES)[number];

/** Idiomas de los documentos (`app_locale`). El castellano es el texto de la fila; el resto, traducciones. */
export const CATALOG_LOCALES = ["es", "ca", "en"] as const;
export type CatalogLocale = (typeof CATALOG_LOCALES)[number];

export const TRANSLATED_LOCALES = ["ca", "en"] as const;
export type TranslatedLocale = (typeof TRANSLATED_LOCALES)[number];

/** Lo traducido de un idioma: lo que falta sale en castellano. */
export type CatalogTranslation = { name?: string; description?: string };
export type CatalogTranslations = Partial<Record<TranslatedLocale, CatalogTranslation>>;

/** Lo que tiene nombre y descripción traducibles: un servicio o un pack. */
export type CatalogTexts = {
  name: string;
  description: string | null;
  translations: CatalogTranslations;
};

export type CatalogItem = CatalogTexts & {
  id: string;
  category: CatalogCategory;
  billingType: CatalogBillingType;
  /** "hora", "campaña", "página": acompaña al precio; las líneas no tienen unidad. */
  unitLabel: string | null;
  /** Sin IVA: el de una unidad (un ciclo en las recurrentes, un uso en las de uso). */
  unitPriceCents: Cents;
  /** numeric(12,3) en texto, con punto decimal: "1", "2.5". */
  defaultQuantity: string;
  taxRateId: string;
  irpfApplies: boolean;
  isActive: boolean;
  /** Orden dentro de su categoría. */
  position: number;
};

export type CatalogBundleEntry = {
  itemId: string;
  /** null: la cantidad por defecto del servicio. */
  quantity: string | null;
};

export type CatalogBundle = CatalogTexts & {
  id: string;
  /** Va en cada una de sus líneas. */
  discountBps: Bps;
  isActive: boolean;
  position: number;
  /** En su orden. */
  items: CatalogBundleEntry[];
};

/** Un tipo de IVA de la org (tax_rates de tipo `vat`). */
export type CatalogVatRate = {
  id: string;
  name: string;
  rateBps: Bps;
  regime: VatRegime;
  isDefault: boolean;
  archived: boolean;
};

/** Todo lo que hace falta para elegir del catálogo (serializable: viaja del servidor al navegador). */
export type CatalogSnapshot = {
  items: CatalogItem[];
  bundles: CatalogBundle[];
  vatRates: CatalogVatRate[];
};

/**
 * Límites (los mismos que comprueba la base de datos). Nombre + " — " + descripción es la
 * descripción de una línea, y cabe en sus 500 caracteres.
 */
export const CATALOG_LIMITS = { name: 120, description: 375, unitLabel: 30, bundleItems: 50 } as const;
