"use server";

import { cookies } from "next/headers";
import { isLocale, LOCALE_COOKIE } from "@/i18n/config";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

/** Cambia el idioma de la interfaz (cookie) y lo recuerda en todas las orgs del usuario. */
export async function setLocale(locale: string): Promise<void> {
  if (!isLocale(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });

  if (!isSupabaseConfigured()) return;
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return;
  const { data: memberships } = await supabase
    .from("members")
    .select("org_id, full_name, initials")
    .eq("user_id", data.claims.sub);
  for (const m of memberships ?? []) {
    await supabase.rpc("update_my_profile", {
      p_org: m.org_id,
      p_full_name: m.full_name,
      p_initials: m.initials,
      p_locale: locale,
    });
  }
}
