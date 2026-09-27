"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import {
  type CatalogBundleFormInput,
  catalogBundleFormSchema,
  type CatalogItemFormInput,
  catalogItemFormSchema,
  type SaveBundlePayload,
  toBundlePayload,
  toItemValues,
} from "@/app/[org]/settings/catalog/schema";
import { CATALOG_LIMITS, type CatalogCategory, type CatalogSnapshot, resolveVatRateId } from "@/domain/catalog";
import type { ActionResult } from "@/lib/action-result";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { type Failure, failure, forbidden, idSchema, invalidInput, memberContext, partnerContext } from "@/server/action-utils";
import { type Db, DbError } from "@/server/billing/context";
import { catalogFailure } from "./errors";
import { getCatalogBundle, getCatalogItem, loadCatalog } from "./queries";
import { defaultVatRateId, starterItemRows, toCatalogVatRate, translationsJson, VAT_COLUMNS } from "./rows";

/**
 * Acciones del catálogo (Ajustes → Catálogo y el selector de los editores). Escribe un socio; RLS
 * lo vuelve a comprobar en cada escritura. Los errores llegan traducidos, listos para el toast.
 */

const idListSchema = z.array(z.guid()).min(1).max(500);

function revalidateCatalog(slug: string) {
  revalidatePath(`/${slug}/settings/catalog`);
}

async function describeError(error: unknown, where: string): Promise<Failure> {
  if (error instanceof DbError) return catalogFailure(error.error, error.where);
  console.error(`[catalog] ${where}`, error);
  return failure("common.errorGeneric");
}

/** Posición para ir al final de una categoría. */
async function nextItemPosition(supabase: Db, orgId: string, category: CatalogCategory): Promise<number> {
  const { data, error } = await supabase
    .from("catalog_items")
    .select("position")
    .eq("org_id", orgId)
    .eq("category", category)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new DbError(error, "catalog.nextPosition");
  return (data?.position ?? -1) + 1;
}

/**
 * Nombre para una copia: "Web corporativa (copia)", "(copia 2)"… el primero que no use ningún
 * activo (sin distinguir mayúsculas, como el índice único), sin pasar del límite.
 */
async function copyName(name: string, table: "catalog_items" | "catalog_bundles", supabase: Db, orgId: string): Promise<string> {
  const t = await getTranslations("catalog");
  const { data, error } = await supabase.from(table).select("name").eq("org_id", orgId).eq("is_active", true);
  if (error) throw new DbError(error, "catalog.copyName");
  const taken = new Set(data.map((row) => row.name.toLowerCase()));
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? t("copySuffix") : t("copySuffixN", { n });
    const base = [...name].slice(0, CATALOG_LIMITS.name - [...suffix].length - 1).join("").trimEnd();
    const candidate = `${base} ${suffix}`;
    if (!taken.has(candidate.toLowerCase()) || n > 99) return candidate;
  }
}

// ---------------------------------------------------------------------------
// Servicios
// ---------------------------------------------------------------------------

/** Crea o actualiza un servicio. Uno nuevo (o que cambia de categoría) va al final de la suya. */
export async function saveCatalogItem(
  slug: string,
  itemId: string | null,
  input: CatalogItemFormInput,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const parsed = catalogItemFormSchema.safeParse(input);
  const id = itemId === null ? null : idSchema.safeParse(itemId);
  if (!parsed.success || (id && !id.success)) return invalidInput();

  const values = toItemValues(parsed.data);
  const row = { ...values, translations: translationsJson(values.translations), default_quantity: Number(values.default_quantity) };
  const orgId = ctx.org.id;
  const supabase = await createClient();
  try {
    if (id) {
      const current = await getCatalogItem(supabase, orgId, id.data);
      if (!current) return failure("catalog.errors.itemNotFound");
      const position = current.category === values.category ? current.position : await nextItemPosition(supabase, orgId, values.category);
      const { data, error } = await supabase
        .from("catalog_items")
        .update({ ...row, position })
        .eq("org_id", orgId)
        .eq("id", id.data)
        .select("id");
      if (error) return catalogFailure(error, "saveCatalogItem.update");
      if (data.length === 0) return forbidden();
      revalidateCatalog(ctx.org.slug);
      return { ok: true, id: id.data };
    }
    const position = await nextItemPosition(supabase, orgId, values.category);
    const { data, error } = await supabase
      .from("catalog_items")
      .insert({ ...row, org_id: orgId, position })
      .select("id")
      .single();
    if (error) return catalogFailure(error, "saveCatalogItem.insert");
    revalidateCatalog(ctx.org.slug);
    return { ok: true, id: data.id };
  } catch (error) {
    return describeError(error, "saveCatalogItem");
  }
}

async function setItemActive(slug: string, itemId: string, active: boolean): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(itemId);
  if (!id.success) return invalidInput();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("catalog_items")
    .update({ is_active: active })
    .eq("org_id", ctx.org.id)
    .eq("id", id.data)
    .select("id");
  if (error) return catalogFailure(error, active ? "restoreCatalogItem" : "archiveCatalogItem");
  if (data.length === 0) return failure("catalog.errors.itemNotFound");
  revalidateCatalog(ctx.org.slug);
  return { ok: true };
}

/** Archiva un servicio: deja de proponerse (y de salir en sus packs). Lo ya presupuestado no cambia. */
export async function archiveCatalogItem(slug: string, itemId: string): Promise<ActionResult> {
  return setItemActive(slug, itemId, false);
}

/** Vuelve a proponer un servicio archivado. */
export async function restoreCatalogItem(slug: string, itemId: string): Promise<ActionResult> {
  return setItemActive(slug, itemId, true);
}

/** Copia de un servicio («… (copia)»), al final de su categoría. */
export async function duplicateCatalogItem(slug: string, itemId: string): Promise<ActionResult<{ id: string }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(itemId);
  if (!id.success) return invalidInput();
  const orgId = ctx.org.id;
  const supabase = await createClient();
  try {
    const [item, rates] = await Promise.all([
      getCatalogItem(supabase, orgId, id.data),
      supabase.from("tax_rates").select(VAT_COLUMNS).eq("org_id", orgId).eq("kind", "vat"),
    ]);
    if (!item) return failure("catalog.errors.itemNotFound");
    if (rates.error) return catalogFailure(rates.error, "duplicateCatalogItem.vat");
    const { data, error } = await supabase
      .from("catalog_items")
      .insert({
        org_id: orgId,
        category: item.category,
        name: await copyName(item.name, "catalog_items", supabase, orgId),
        description: item.description,
        translations: translationsJson(item.translations),
        billing_type: item.billingType,
        unit_label: item.unitLabel,
        unit_price_cents: item.unitPriceCents,
        default_quantity: Number(item.defaultQuantity),
        // Si su IVA se archivó, la copia nace con el vigente (el que llevarían sus líneas).
        tax_rate_id: resolveVatRateId(item.taxRateId, rates.data.map(toCatalogVatRate)),
        irpf_applies: item.irpfApplies,
        position: await nextItemPosition(supabase, orgId, item.category),
      })
      .select("id")
      .single();
    if (error) return catalogFailure(error, "duplicateCatalogItem");
    revalidateCatalog(ctx.org.slug);
    return { ok: true, id: data.id };
  } catch (error) {
    return describeError(error, "duplicateCatalogItem");
  }
}

/** Nuevo orden de los servicios de una categoría (los ids, en ese orden). */
export async function reorderCatalogItems(slug: string, itemIds: string[]): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const ids = idListSchema.safeParse(itemIds);
  if (!ids.success) return invalidInput();
  const supabase = await createClient();
  const { error } = await supabase.rpc("reorder_catalog_items", { p_ids: ids.data });
  if (error) return catalogFailure(error, "reorderCatalogItems");
  revalidateCatalog(ctx.org.slug);
  return { ok: true };
}

/**
 * «Crear servicios de ejemplo»: el catálogo de ejemplo de una agencia (src/domain/catalog/starter.ts)
 * con el IVA por defecto de la org. Solo con el catálogo vacío: no duplica nada.
 */
export async function createStarterCatalog(slug: string): Promise<ActionResult<{ count: number }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const orgId = ctx.org.id;
  const supabase = await createClient();
  const [existing, rates] = await Promise.all([
    supabase.from("catalog_items").select("id", { count: "exact", head: true }).eq("org_id", orgId),
    supabase.from("tax_rates").select(VAT_COLUMNS).eq("org_id", orgId).eq("kind", "vat"),
  ]);
  if (existing.error) return catalogFailure(existing.error, "createStarterCatalog.count");
  if (rates.error) return catalogFailure(rates.error, "createStarterCatalog.vat");
  if ((existing.count ?? 0) > 0) return failure("catalog.errors.starterNotEmpty");
  const taxRateId = defaultVatRateId(rates.data.map(toCatalogVatRate));
  if (!taxRateId) return failure("catalog.errors.noVatRate");

  const rows = starterItemRows({ orgId, taxRateId });
  const { error } = await supabase.from("catalog_items").insert(rows);
  if (error) return catalogFailure(error, "createStarterCatalog.insert");
  revalidateCatalog(ctx.org.slug);
  return { ok: true, count: rows.length };
}

// ---------------------------------------------------------------------------
// Packs
// ---------------------------------------------------------------------------

async function saveBundleRpc(supabase: Db, payload: SaveBundlePayload): Promise<{ id: string } | Failure> {
  const { data, error } = await supabase.rpc("save_catalog_bundle", { p: payload as unknown as Json });
  if (error) return catalogFailure(error, "saveCatalogBundle");
  return { id: data };
}

/** Crea o actualiza un pack con todos sus servicios (conjunto completo, en su orden). */
export async function saveCatalogBundle(
  slug: string,
  bundleId: string | null,
  input: CatalogBundleFormInput,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const parsed = catalogBundleFormSchema.safeParse(input);
  const id = bundleId === null ? null : idSchema.safeParse(bundleId);
  if (!parsed.success || (id && !id.success)) return invalidInput();
  const supabase = await createClient();
  const saved = await saveBundleRpc(supabase, toBundlePayload(parsed.data, { bundleId: id?.data ?? null, orgId: ctx.org.id }));
  if ("ok" in saved) return saved;
  revalidateCatalog(ctx.org.slug);
  return { ok: true, id: saved.id };
}

async function setBundleActive(slug: string, bundleId: string, active: boolean): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(bundleId);
  if (!id.success) return invalidInput();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("catalog_bundles")
    .update({ is_active: active })
    .eq("org_id", ctx.org.id)
    .eq("id", id.data)
    .select("id");
  if (error) return catalogFailure(error, active ? "restoreCatalogBundle" : "archiveCatalogBundle");
  if (data.length === 0) return failure("catalog.errors.bundleNotFound");
  revalidateCatalog(ctx.org.slug);
  return { ok: true };
}

export async function archiveCatalogBundle(slug: string, bundleId: string): Promise<ActionResult> {
  return setBundleActive(slug, bundleId, false);
}

export async function restoreCatalogBundle(slug: string, bundleId: string): Promise<ActionResult> {
  return setBundleActive(slug, bundleId, true);
}

/** Copia de un pack con sus servicios («… (copia)»), al final. */
export async function duplicateCatalogBundle(slug: string, bundleId: string): Promise<ActionResult<{ id: string }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(bundleId);
  if (!id.success) return invalidInput();
  const orgId = ctx.org.id;
  const supabase = await createClient();
  try {
    const bundle = await getCatalogBundle(supabase, orgId, id.data);
    if (!bundle) return failure("catalog.errors.bundleNotFound");
    const saved = await saveBundleRpc(supabase, {
      bundle_id: null,
      org_id: orgId,
      name: await copyName(bundle.name, "catalog_bundles", supabase, orgId),
      description: bundle.description,
      translations: bundle.translations,
      discount_bps: bundle.discountBps,
      items: bundle.items.map((entry) => ({ item_id: entry.itemId, quantity: entry.quantity })),
    });
    if ("ok" in saved) return saved;
    revalidateCatalog(ctx.org.slug);
    return { ok: true, id: saved.id };
  } catch (error) {
    return describeError(error, "duplicateCatalogBundle");
  }
}

/** Nuevo orden de los packs (los ids, en ese orden). */
export async function reorderCatalogBundles(slug: string, bundleIds: string[]): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const ids = idListSchema.safeParse(bundleIds);
  if (!ids.success) return invalidInput();
  const supabase = await createClient();
  const { error } = await supabase.rpc("reorder_catalog_bundles", { p_ids: ids.data });
  if (error) return catalogFailure(error, "reorderCatalogBundles");
  revalidateCatalog(ctx.org.slug);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Selector (CatalogPicker)
// ---------------------------------------------------------------------------

/**
 * Lo que se propone en los editores: los servicios y los packs activos, y los tipos de IVA (para
 * cambiar uno archivado por el vigente). Lo lee cualquier miembro; no cambia nada.
 */
export async function getCatalogForPicker(slug: string): Promise<ActionResult<{ catalog: CatalogSnapshot }>> {
  const ctx = await memberContext(slug);
  if (!ctx) return forbidden();
  try {
    const supabase = await createClient();
    const { items, bundles, vatRates } = await loadCatalog(supabase, ctx.org.id, { activeOnly: true });
    return { ok: true, catalog: { items, bundles, vatRates } };
  } catch (error) {
    return describeError(error, "getCatalogForPicker");
  }
}
