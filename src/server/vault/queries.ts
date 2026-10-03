import "server-only";

import { createClient } from "@/lib/supabase/server";

// Lecturas de la bóveda. Todo lo que sale de aquí está cifrado: el servidor no puede abrirlo.

export type VaultMemberKey = {
  memberId: string;
  fullName: string;
  initials: string;
  color: string | null;
  publicKey: string;
  /** Si ya tiene el sobre con la clave de la bóveda (puede abrir los secretos). */
  hasAccess: boolean;
  /** El propio miembro que mira. */
  isMe: boolean;
};

export type VaultState = {
  /** Claves del miembro actual; null si todavía no ha creado su contraseña maestra. */
  myKeys: { publicKey: string; privateKeyCiphertext: string; kdfSalt: string; kdfIterations: number } | null;
  /** El sobre del miembro actual; null si aún no tiene acceso. */
  myWrappedKey: string | null;
  /** Si la org ya tiene bóveda (alguien la creó). */
  exists: boolean;
  /** Todos los socios con clave: para ver quién tiene acceso y poder dárselo. */
  members: VaultMemberKey[];
};

export async function loadVaultState(orgId: string, memberId: string): Promise<VaultState> {
  const db = await createClient();
  const [keys, grants, members] = await Promise.all([
    db.from("vault_keys").select("member_id, public_key, private_key_ciphertext, kdf_salt, kdf_iterations").eq("org_id", orgId),
    db.from("vault_grants").select("member_id, wrapped_key").eq("org_id", orgId),
    db.from("members").select("id, full_name, initials, color").eq("org_id", orgId).eq("is_active", true).order("full_name"),
  ]);
  if (keys.error) throw keys.error;
  if (grants.error) throw grants.error;
  if (members.error) throw members.error;

  const keyByMember = new Map((keys.data ?? []).map((row) => [row.member_id, row]));
  const grantByMember = new Map((grants.data ?? []).map((row) => [row.member_id, row.wrapped_key]));
  const mine = keyByMember.get(memberId);

  return {
    myKeys: mine
      ? {
          publicKey: mine.public_key,
          privateKeyCiphertext: mine.private_key_ciphertext,
          kdfSalt: mine.kdf_salt,
          kdfIterations: mine.kdf_iterations,
        }
      : null,
    myWrappedKey: grantByMember.get(memberId) ?? null,
    exists: (grants.data ?? []).length > 0,
    members: (members.data ?? []).flatMap((member) => {
      const key = keyByMember.get(member.id);
      if (!key) return [];
      return [
        {
          memberId: member.id,
          fullName: member.full_name,
          initials: member.initials,
          color: member.color,
          publicKey: key.public_key,
          hasAccess: grantByMember.has(member.id),
          isMe: member.id === memberId,
        },
      ];
    }),
  };
}

export type VaultRow = { id: string; clientId: string | null; ciphertext: string; updatedAt: string };

/** Los secretos cifrados de la org. Sin sobre, la RLS no devuelve ninguno. */
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
