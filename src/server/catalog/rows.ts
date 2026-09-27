// Sin "server-only": lo usa también el seed de la demo (scripts/seed-demo-catalog.ts). Solo se importa
// desde código de servidor.
import {
  type CatalogBundle,
  type CatalogItem,
  type CatalogTranslations,
  type CatalogVatRate,
  quantityText,
  readTranslations,
  STARTER_ITEMS,
  type StarterItem,
  starterPositions,
} from "@/domain/catalog";
import type { Enums, Json, Tables } from "@/lib/supabase/database.types";

/**
 * Filas del catálogo ↔ tipos del dominio. Las columnas que se leen están aquí para que las
 * consultas, las acciones y el seed lean siempre lo mismo.
 */

export const ITEM_COLUMNS =
  "id, category, name, description, translations, billing_type, unit_label, unit_price_cents, default_quantity, tax_rate_id, irpf_applies, is_active, position";
export const BUNDLE_COLUMNS = "id, name, description, translations, discount_bps, is_active, position";
export const BUNDLE_ENTRY_COLUMNS = "bundle_id, item_id, quantity, position";
export const VAT_COLUMNS = "id, name, rate_bps, regime, is_default, archived_at";

type ItemRow = Pick<
  Tables<"catalog_items">,
  | "id"
  | "category"
  | "name"
  | "description"
  | "translations"
  | "billing_type"
  | "unit_label"
  | "unit_price_cents"
  | "default_quantity"
  | "tax_rate_id"
  | "irpf_applies"
  | "is_active"
  | "position"
>;
type BundleRow = Pick<Tables<"catalog_bundles">, "id" | "name" | "description" | "translations" | "discount_bps" | "is_active" | "position">;
type BundleEntryRow = Pick<Tables<"catalog_bundle_items">, "bundle_id" | "item_id" | "quantity" | "position">;
type VatRow = Pick<Tables<"tax_rates">, "id" | "name" | "rate_bps" | "regime" | "is_default" | "archived_at">;

export function toCatalogItem(row: ItemRow): CatalogItem {
  return {
    id: row.id,
    category: row.category,
    name: row.name,
    description: row.description,
    translations: readTranslations(row.translations),
    billingType: row.billing_type,
    unitLabel: row.unit_label,
    unitPriceCents: row.unit_price_cents,
    defaultQuantity: quantityText(row.default_quantity),
    taxRateId: row.tax_rate_id,
    irpfApplies: row.irpf_applies,
    isActive: row.is_active,
    position: row.position,
  };
}

/** Un pack con sus servicios (de todas las filas de catalog_bundle_items que llegan, las suyas y en su orden). */
export function toCatalogBundle(row: BundleRow, entries: readonly BundleEntryRow[]): CatalogBundle {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    translations: readTranslations(row.translations),
    discountBps: row.discount_bps,
    isActive: row.is_active,
    position: row.position,
    items: entries
      .filter((entry) => entry.bundle_id === row.id)
      .sort((a, b) => a.position - b.position)
      .map((entry) => ({ itemId: entry.item_id, quantity: entry.quantity === null ? null : quantityText(entry.quantity) })),
  };
}

export function toCatalogVatRate(row: VatRow): CatalogVatRate {
  return {
    id: row.id,
    name: row.name,
    rateBps: row.rate_bps,
    regime: row.regime ?? "general",
    isDefault: row.is_default,
    archived: row.archived_at !== null,
  };
}

/** El IVA que se propone: el de por defecto de la org, o el primero vigente. */
export function defaultVatRateId(rates: readonly CatalogVatRate[]): string | null {
  const active = rates.filter((rate) => !rate.archived);
  return (active.find((rate) => rate.isDefault) ?? active[0])?.id ?? null;
}

/** Traducciones para una columna jsonb. */
export function translationsJson(translations: CatalogTranslations): Json {
  return translations as Json;
}

export type ItemInsert = {
  org_id: string;
  category: Enums<"catalog_category">;
  name: string;
  description: string | null;
  translations: Json;
  billing_type: Enums<"billing_type">;
  unit_label: string | null;
  unit_price_cents: number;
  default_quantity: number;
  tax_rate_id: string;
  irpf_applies: boolean;
  position: number;
};

/** Una fila de catalog_items para insertar un servicio del catálogo de ejemplo. */
export function starterItemRow(item: StarterItem, ctx: { orgId: string; taxRateId: string; position: number }): ItemInsert {
  return {
    org_id: ctx.orgId,
    category: item.category,
    name: item.name,
    description: item.description,
    translations: translationsJson(item.translations),
    billing_type: item.billingType,
    unit_label: item.unitLabel,
    unit_price_cents: item.unitPriceCents,
    default_quantity: Number(item.defaultQuantity),
    tax_rate_id: ctx.taxRateId,
    irpf_applies: item.irpfApplies,
    position: ctx.position,
  };
}

/** Las filas del catálogo de ejemplo, cada una detrás de las de su categoría. */
export function starterItemRows(ctx: { orgId: string; taxRateId: string }, items: readonly StarterItem[] = STARTER_ITEMS): ItemInsert[] {
  const positions = starterPositions(items);
  return items.map((item) => starterItemRow(item, { ...ctx, position: positions.get(item.key) ?? 0 }));
}
