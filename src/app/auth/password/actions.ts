"use server";

import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { PASSWORD_MAX_LENGTH, passwordProblems } from "@/lib/auth-policy";
import { createClient } from "@/lib/supabase/server";

export type PasswordResult = { ok: true } | { ok: false; error: string };

const schema = z.object({ password: z.string().max(PASSWORD_MAX_LENGTH * 4), confirm: z.string().max(PASSWORD_MAX_LENGTH * 4) });

/** Crea o cambia la contraseña del usuario de la sesión (invitación, recuperación o cambio). */
export async function updatePassword(input: { password: string; confirm: string }): Promise<PasswordResult> {
  const t = await getTranslations("auth.password");
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("errorWeak") };
  const { password, confirm } = parsed.data;
  if (passwordProblems(password).length > 0) return { ok: false, error: t("errorWeak") };
  if (password !== confirm) return { ok: false, error: t("errorMismatch") };

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return { ok: false, error: t("errorSession") };

  const { error } = await supabase.auth.updateUser({ password });
  if (!error) return { ok: true };
  switch (error.code) {
    case "weak_password":
      // En producción Supabase rechaza también las contraseñas que ya se han filtrado.
      return { ok: false, error: t("errorLeaked") };
    case "same_password":
      return { ok: false, error: t("errorSame") };
    case "reauthentication_needed":
    case "insufficient_aal":
      return { ok: false, error: t("errorReauth") };
    default:
      console.error("[auth] updatePassword", error);
      return { ok: false, error: t("errorGeneric") };
  }
}
