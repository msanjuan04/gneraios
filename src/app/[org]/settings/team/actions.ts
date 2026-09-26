"use server";

import type { PostgrestError } from "@supabase/supabase-js";
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
