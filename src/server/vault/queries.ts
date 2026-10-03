import "server-only";

import type { VaultSettings } from "@/domain/vault";
import { createClient } from "@/lib/supabase/server";

// Lecturas de la bóveda. Todo lo que sale de aquí está cifrado o es un parámetro público (la sal):
// el servidor no puede abrir un secreto, porque la contraseña del equipo solo existe en el navegador.

export type VaultState = {
  /** Parámetros de la contraseña del equipo; null si la bóveda aún no existe. */
  settings: VaultSettings | null;
  /** Quién cambió la contraseña por última vez y cuándo. */
  rotated: { at: string; by: string | null } | null;
};

export async function loadVaultState(orgId: string): Promise<VaultState> {
  const db = await createClient();
  const { data, error } = await db
    .from("vault_settings")
    .select("kdf_salt, kdf_iterations, verifier, rotated_at, rotated_by")
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { settings: null, rotated: null };

  let by: string | null = null;
  if (data.rotated_by) {
    const { data: member } = await db.from("members").select("full_name").eq("org_id", orgId).eq("id", data.rotated_by).maybeSingle();
    by = member?.full_name ?? null;
  }
  return {
    settings: { kdfSalt: data.kdf_salt, kdfIterations: data.kdf_iterations, verifier: data.verifier },
    rotated: { at: data.rotated_at, by },
  };
}

export type VaultRow = { id: string; clientId: string | null; ciphertext: string; updatedAt: string };

/** Los secretos cifrados de la org. Sin la contraseña del equipo no se pueden leer. */
export async function listVaultItems(orgId: string): Promise<VaultRow[]> {
  const db = await createClient();
  const { data, error } = await db
    .from("vault_items")
    .select("id, client_id, ciphertext, updated_at")
    .eq("org_id", orgId)
    .is("archived_at", null)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => ({ id: row.id, clientId: row.client_id, ciphertext: row.ciphertext, updatedAt: row.updated_at }));
}
