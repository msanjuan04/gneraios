import type { EmailOtpType } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { AUTH_NEXT_COOKIE, safeNextPath } from "@/lib/safe-next";
import { createClient } from "@/lib/supabase/server";

/**
 * Destino de los enlaces de acceso e invitación. Las plantillas de email envían
 * un token_hash, que se verifica aquí en el servidor: funciona aunque el enlace
 * se abra en otro navegador o en el móvil.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const tokenHash = params.get("token_hash");
  const type = params.get("type") as EmailOtpType | null;
  const code = params.get("code");

  const supabase = await createClient();
  let ok = false;
  if (tokenHash && type) {
    ok = !(await supabase.auth.verifyOtp({ type, token_hash: tokenHash })).error;
  } else if (code) {
    ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  }

  if (!ok) redirect("/login?error=link");

  const cookieStore = await cookies();
  const next = safeNextPath(cookieStore.get(AUTH_NEXT_COOKIE)?.value) ?? "/";
  cookieStore.delete(AUTH_NEXT_COOKIE);
  redirect(next);
}
