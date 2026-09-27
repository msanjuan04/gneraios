import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Isotype } from "@/components/brand/logo";
import { SpaceBackdrop } from "@/components/brand/space-backdrop";
import { safeNextPath } from "@/lib/safe-next";
import { createClient } from "@/lib/supabase/server";
import { PasswordForm } from "./password-form";

export const metadata: Metadata = { title: "Contraseña", robots: { index: false, follow: false } };

const MODES = ["setup", "reset", "change"] as const;

/**
 * Crear o cambiar la contraseña: al aceptar la invitación (setup), desde el enlace de «He olvidado
 * la contraseña» (reset) o desde Preferencias (change). Si el usuario ya tiene la verificación en
 * dos pasos, antes la pasa: una contraseña no se cambia con medio acceso.
 */
export default async function PasswordPage(props: PageProps<"/auth/password">) {
  const searchParams = await props.searchParams;
  const t = await getTranslations("auth.password");
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect("/login?error=link");

  const mode = MODES.find((m) => m === searchParams.mode) ?? "change";
  const next = safeNextPath(typeof searchParams.next === "string" ? searchParams.next : null) ?? "/";
  if (data.claims.aal !== "aal2") {
    const { data: level } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (level?.nextLevel === "aal2") {
      redirect(`/auth/mfa?next=${encodeURIComponent(`/auth/password?mode=${mode}&next=${encodeURIComponent(next)}`)}`);
    }
  }

  return (
    <SpaceBackdrop>
      <main className="mx-auto flex min-h-svh w-full max-w-md flex-col justify-center px-6 py-16">
        <Isotype size={64} priority className="mx-auto mb-8 drop-shadow-[0_10px_40px_rgb(46_128_255/0.35)]" />
        <h1 className="text-center text-3xl font-extrabold heading-tight sm:text-4xl">{t(`titles.${mode}`)}</h1>
        <p className="mt-3 text-center text-muted-foreground">{t(`subtitles.${mode}`)}</p>
        <PasswordForm next={next} />
      </main>
    </SpaceBackdrop>
  );
}
