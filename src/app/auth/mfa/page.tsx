import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Isotype } from "@/components/brand/logo";
import { SpaceBackdrop } from "@/components/brand/space-backdrop";
import { mfaRequired } from "@/lib/auth-policy";
import { safeNextPath } from "@/lib/safe-next";
import { createClient } from "@/lib/supabase/server";
import { MfaForm } from "./mfa-form";

export const metadata: Metadata = { title: "Verificación en dos pasos", robots: { index: false, follow: false } };

/** El segundo paso de la entrada: el código de la app de verificación (o darla de alta). */
export default async function MfaPage(props: PageProps<"/auth/mfa">) {
  const searchParams = await props.searchParams;
  const t = await getTranslations("auth.mfa");
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect("/login");

  const next = safeNextPath(typeof searchParams.next === "string" ? searchParams.next : null) ?? "/";
  // Ya en aal2: nada que hacer aquí.
  if (data.claims.aal === "aal2") redirect(next);

  const { data: level } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const enrolled = level?.nextLevel === "aal2";
  // Sin exigirla y sin tenerla configurada, se entra directamente (salvo que se active a propósito,
  // desde Preferencias: ?setup=1).
  if (!enrolled && !mfaRequired() && searchParams.setup !== "1") redirect(next);

  return (
    <SpaceBackdrop>
      <main className="mx-auto flex min-h-svh w-full max-w-md flex-col justify-center px-6 py-16">
        <Isotype size={64} priority className="mx-auto mb-8 drop-shadow-[0_10px_40px_rgb(46_128_255/0.35)]" />
        <h1 className="text-center text-3xl font-extrabold heading-tight sm:text-4xl">{enrolled ? t("challengeTitle") : t("enrollHeading")}</h1>
        <p className="mt-3 text-center text-muted-foreground">{enrolled ? t("challengeSubtitle") : t("enrollSubtitle")}</p>
        <MfaForm next={next} email={typeof data.claims.email === "string" ? data.claims.email : ""} />
      </main>
    </SpaceBackdrop>
  );
}
