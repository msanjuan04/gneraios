import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Isotype } from "@/components/brand/logo";
import { SpaceBackdrop } from "@/components/brand/space-backdrop";
import { Button } from "@/components/ui/button";
import { deviceConfirmationByEmail } from "@/lib/auth-policy";
import { isSupabaseConfigured, publicEnv } from "@/lib/env";
import { safeNextPath } from "@/lib/safe-next";
import { WELCOME_COOKIE } from "@/lib/welcome";
import { createClient } from "@/lib/supabase/server";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar" };

const LOCAL_MAILPIT_URL = "http://127.0.0.1:54324";

export default async function LoginPage(props: PageProps<"/login">) {
  const searchParams = await props.searchParams;
  const t = await getTranslations("auth");
  const configured = isSupabaseConfigured();

  if (configured) {
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    // Recién entrado con el código, la página se queda para la bienvenida (y ella navega).
    const welcoming = Boolean((await cookies()).get(WELCOME_COOKIE));
    if (data?.claims && !welcoming) redirect("/");
  }

  const next = safeNextPath(typeof searchParams.next === "string" ? searchParams.next : null) ?? undefined;
  const isLocal = /^http:\/\/(127\.0\.0\.1|localhost)/.test(publicEnv.NEXT_PUBLIC_SUPABASE_URL ?? "");

  return (
    <SpaceBackdrop>
      <main className="mx-auto flex min-h-svh w-full max-w-xl flex-col justify-center px-4 py-16 sm:px-6">
        {/* El isotipo con su halo y una órbita que gira despacio: el cielo de gnerai.com. */}
        <div className="relative mx-auto mb-10 size-[76px]">
          <div
            aria-hidden
            className="gos-halo pointer-events-none absolute -inset-12 rounded-full bg-[radial-gradient(closest-side,rgb(46_128_255/0.32),transparent)]"
          />
          <div
            aria-hidden
            className="gos-orbit pointer-events-none absolute -inset-5 rounded-full opacity-80 [background:conic-gradient(from_0deg,transparent_0deg,rgb(46_128_255/0.9)_50deg,transparent_110deg,transparent_200deg,rgb(124_111_255/0.7)_250deg,transparent_300deg)] [mask:radial-gradient(farthest-side,transparent_calc(100%-1.5px),#000_calc(100%-1px))]"
          />
          <Isotype size={76} priority className="gos-logo-in relative drop-shadow-[0_10px_40px_rgb(46_128_255/0.45)]" />
        </div>
        <h1 className="gos-rise text-center text-4xl font-extrabold heading-tight sm:text-5xl" style={{ animationDelay: "80ms" }}>
          {t("title")}
        </h1>
        <p className="gos-rise mt-4 text-center text-muted-foreground" style={{ animationDelay: "140ms" }}>
          {t("subtitle")}
        </p>

        {configured ? (
          <LoginForm
            next={next}
            linkError={searchParams.error ? t("errorLink") : undefined}
            localMailUrl={isLocal ? LOCAL_MAILPIT_URL : undefined}
            deviceConfirmation={deviceConfirmationByEmail()}
          />
        ) : (
          <SetupRequired />
        )}

        <p className="mt-16 text-center text-xs text-muted-foreground">{t("footer")}</p>
      </main>
    </SpaceBackdrop>
  );
}

async function SetupRequired() {
  const t = await getTranslations("auth");
  return (
    <div className="mt-10 rounded-2xl border bg-card/60 p-6 text-sm backdrop-blur">
      <h2 className="text-base font-bold">{t("setupTitle")}</h2>
      <p className="mt-2 text-muted-foreground">{t("setupBody")}</p>
      <ol className="mt-4 space-y-3 text-muted-foreground">
        <li>
          <span className="font-semibold text-foreground">1.</span> {t("setupLocal")}{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 text-foreground">pnpm db:start</code>. {t("setupLocalThen")}{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 text-foreground">.env.local</code>.
        </li>
        <li>
          <span className="font-semibold text-foreground">2.</span> {t("setupCloud")}{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 text-foreground">.env.local</code>.
        </li>
      </ol>
      <Button asChild variant="secondary" className="mt-6 w-full">
        <Link href="/preview">{t("setupPreview")}</Link>
      </Button>
    </div>
  );
}
