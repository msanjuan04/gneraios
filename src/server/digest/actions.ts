"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { dbFailure, failure, invalidInput, memberContext } from "@/server/action-utils";
import { getEmailProvider } from "@/server/email/provider";
import { deliverDigest, renderDigestForMember } from "./run";

/** Recibir (o no) el resumen de los lunes. Cada miembro decide por sí mismo. */
export async function setWeeklyDigest(slug: string, enabled: boolean): Promise<ActionResult> {
  const ctx = await memberContext(slug);
  const parsed = z.boolean().safeParse(enabled);
  if (!ctx || !parsed.success) return invalidInput();
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_my_weekly_digest", { p_org: ctx.org.id, p_enabled: parsed.data });
  if (error) return dbFailure(error, "setWeeklyDigest");
  revalidatePath(`/${ctx.org.slug}/settings/preferences`);
  return { ok: true };
}

/** El resumen de esta semana, ahora, a mi email y a mis dispositivos (para verlo sin esperar al lunes). */
export async function sendMyDigestNow(slug: string): Promise<ActionResult<{ email: boolean; pushes: number }>> {
  const ctx = await memberContext(slug);
  if (!ctx) return invalidInput();
  if (!getEmailProvider()) return failure("settings.preferences.digest.noEmail");
  const member = { id: ctx.member.id, user_id: ctx.user.id, full_name: ctx.member.fullName, locale: ctx.member.locale };
  // Los datos, con la sesión del socio (RLS); el envío, con la clave secreta (email y claves push).
  const rendered = await renderDigestForMember(await createClient(), ctx.org, member);
  const delivered = await deliverDigest(createAdminClient(), ctx.org, member, rendered);
  return { ok: true, ...delivered };
}
