"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { emptyToNull } from "@/lib/validation/fiscal";
import { deliverInvitation, type InviteDelivery } from "@/server/invitations";
import type { ActionResult } from "@/lib/action-result";
import {
  dbFailure,
  failure,
  forbidden,
  idSchema,
  invalidInput,
  ownerContext,
  revalidateSettings,
} from "@/server/action-utils";
import {
  INVITATION_TTL_MS,
  type InvitationInput,
  invitationSchema,
  type MemberAccessInput,
  memberAccessSchema,
  type MemberRoleInput,
  memberRoleSchema,
} from "./schema";

type Delivered = ActionResult<{ delivery: InviteDelivery; email: string }>;

// El trigger `members_keep_an_owner` lanza P0001 si la org se quedaría sin owner activo.
const knownMemberErrors = (error: PostgrestError) => (error.code === "P0001" ? "settings.team.lastOwner" : undefined);

const expiresAt = () => new Date(Date.now() + INVITATION_TTL_MS).toISOString();

/** Invita por email (o renueva la invitación pendiente) y envía el enlace de acceso. */
export async function inviteMember(slug: string, input: InvitationInput): Promise<Delivered> {
  const ctx = await ownerContext(slug);
  if (!ctx) return forbidden();
  const parsed = invitationSchema.safeParse(input);
  if (!parsed.success) return invalidInput();

  const { email, full_name, role } = parsed.data;
  const supabase = await createClient();
  const { data: existing, error: loadError } = await supabase
    .from("member_invitations")
    .select("id, accepted_at")
    .eq("org_id", ctx.org.id)
    .eq("email", email)
    .maybeSingle();
  if (loadError) return dbFailure(loadError, "inviteMember.load");
  // Ya entró con esa invitación: si ahora no tiene acceso, se le devuelve desde la lista.
  if (existing?.accepted_at) return failure("settings.team.alreadyMember");

  const row = { role, full_name: emptyToNull(full_name), expires_at: expiresAt() };
  const { error } = existing
    ? await supabase.from("member_invitations").update(row).eq("id", existing.id).eq("org_id", ctx.org.id)
    : await supabase.from("member_invitations").insert({ ...row, org_id: ctx.org.id, email });
  if (error) return dbFailure(error, "inviteMember.save");

  const delivery = await deliverInvitation(email);
  revalidateSettings(ctx.org.slug, "team");
  return { ok: true, delivery, email };
}

/** Vuelve a enviar el enlace y alarga la caducidad otros 14 días. */
export async function resendInvitation(slug: string, invitationId: string): Promise<Delivered> {
  const ctx = await ownerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(invitationId);
  if (!id.success) return invalidInput();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("member_invitations")
    .update({ expires_at: expiresAt() })
    .eq("id", id.data)
    .eq("org_id", ctx.org.id)
    .is("accepted_at", null)
    .select("email");
  if (error) return dbFailure(error, "resendInvitation");
  const invitation = data[0];
  if (!invitation) return failure("settings.team.inviteNotFound");

  const delivery = await deliverInvitation(invitation.email);
  revalidateSettings(ctx.org.slug, "team");
  return { ok: true, delivery, email: invitation.email };
}

/** Retira una invitación pendiente (las invitaciones sí se borran: no son datos maestros). */
export async function revokeInvitation(slug: string, invitationId: string): Promise<ActionResult> {
  const ctx = await ownerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(invitationId);
  if (!id.success) return invalidInput();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("member_invitations")
    .delete()
    .eq("id", id.data)
    .eq("org_id", ctx.org.id)
    .is("accepted_at", null)
    .select("id");
  if (error) return dbFailure(error, "revokeInvitation");
  if (data.length === 0) return failure("settings.team.inviteNotFound");

  revalidateSettings(ctx.org.slug, "team");
  return { ok: true };
}

/** Cambia el rol de un miembro. La base de datos impide quedarse sin owner activo. */
export async function changeMemberRole(slug: string, input: MemberRoleInput): Promise<ActionResult> {
  const ctx = await ownerContext(slug);
  if (!ctx) return forbidden();
  const parsed = memberRoleSchema.safeParse(input);
  if (!parsed.success) return invalidInput();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("members")
    .update({ role: parsed.data.role })
    .eq("id", parsed.data.member_id)
    .eq("org_id", ctx.org.id)
    .select("id");
  if (error) return dbFailure(error, "changeMemberRole", knownMemberErrors);
  if (data.length === 0) return failure("settings.team.memberNotFound");

  revalidateSettings(ctx.org.slug, "team");
  return { ok: true };
}

/** Quita o devuelve el acceso a un miembro. Nadie se quita el acceso a sí mismo. */
export async function setMemberActive(slug: string, input: MemberAccessInput): Promise<ActionResult> {
  const ctx = await ownerContext(slug);
  if (!ctx) return forbidden();
  const parsed = memberAccessSchema.safeParse(input);
  if (!parsed.success) return invalidInput();
  if (!parsed.data.active && parsed.data.member_id === ctx.member.id) {
    return failure("settings.team.cannotDeactivateSelf");
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("members")
    .update({ is_active: parsed.data.active })
    .eq("id", parsed.data.member_id)
    .eq("org_id", ctx.org.id)
    .select("id");
  if (error) return dbFailure(error, "setMemberActive", knownMemberErrors);
  if (data.length === 0) return failure("settings.team.memberNotFound");

  revalidateSettings(ctx.org.slug, "team");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Seguridad del acceso: verificación en dos pasos (TOTP)
// ---------------------------------------------------------------------------

/** Miembros activos de la org con su usuario de Auth (con RLS: solo miembros de la org). */
async function activeMembers(orgId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("members").select("id, user_id, full_name, is_active").eq("org_id", orgId);
  if (error) throw error;
  return data;
}

/** ¿Tiene el usuario algún factor TOTP verificado? (API admin de Supabase Auth.) */
async function hasVerifiedFactor(userId: string): Promise<boolean> {
  const { data, error } = await createAdminClient().auth.admin.mfa.listFactors({ userId });
  if (error) throw error;
  return data.factors.some((f) => f.status === "verified");
}

/**
 * Restablece la verificación en dos pasos de un miembro (p. ej. ha perdido el móvil): borra sus
 * factores y cierra todas sus sesiones. En su próxima entrada la vuelve a configurar.
 */
export async function resetMemberMfa(slug: string, memberId: string): Promise<ActionResult> {
  const ctx = await ownerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(memberId);
  if (!id.success) return invalidInput();

  const member = (await activeMembers(ctx.org.id)).find((m) => m.id === id.data);
  if (!member) return failure("settings.team.memberNotFound");

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.mfa.listFactors({ userId: member.user_id });
  if (error) {
    console.error("[team] resetMemberMfa.list", error);
    return failure("common.errorGeneric");
  }
  for (const factor of data.factors) {
    const { error: deleteError } = await admin.auth.admin.mfa.deleteFactor({ id: factor.id, userId: member.user_id });
    if (deleteError) {
      console.error("[team] resetMemberMfa.delete", deleteError);
      return failure("common.errorGeneric");
    }
  }
  // Sus sesiones abiertas (también las de otros dispositivos) dejan de valer.
  const supabase = await createClient();
  const { error: revokeError } = await supabase.rpc("revoke_member_sessions", { p_org: ctx.org.id, p_member: member.id });
  if (revokeError) return dbFailure(revokeError, "resetMemberMfa.revoke");

  revalidateSettings(ctx.org.slug, "team");
  return { ok: true };
}

/**
 * Exige (o deja de exigir) la verificación en dos pasos a todos, también en la base de datos. Solo
 * se enciende desde una sesión que ya la ha pasado y si todos los miembros activos la tienen: así
 * nadie se queda fuera.
 */
export async function setRequireMfa(slug: string, enabled: boolean): Promise<ActionResult> {
  const ctx = await ownerContext(slug);
  if (!ctx) return forbidden();
  if (typeof enabled !== "boolean") return invalidInput();

  const supabase = await createClient();
  if (enabled) {
    const { data } = await supabase.auth.getClaims();
    if (data?.claims.aal !== "aal2") return failure("settings.team.security.needOwnMfa");
    const members = (await activeMembers(ctx.org.id)).filter((m) => m.is_active);
    const missing: string[] = [];
    for (const m of members) if (!(await hasVerifiedFactor(m.user_id))) missing.push(m.full_name);
    if (missing.length > 0) return failure("settings.team.security.missingMembers", { names: missing.join(", ") });
  }

  const { error } = await supabase.from("orgs").update({ require_mfa: enabled }).eq("id", ctx.org.id);
  if (error) {
    if (error.hint === "mfa_required_to_enable") return failure("settings.team.security.needOwnMfa");
    return dbFailure(error, "setRequireMfa");
  }
  revalidateSettings(ctx.org.slug, "team");
  return { ok: true };
}
