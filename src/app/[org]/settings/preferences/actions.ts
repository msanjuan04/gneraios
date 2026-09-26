"use server";

import { createClient } from "@/lib/supabase/server";
import { setLocale } from "@/server/preferences";
import type { ActionResult } from "@/lib/action-result";
import { dbFailure, invalidInput, memberContext, revalidateSettings } from "@/server/action-utils";
import { type ProfileInput, profileSchema } from "./schema";

/** Guarda el perfil propio en esta org y aplica el idioma (cookie y resto de orgs). */
export async function saveProfile(slug: string, input: ProfileInput): Promise<ActionResult> {
  const ctx = await memberContext(slug);
  if (!ctx) return invalidInput();
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) return invalidInput();

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_my_profile", {
    p_org: ctx.org.id,
    p_full_name: parsed.data.full_name,
    p_initials: parsed.data.initials,
    p_locale: parsed.data.locale,
  });
  // 23514: las iniciales no pasan el check de la tabla (p. ej. al pasarlas a mayúsculas).
  if (error) return dbFailure(error, "saveProfile", (e) => (e.code === "23514" ? "validation.initials" : undefined));

  await setLocale(parsed.data.locale);
  revalidateSettings(ctx.org.slug, "preferences");
  return { ok: true };
}
