"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { createClient } from "@/lib/supabase/server";
import { dbFailure, failure, forbidden, idSchema, invalidInput, partnerContext } from "@/server/action-utils";

// Acciones de la bóveda. Aquí solo entran y salen textos ya cifrados en el navegador: ninguna de
// estas funciones puede leer una contraseña, ni queriendo.

const settingsSchema = z.object({
  kdf_salt: z.string().trim().min(16).max(128),
  kdf_iterations: z.number().int().min(100_000).max(10_000_000),
  verifier: z.string().trim().min(20).max(500),
});

const itemSchema = z.object({
  ciphertext: z.string().trim().min(20).max(100_000),
  client_id: z.union([z.literal(""), z.guid()]).default(""),
});

/** Los secretos vueltos a cifrar con la contraseña nueva, al cambiarla. */
const reEncryptedSchema = z.array(z.object({ id: z.guid(), ciphertext: z.string().trim().min(20).max(100_000) })).max(2000);

const path = (slug: string) => `/${slug}/passwords`;

/** Crea la bóveda del equipo con la contraseña que acaban de elegir. Solo si no existe ya. */
export async function createVault(slug: string, input: unknown): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return invalidInput();
  const db = await createClient();
  const { error } = await db.from("vault_settings").insert({
    org_id: ctx.org.id,
    kdf_salt: parsed.data.kdf_salt,
    kdf_iterations: parsed.data.kdf_iterations,
    verifier: parsed.data.verifier,
    rotated_by: ctx.member.id,
  });
  if (error) {
    if (error.code === "23505") return failure("passwords.errors.alreadyExists");
    return dbFailure(error, "vault.create");
  }
  revalidatePath(path(ctx.org.slug));
  return { ok: true };
}

/**
 * Cambia la contraseña del equipo: llegan los parámetros nuevos y todos los secretos ya vueltos a
 * cifrar con ella (lo hace el navegador de quien la cambia, el único sitio donde están en claro).
 * Si algo falla a medias, no se toca nada: primero se guardan los secretos y luego la contraseña.
 */
export async function rotateVaultPassword(slug: string, input: unknown, items: unknown): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const parsed = settingsSchema.safeParse(input);
  const reEncrypted = reEncryptedSchema.safeParse(items);
  if (!parsed.success || !reEncrypted.success) return invalidInput();
  const db = await createClient();

  for (const item of reEncrypted.data) {
    const { error } = await db.from("vault_items").update({ ciphertext: item.ciphertext }).eq("org_id", ctx.org.id).eq("id", item.id);
    if (error) return dbFailure(error, "vault.rotate.item");
  }
  const { error } = await db
    .from("vault_settings")
    .update({
      kdf_salt: parsed.data.kdf_salt,
      kdf_iterations: parsed.data.kdf_iterations,
      verifier: parsed.data.verifier,
      rotated_at: new Date().toISOString(),
      rotated_by: ctx.member.id,
    })
    .eq("org_id", ctx.org.id);
  if (error) return dbFailure(error, "vault.rotate");
  revalidatePath(path(ctx.org.slug));
  return { ok: true };
}

/** Crea o cambia un secreto. `itemId` null = nuevo. */
export async function saveVaultItem(slug: string, itemId: string | null, input: unknown): Promise<ActionResult<{ id: string }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const parsed = itemSchema.safeParse(input);
  const id = itemId === null ? null : idSchema.safeParse(itemId);
  if (!parsed.success || (id && !id.success)) return invalidInput();
  const db = await createClient();
  const row = { org_id: ctx.org.id, ciphertext: parsed.data.ciphertext, client_id: parsed.data.client_id || null };

  if (id?.success) {
    const { data, error } = await db.from("vault_items").update(row).eq("org_id", ctx.org.id).eq("id", id.data).select("id").maybeSingle();
    if (error) return dbFailure(error, "vault.updateItem");
    if (!data) return failure("passwords.errors.notFound");
    revalidatePath(path(ctx.org.slug));
    return { ok: true, id: data.id };
  }
  const { data, error } = await db.from("vault_items").insert(row).select("id").maybeSingle();
  if (error) return dbFailure(error, "vault.insertItem");
  if (!data) return failure("common.errorGeneric");
  revalidatePath(path(ctx.org.slug));
  return { ok: true, id: data.id };
}

/** Archiva un secreto: desaparece de la lista y su historial queda en la auditoría. */
export async function archiveVaultItem(slug: string, itemId: string): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  if (!idSchema.safeParse(itemId).success) return invalidInput();
  const db = await createClient();
  const { data, error } = await db
    .from("vault_items")
    .update({ archived_at: new Date().toISOString() })
    .eq("org_id", ctx.org.id)
    .eq("id", itemId)
    .select("id")
    .maybeSingle();
  if (error) return dbFailure(error, "vault.archiveItem");
  if (!data) return failure("passwords.errors.notFound");
  revalidatePath(path(ctx.org.slug));
  return { ok: true };
}
