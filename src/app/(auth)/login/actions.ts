"use server";

import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { publicEnv } from "@/lib/env";
import { AUTH_NEXT_COOKIE, safeNextPath } from "@/lib/safe-next";
import { createClient } from "@/lib/supabase/server";

export type LoginState =
  | { status: "idle" }
  | { status: "sent"; email: string }
  | { status: "error"; message: string };

const loginSchema = z.object({
  email: z.email().transform((e) => e.trim().toLowerCase()),
  next: z.string().optional(),
});

export async function sendMagicLink(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const t = await getTranslations("auth");
  const parsed = loginSchema.safeParse({
    email: String(formData.get("email") ?? "").trim(),
    next: formData.get("next") ? String(formData.get("next")) : undefined,
  });
  if (!parsed.success) return { status: "error", message: t("errorInvalidEmail") };

  // El destino se guarda en una cookie: la plantilla del email siempre apunta a /auth/confirm.
  const next = safeNextPath(parsed.data.next);
  if (next) {
    (await cookies()).set(AUTH_NEXT_COOKIE, next, { httpOnly: true, sameSite: "lax", maxAge: 3600, path: "/" });
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: { emailRedirectTo: `${publicEnv.NEXT_PUBLIC_APP_URL}/auth/confirm` },
  });
  if (error) return { status: "error", message: t("errorSend") };
  return { status: "sent", email: parsed.data.email };
}
