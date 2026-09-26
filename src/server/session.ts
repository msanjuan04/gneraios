import "server-only";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { isSupabaseConfigured } from "@/lib/env";
import type { Enums, Tables } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

export type MemberRole = Enums<"member_role">;
export type SessionUser = { id: string; email: string | null };
export type OrgSummary = { id: string; slug: string; name: string; role: MemberRole };
export type CurrentMember = {
  id: string;
  fullName: string;
  initials: string;
  role: MemberRole;
  locale: Enums<"app_locale">;
};
export type OrgContext = {
  user: SessionUser;
  org: Tables<"orgs">;
  member: CurrentMember;
  orgs: OrgSummary[];
};

const ROLE_RANK: Record<MemberRole, number> = { viewer: 0, partner: 1, owner: 2 };

export function hasRole(role: MemberRole, min: MemberRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

/** Usuario de la sesión (verificado a partir del JWT). Una sola vez por petición. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;
  return { id: claims.sub, email: typeof claims.email === "string" ? claims.email : null };
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

/** Organizaciones a las que pertenece el usuario (RLS solo devuelve las suyas). */
export const getMyOrgs = cache(async (): Promise<OrgSummary[]> => {
  const user = await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("members")
    .select("role, orgs!inner(id, slug, name)")
    .eq("user_id", user.id)
    .eq("is_active", true);
  if (error) throw error;
  return (data ?? [])
    .map((m) => ({ id: m.orgs.id, slug: m.orgs.slug, name: m.orgs.name, role: m.role }))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
});

/** Contexto de una org por su slug. 404 si no existe o el usuario no es miembro. */
export const getOrgContext = cache(async (slug: string): Promise<OrgContext> => {
  const user = await requireUser();
  const supabase = await createClient();

  const { data: org, error } = await supabase.from("orgs").select("*").eq("slug", slug).maybeSingle();
  if (error) throw error;
  if (!org) notFound();

  const { data: member, error: memberError } = await supabase
    .from("members")
    .select("id, full_name, initials, role, locale")
    .eq("org_id", org.id)
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();
  if (memberError) throw memberError;
  if (!member) notFound();

  return {
    user,
    org,
    member: {
      id: member.id,
      fullName: member.full_name,
      initials: member.initials,
      role: member.role,
      locale: member.locale,
    },
    orgs: await getMyOrgs(),
  };
});
