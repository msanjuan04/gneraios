import { CircleCheck, CircleX, ShieldQuestion } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Isotype } from "@/components/brand/logo";
import { SpaceBackdrop } from "@/components/brand/space-backdrop";
import { Button } from "@/components/ui/button";
import { describeDeviceConfirmation } from "@/server/auth/access-code";
import { confirmDeviceAction } from "./actions";

export const metadata: Metadata = { title: "Confirmar dispositivo", robots: { index: false, follow: false }, referrer: "no-referrer" };

/**
 * El enlace del email de "dispositivo nuevo". Abrirlo no confirma nada (los antivirus del correo
 * abren los enlaces solos): hay que pulsar "Sí, soy yo" viendo qué dispositivo es.
 */
export default async function DevicePage(props: PageProps<"/auth/device">) {
  const searchParams = await props.searchParams;
  const t = await getTranslations("auth.device");
  const token = typeof searchParams.token === "string" ? searchParams.token : "";
  const state = searchParams.done
    ? ({ status: "confirmed" } as const)
    : searchParams.invalid || !token
      ? ({ status: "invalid" } as const)
      : await describeDeviceConfirmation(token);

  return (
    <SpaceBackdrop>
      <main className="mx-auto flex min-h-svh w-full max-w-md flex-col justify-center px-6 py-16 text-center">
        <Isotype size={64} priority className="mx-auto mb-8 drop-shadow-[0_10px_40px_rgb(46_128_255/0.35)]" />
        {state.status === "ready" && (
          <>
            <ShieldQuestion className="mx-auto size-8 text-primary" />
            <h1 className="mt-4 text-3xl font-extrabold heading-tight">{t("title", { name: state.name })}</h1>
            <p className="mt-3 text-muted-foreground">{t("body", { device: state.label })}</p>
            <form action={confirmDeviceAction} className="mt-8 space-y-3">
              <input type="hidden" name="token" value={token} />
              <Button type="submit" size="lg" className="w-full">
                {t("confirm")}
              </Button>
            </form>
            <p className="mt-6 text-xs text-muted-foreground">{t("notMe")}</p>
          </>
        )}
        {state.status === "confirmed" && (
          <>
            <CircleCheck className="mx-auto size-8 text-success" />
            <h1 className="mt-4 text-3xl font-extrabold heading-tight">{t("doneTitle")}</h1>
            <p className="mt-3 text-muted-foreground">{t("doneBody")}</p>
            <Button asChild variant="secondary" className="mt-8">
              <Link href="/login">{t("toLogin")}</Link>
            </Button>
          </>
        )}
        {state.status === "invalid" && (
          <>
            <CircleX className="mx-auto size-8 text-destructive" />
            <h1 className="mt-4 text-3xl font-extrabold heading-tight">{t("invalidTitle")}</h1>
            <p className="mt-3 text-muted-foreground">{t("invalidBody")}</p>
            <Button asChild variant="secondary" className="mt-8">
              <Link href="/login">{t("toLogin")}</Link>
            </Button>
          </>
        )}
      </main>
    </SpaceBackdrop>
  );
}
