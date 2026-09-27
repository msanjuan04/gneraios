"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { createClient } from "@/lib/supabase/server";
import { dbFailure, failure, forbidden, idSchema, invalidInput, partnerContext } from "@/server/action-utils";
import { knownVendorError } from "@/server/vendors/errors";
import { type VendorFormInput, vendorFormSchema, vendorRow } from "./schema";

/**
 * Acciones de Finanzas → Proveedores. Se escriben con el cliente del usuario: la RLS es la
 * barrera (un socio los lleva; los demás, solo lectura). Los proveedores se archivan, no se borran:
 * sus gastos los conservan.
 */

const fail = (error: PostgrestError, where: string) => dbFailure(error, where, knownVendorError);

/**
 * Vuelve a pintar lo que enseña proveedores: su listado y sus fichas, los gastos (el nombre y el
 * filtro), Ajustes → Gastos (el editor sencillo) y las fichas de los clientes (su tarjeta).
 */
function revalidateVendors(slug: string) {
  revalidatePath(`/${slug}/finance/vendors`, "layout");
  revalidatePath(`/${slug}/finance/expenses`);
  revalidatePath(`/${slug}/settings/expenses`);
  revalidatePath(`/${slug}/clients`, "layout");
}

/** Crea o corrige un proveedor con todos sus datos. */
export async function saveVendorProfile(slug: string, vendorId: string | null, input: VendorFormInput): Promise<ActionResult<{ id: string }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const parsed = vendorFormSchema.safeParse(input);
  const id = vendorId === null ? null : idSchema.safeParse(vendorId);
  if (!parsed.success || (id && !id.success)) return invalidInput();
  const row = vendorRow(parsed.data);
  const supabase = await createClient();

  if (id) {
    const { data, error } = await supabase.from("vendors").update(row).eq("org_id", ctx.org.id).eq("id", id.data).select("id");
    if (error) return fail(error, "saveVendorProfile.update");
    if (data.length === 0) return failure("vendors.errors.notFound");
    revalidateVendors(ctx.org.slug);
    return { ok: true, id: id.data };
  }
  const { data, error } = await supabase
    .from("vendors")
    .insert({ ...row, org_id: ctx.org.id })
    .select("id")
    .single();
  if (error) return fail(error, "saveVendorProfile.insert");
  revalidateVendors(ctx.org.slug);
  return { ok: true, id: data.id };
}

/** Archiva un proveedor (sus gastos lo conservan; ya no se propone al registrar uno) o lo recupera. */
export async function archiveVendor(slug: string, vendorId: string, archived: boolean): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(vendorId);
  if (!id.success || typeof archived !== "boolean") return invalidInput();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vendors")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("org_id", ctx.org.id)
    .eq("id", id.data)
    .select("id");
  // Recuperarlo choca si mientras tanto otro proveedor activo tiene su NIF (índice único).
  if (error) return fail(error, "archiveVendor");
  if (data.length === 0) return failure("vendors.errors.notFound");
  revalidateVendors(ctx.org.slug);
  return { ok: true };
}
