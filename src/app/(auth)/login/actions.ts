"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { PASSWORD_MAX_LENGTH } from "@/lib/auth-policy";
import { publicEnv } from "@/lib/env";
import { AUTH_NEXT_COOKIE, safeNextPath } from "@/lib/safe-next";
import { createClient } from "@/lib/supabase/server";
import { WELCOME_COOKIE, WELCOME_NAME_MAX } from "@/lib/welcome";
import { signInWithCode } from "@/server/auth/access-code";

// Entrada de los socios. Tres vías, las tres sin revelar nunca si un email tiene cuenta: con
// contraseña (la principal), con un enlace por email y «He olvidado la contraseña». Supabase Auth
// limita los intentos por IP; el segundo paso (TOTP) lo pide después el proxy.

export type LoginState =
  | { status: "idle" }
  | { status: "sent"; email: string; kind: "link" | "reset" | "device" }
  | { status: "error"; message: string; reason?: "invalid" | "rate_limited" | "error" }
  // Entrada con código correcta: la pantalla hace la animación de bienvenida y luego navega.
  | { status: "success"; next: string; name: string };

const emailSchema = z.email().transform((e) => e.trim().toLowerCase());

function isRateLimited(error: { status?: number; code?: string }): boolean {
  return error.status === 429 || error.code === "over_request_rate_limit" || error.code === "over_email_send_rate_limit";
}

/** El destino tras entrar se guarda en una cookie: la plantilla del email siempre apunta a /auth/confirm. */
async function rememberNext(next: FormDataEntryValue | null): Promise<string | null> {
  const safe = safeNextPath(typeof next === "string" ? next : null);
  if (safe) (await cookies()).set(AUTH_NEXT_COOKIE, safe, { httpOnly: true, sameSite: "lax", maxAge: 3600, path: "/" });
  return safe;
}

export async function signInWithPassword(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const t = await getTranslations("auth");
  const email = emailSchema.safeParse(String(formData.get("email") ?? "").trim());
  const password = String(formData.get("password") ?? "");
  if (!email.success) return { status: "error", message: t("errorInvalidEmail") };
  if (password.length === 0 || password.length > PASSWORD_MAX_LENGTH * 4) return { status: "error", message: t("errorCredentials") };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: email.data, password });
  if (error) {
    if (isRateLimited(error)) return { status: "error", message: t("errorRateLimit") };
    // Mismo mensaje exista o no el email, esté o no confirmado: no se da pista a quien prueba.
    return { status: "error", message: t("errorCredentials") };
  }
  const next = safeNextPath(typeof formData.get("next") === "string" ? String(formData.get("next")) : null);
  redirect(next ?? "/");
}

export async function sendMagicLink(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const t = await getTranslations("auth");
  const email = emailSchema.safeParse(String(formData.get("email") ?? "").trim());
  if (!email.success) return { status: "error", message: t("errorInvalidEmail") };
  await rememberNext(formData.get("next"));

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: email.data,
    // Solo cuentas que ya existen (se entra por invitación): nunca crea una nueva.
    options: { shouldCreateUser: false, emailRedirectTo: `${publicEnv.NEXT_PUBLIC_APP_URL}/auth/confirm` },
  });
  if (error && isRateLimited(error)) return { status: "error", message: t("errorRateLimit") };
  if (error && error.status !== 400 && error.status !== 422) {
    console.error("[auth] sendMagicLink", error.code, error.status);
    return { status: "error", message: t("errorSend") };
  }
  // Exista o no la cuenta, la respuesta es la misma.
  return { status: "sent", email: email.data, kind: "link" };
}

export async function sendPasswordReset(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const t = await getTranslations("auth");
  const email = emailSchema.safeParse(String(formData.get("email") ?? "").trim());
  if (!email.success) return { status: "error", message: t("errorInvalidEmail") };

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email.data, {
    redirectTo: `${publicEnv.NEXT_PUBLIC_APP_URL}/auth/confirm`,
  });
  if (error && isRateLimited(error)) return { status: "error", message: t("errorRateLimit") };
  if (error) console.error("[auth] sendPasswordReset", error.code, error.status);
  return { status: "sent", email: email.data, kind: "reset" };
}

/** Entrar con el código personal de 8 cifras (la vía de los socios). */
export async function signInWithAccessCode(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const t = await getTranslations("auth");
  const code = String(formData.get("code") ?? "");
  const result = await signInWithCode(code, (await headers()).get("user-agent"));
  switch (result.status) {
    case "ok": {
      const next = safeNextPath(typeof formData.get("next") === "string" ? String(formData.get("next")) : null);
      const name = (result.name.split(/\s+/)[0] || result.name).slice(0, WELCOME_NAME_MAX);
      // Mientras exista, /login no redirige a la app (la sesión ya está abierta y Next vuelve a
      // pintar la página): así se ve la bienvenida, y la app la disuelve al llegar.
      (await cookies()).set(WELCOME_COOKIE, encodeURIComponent(name), {
        path: "/",
        maxAge: 30,
        sameSite: "lax",
        secure: (publicEnv.NEXT_PUBLIC_APP_URL ?? "").startsWith("https://"),
      });
      return { status: "success", next: next ?? "/", name };
    }
    case "device_pending":
      return { status: "sent", email: result.email, kind: "device" };
    case "invalid":
      return { status: "error", message: t("code.errorInvalid"), reason: "invalid" };
    case "rate_limited":
      return { status: "error", message: t("errorRateLimit"), reason: "rate_limited" };
    default:
      return { status: "error", message: t("code.errorGeneric"), reason: "error" };
  }
}
