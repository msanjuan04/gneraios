"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { createClient } from "@/lib/supabase/server";
import { dbFailure, failure, forbidden, idSchema, invalidInput, partnerContext } from "@/server/action-utils";

// Acciones de la bóveda. Aquí solo entran y salen textos ya cifrados en el navegador: ninguna de
// estas funciones puede leer una contraseña, ni queriendo.

const base64 = (max: number) => z.string().trim().min(16).max(max).regex(/^[A-Za-z0-9+/=.]+$/, "invalid");

const registerKeysSchema = z.object({
  public_key: base64(2000),
  private_key_ciphertext: base64(8000),
  kdf_salt: base64(128),
  kdf_iterations: z.number().int().min(100_000).max(10_000_000),
  /** Al crear la bóveda, el primer socio se da acceso a sí mismo en el mismo paso. */
  wrapped_key: base64(2000).optional(),
});

const itemSchema = z.object({
  ciphertext: z.string().trim().min(20).max(100_000),
  client_id: z.union([z.literal(""), z.guid()]).default(""),
});

const path = (slug: string) => `/${slug}/passwords`;

/** Guarda el par de claves del miembro (la privada ya cifrada con su contraseña maestra). */
export async function registerVaultKeys(slug: string, input: unknown): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const parsed = registerKeysSchema.safeParse(input);
  if (!parsed.success) return invalidInput();
  const v = parsed.data;
  const db = await createClient();
  const { error } = await db.from("vault_keys").upsert(
    {
      org_id: ctx.org.id,
      member_id: ctx.member.id,
      public_key: v.public_key,
      private_key_ciphertext: v.private_key_ciphertext,
      kdf_salt: v.kdf_salt,
      kdf_iterations: v.kdf_iterations,
    },
    { onConflict: "org_id,member_id" },
  );
  if (error) return dbFailure(error, "vault.registerKeys");

  if (v.wrapped_key) {
    // Solo cuela si la bóveda aún no existe: la RLS no deja dársela a uno mismo si ya hay sobres.
    const { error: grantError } = await db
      .from("vault_grants")
      .insert({ org_id: ctx.org.id, member_id: ctx.member.id, wrapped_key: v.wrapped_key, granted_by: ctx.member.id });
    if (grantError) return dbFailure(grantError, "vault.createVault", (e) => (e.code === "42501" ? "passwords.errors.alreadyExists" : undefined));
  }
  revalidatePath(path(ctx.org.slug));
  return { ok: true };
}

/** Da acceso a otro socio: su sobre lo prepara en el navegador quien ya tiene la clave. */
export async function grantVaultAccess(slug: string, memberId: string, wrappedKey: string): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  if (!idSchema.safeParse(memberId).success || !base64(2000).safeParse(wrappedKey).success) return invalidInput();
  const db = await createClient();
  const { error } = await db
    .from("vault_grants")
    .upsert({ org_id: ctx.org.id, member_id: memberId, wrapped_key: wrappedKey, granted_by: ctx.member.id }, { onConflict: "org_id,member_id" });
  if (error) return dbFailure(error, "vault.grant");
  revalidatePath(path(ctx.org.slug));
  return { ok: true };
}

/** Quita el acceso a alguien. Lo que ya vio, visto está: hay que cambiar esas contraseñas. */
export async function revokeVaultAccess(slug: string, memberId: string): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  if (!idSchema.safeParse(memberId).success) return invalidInput();
  const db = await createClient();
  const { error } = await db.from("vault_grants").delete().eq("org_id", ctx.org.id).eq("member_id", memberId);
  if (error) return dbFailure(error, "vault.revoke");
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
