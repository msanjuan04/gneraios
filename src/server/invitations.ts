import "server-only";
import { createClient } from "@supabase/supabase-js";
import { publicEnv, requireSupabaseEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

export type InviteDelivery = "sent" | "not_configured" | "failed";

/**
 * Envía el email de una invitación ya guardada en `member_invitations`.
 * Al entrar con ese email, `accept_pending_invitations()` le da acceso a la org.
 */
export async function deliverInvitation(email: string): Promise<InviteDelivery> {
  if (!process.env.SUPABASE_SECRET_KEY) return "not_configured";
  const redirectTo = `${publicEnv.NEXT_PUBLIC_APP_URL}/auth/confirm`;

  const { error } = await createAdminClient().auth.admin.inviteUserByEmail(email, { redirectTo });
  if (!error) return "sent";

  // Si ya tiene cuenta, basta con un enlace de acceso normal.
  if (error.code === "email_exists" || error.status === 422) {
    const { url, key } = requireSupabaseEnv();
    const anon = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error: otpError } = await anon.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, emailRedirectTo: redirectTo },
    });
    return otpError ? "failed" : "sent";
  }
  return "failed";
}

/** Envía varias invitaciones y dice si alguna no ha salido. */
export async function deliverInvitations(emails: string[]): Promise<InviteDelivery> {
  if (emails.length === 0) return "sent";
  const results = await Promise.all(emails.map(deliverInvitation));
  if (results.includes("not_configured")) return "not_configured";
  return results.includes("failed") ? "failed" : "sent";
}
