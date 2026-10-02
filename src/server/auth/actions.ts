"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { createClient } from "@/lib/supabase/server";
import { failure, forbidden, idSchema, invalidInput, memberContext, ownerContext } from "@/server/action-utils";
import { issueAccessCode, revokeDevice, setChosenAccessCode } from "./access-code";

// Códigos de acceso y dispositivos de confianza desde Ajustes. El código solo se devuelve aquí,
// una vez, para enseñarlo en pantalla: no se guarda en claro en ningún sitio.

/** El usuario de Auth de un miembro de esta org (con RLS: solo miembros de la org). */
async function memberUserId(orgId: string, memberId: string): Promise<{ userId: string; name: string } | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("members").select("user_id, full_name").eq("org_id", orgId).eq("id", memberId).maybeSingle();
  return data ? { userId: data.user_id, name: data.full_name } : null;
}

/** Un código nuevo para mí (el anterior deja de valer). */
export async function generateMyAccessCode(slug: string): Promise<ActionResult<{ code: string }>> {
  const ctx = await memberContext(slug);
  if (!ctx) return forbidden();
  const code = await issueAccessCode(ctx.user.id, ctx.user.id);
  revalidatePath(`/${ctx.org.slug}/settings/preferences`);
  return { ok: true, code };
}

/** Compatibilidad: la identidad solo puede rotar su propio código, nunca la de otro socio. */
export async function generateMemberAccessCode(slug: string, memberId: string): Promise<ActionResult<{ code: string }>> {
  const ctx = await ownerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(memberId);
  if (!id.success) return invalidInput();
  const member = await memberUserId(ctx.org.id, id.data);
  if (!member) return failure("settings.team.memberNotFound");
  if (member.userId !== ctx.user.id) return failure("settings.accessCode.selfOnly");
  const code = await issueAccessCode(ctx.user.id, ctx.user.id);
  revalidatePath(`/${ctx.org.slug}/settings/team`);
  return { ok: true, code };
}

/** Elegir mi propio código de 8 cifras (el anterior deja de valer). */
export async function setMyAccessCode(slug: string, code: string, repeat: string): Promise<ActionResult> {
  const ctx = await memberContext(slug);
  if (!ctx) return forbidden();
  if (typeof code !== "string" || typeof repeat !== "string" || code.length > 20 || repeat.length > 20) return invalidInput();
  const result = await setChosenAccessCode(ctx.user.id, code, repeat);
  if (!result.ok) return failure(`settings.accessCode.chooseErrors.${result.reason}`);
  revalidatePath(`/${ctx.org.slug}/settings/preferences`);
  return { ok: true };
}

/** Quitar uno de mis dispositivos de confianza. */
export async function revokeMyDevice(slug: string, deviceId: string): Promise<ActionResult> {
  const ctx = await memberContext(slug);
  const id = idSchema.safeParse(deviceId);
  if (!ctx || !id.success) return invalidInput();
  if (!(await revokeDevice(ctx.user.id, id.data))) return failure("common.errorGeneric");
  revalidatePath(`/${ctx.org.slug}/settings/preferences`);
  return { ok: true };
}

/**
 * Un owner quita un dispositivo de confianza de un socio (p. ej. un móvil perdido) y, si no es él
 * mismo, le cierra las sesiones abiertas: en sus otros dispositivos de confianza vuelve a entrar
 * solo con el código.
 */
export async function revokeMemberDevice(slug: string, memberId: string, deviceId: string): Promise<ActionResult> {
  const ctx = await ownerContext(slug);
  if (!ctx) return forbidden();
  const member = idSchema.safeParse(memberId);
  const device = idSchema.safeParse(deviceId);
  if (!member.success || !device.success) return invalidInput();
  const target = await memberUserId(ctx.org.id, member.data);
  if (!target) return failure("settings.team.memberNotFound");
  if (!(await revokeDevice(target.userId, device.data))) return failure("common.errorGeneric");
  if (target.userId !== ctx.user.id) {
    const supabase = await createClient();
    const { error } = await supabase.rpc("revoke_member_sessions", { p_org: ctx.org.id, p_member: member.data });
    if (error) console.error("[auth] revoke sessions", error.code);
  }
  revalidatePath(`/${ctx.org.slug}/settings/team`);
  return { ok: true };
}
