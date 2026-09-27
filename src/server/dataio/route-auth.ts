import "server-only";
import type { Tables } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser, hasRole, type MemberRole } from "@/server/session";

export type RouteOrg = {
  org: Tables<"orgs">;
  member: { id: string; role: MemberRole };
  db: Awaited<ReturnType<typeof createClient>>;
};

/**
 * Para las rutas de descarga y subida: la org del slug y el rol del usuario, leídos con su sesión
 * (RLS). Devuelve una respuesta de error si no hay sesión, si no es miembro o si no llega al rol.
 */
export async function routeOrg(slug: string, min: MemberRole): Promise<RouteOrg | Response> {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (!/^[a-z0-9-]{1,40}$/.test(slug)) return new Response("Not found", { status: 404 });
  const db = await createClient();
  const { data: org } = await db.from("orgs").select("*").eq("slug", slug).maybeSingle();
  if (!org) return new Response("Not found", { status: 404 });
  const { data: member } = await db
    .from("members")
    .select("id, role")
    .eq("org_id", org.id)
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();
  if (!member) return new Response("Not found", { status: 404 });
  if (!hasRole(member.role, min)) return new Response("Forbidden", { status: 403 });
  return { org, member, db };
}

/**
 * Una subida con la sesión en cookies tiene que venir de la propia app (como las Server Actions,
 * que Next ya comprueba): el Origin tiene que coincidir con el host.
 */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Content-Disposition con el nombre en ASCII y en UTF-8 (RFC 6266). */
export function attachment(filename: string): string {
  const ascii = filename.normalize("NFD").replace(/[^\x20-\x7e]/g, "").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
