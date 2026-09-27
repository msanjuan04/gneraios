import "server-only";
import type { CatalogBundle, CatalogItem, CatalogSnapshot } from "@/domain/catalog";
import { type Db, DbError, fetchAll } from "@/server/billing/context";
import {
  BUNDLE_COLUMNS,
  BUNDLE_ENTRY_COLUMNS,
  defaultVatRateId,
  ITEM_COLUMNS,
  toCatalogBundle,
  toCatalogItem,
  toCatalogVatRate,
  VAT_COLUMNS,
} from "./rows";

/**
 * Lecturas del catálogo. Todo pasa por RLS: cualquier miembro lee. Los servicios salen por
 * categoría (el orden del enum) y, dentro, por su posición; los packs, por su posición.
 */

export type CatalogData = CatalogSnapshot & {
  /** El IVA que se propone a un servicio nuevo. */
  defaultVatRateId: string | null;
};

/** Todo el catálogo de la org, archivados incluidos (salvo con `activeOnly`), y sus tipos de IVA. */
export async function loadCatalog(supabase: Db, orgId: string, opts: { activeOnly?: boolean } = {}): Promise<CatalogData> {
  const [items, bundles, entries, rates] = await Promise.all([
    fetchAll((from, to) => {
      let query = supabase.from("catalog_items").select(ITEM_COLUMNS).eq("org_id", orgId);
      if (opts.activeOnly) query = query.eq("is_active", true);
      return query.order("category").order("position").order("name").order("id").range(from, to);
    }, "catalog.items"),
    fetchAll((from, to) => {
      let query = supabase.from("catalog_bundles").select(BUNDLE_COLUMNS).eq("org_id", orgId);
      if (opts.activeOnly) query = query.eq("is_active", true);
      return query.order("position").order("name").order("id").range(from, to);
    }, "catalog.bundles"),
    fetchAll(
      (from, to) =>
        supabase.from("catalog_bundle_items").select(BUNDLE_ENTRY_COLUMNS).eq("org_id", orgId).order("bundle_id").order("position").range(from, to),
      "catalog.bundleItems",
    ),
    supabase.from("tax_rates").select(VAT_COLUMNS).eq("org_id", orgId).eq("kind", "vat").order("position").order("name"),
  ]);
  if (rates.error) throw new DbError(rates.error, "catalog.vatRates");

  const vatRates = rates.data.map(toCatalogVatRate);
  return {
    items: items.map(toCatalogItem),
    bundles: bundles.map((row) => toCatalogBundle(row, entries)),
    vatRates,
    defaultVatRateId: defaultVatRateId(vatRates),
  };
}

/** Un servicio de la org, o null. */
export async function getCatalogItem(supabase: Db, orgId: string, itemId: string): Promise<CatalogItem | null> {
  const { data, error } = await supabase.from("catalog_items").select(ITEM_COLUMNS).eq("org_id", orgId).eq("id", itemId).maybeSingle();
  if (error) throw new DbError(error, "catalog.item");
  return data ? toCatalogItem(data) : null;
}

/** Un pack de la org con sus servicios, o null. */
export async function getCatalogBundle(supabase: Db, orgId: string, bundleId: string): Promise<CatalogBundle | null> {
  const [bundle, entries] = await Promise.all([
    supabase.from("catalog_bundles").select(BUNDLE_COLUMNS).eq("org_id", orgId).eq("id", bundleId).maybeSingle(),
    supabase.from("catalog_bundle_items").select(BUNDLE_ENTRY_COLUMNS).eq("org_id", orgId).eq("bundle_id", bundleId).order("position"),
  ]);
  if (bundle.error) throw new DbError(bundle.error, "catalog.bundle");
  if (entries.error) throw new DbError(entries.error, "catalog.bundle.items");
  return bundle.data ? toCatalogBundle(bundle.data, entries.data) : null;
}
