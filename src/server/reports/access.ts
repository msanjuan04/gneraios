import "server-only";
import type { Db } from "@/server/billing/context";
import { hasRole } from "@/server/session";

/**
 * La org de un cliente si quien pide es socio (u owner) activo de ella. Las rutas del informe no
 * llevan la org en la URL (como la del PDF de un presupuesto): se deduce del cliente, que la RLS
 * solo deja ver a los miembros de su org. null si no lo ve o no es socio.
 */
export async function partnerClientAccess(db: Db, userId: string, clientId: string): Promise<{ orgId: string } | null> {
  const { data: client, error } = await db.from("clients").select("id, org_id").eq("id", clientId).maybeSingle();
  if (error) throw error;
  if (!client) return null;
  const { data: member, error: memberError } = await db
    .from("members")
    .select("role")
    .eq("org_id", client.org_id)
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();
  if (memberError) throw memberError;
  return member && hasRole(member.role, "partner") ? { orgId: client.org_id } : null;
}
