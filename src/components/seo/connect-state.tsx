import { ChartNoAxesCombined, CircleCheck, CircleDashed, Handshake, KeyRound, Lock, Search, Sparkles, TrendingUp } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const BENEFITS = [
  { key: "search", icon: Search },
  { key: "traffic", icon: TrendingUp },
  { key: "opportunities", icon: Sparkles },
  { key: "business", icon: Handshake },
] as const;

const ENV = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "INTEGRATIONS_ENCRYPTION_KEY"] as const;

/**
 * Lo que se ve antes de tener datos: qué da el módulo y qué hace falta. Sin configuración, los pasos
 * en Google Cloud y las variables de entorno; configurado, el botón de conectar (solo owners).
 */
export async function ConnectState({
  variant,
  isOwner,
  startHref,
  missingEnv,
  redirectUri,
  demoHref,
  error,
}: {
  variant: "setup" | "connect" | "reconnect";
  isOwner: boolean;
  startHref: string;
  missingEnv: readonly string[];
  redirectUri: string;
  /** La org demo (con datos de ejemplo), si el usuario la tiene. */
  demoHref: string | null;
  /** Mensaje de un intento de conexión fallido, ya traducido. */
  error?: string | null;
}) {
  const t = await getTranslations("seo.connect");

  return (
    <div className="mt-4 w-full md:mt-8">
      <div className="rounded-3xl border bg-card/50 px-6 py-10 text-center sm:px-10">
        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-brand-gradient text-white shadow-[0_10px_40px_rgb(46_128_255/0.35)]">
          <ChartNoAxesCombined className="size-6" />
        </div>
        <h2 className="mt-6 text-2xl font-extrabold heading-tight md:text-3xl">{t(`${variant}.title`)}</h2>
        <p className="mt-3 text-muted-foreground">{t(`${variant}.body`)}</p>

        <ul className="mx-auto mt-8 grid max-w-2xl gap-3 text-left sm:grid-cols-2">
          {BENEFITS.map(({ key, icon: Icon }) => (
            <li key={key} className="flex gap-3 rounded-2xl border bg-background/60 p-4">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Icon aria-hidden className="size-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{t(`benefits.${key}.title`)}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{t(`benefits.${key}.body`)}</span>
              </span>
            </li>
          ))}
        </ul>

        {error && <p className="mt-6 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">{error}</p>}

        {variant !== "setup" &&
          (isOwner ? (
            <div className="mt-8 flex flex-col items-center gap-3">
              <Button asChild size="lg">
                {/* Una ruta de la API, no una página: se navega entera (redirige a Google). */}
                <a href={startHref}>
                  <KeyRound data-icon="inline-start" />
                  {t(variant === "reconnect" ? "reconnectCta" : "cta")}
                </a>
              </Button>
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Lock aria-hidden className="size-3.5" />
                {t("readOnly")}
              </p>
            </div>
          ) : (
            <p className="mt-8 text-sm text-muted-foreground">{t("ownerOnly")}</p>
          ))}
      </div>

      {variant === "setup" && (
        <section aria-labelledby="seo-setup-steps" className="mt-6 rounded-3xl border bg-card px-6 py-6 sm:px-8">
          <h3 id="seo-setup-steps" className="text-base font-bold">
            {t("setup.stepsTitle")}
          </h3>
          <ol className="mt-4 space-y-3 text-sm">
            {(["project", "consent", "client", "env"] as const).map((step, index) => (
              <li key={step} className="flex gap-3">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-bold tabular">{index + 1}</span>
                <span className="min-w-0 pt-0.5">
                  <span className="font-semibold">{t(`setup.steps.${step}.title`)}</span>
                  <span className="mt-0.5 block text-muted-foreground">{t(`setup.steps.${step}.body`)}</span>
                  {step === "client" && (
                    <code className="mt-2 block rounded-lg bg-muted px-3 py-2 font-mono text-xs break-all select-all">{redirectUri}</code>
                  )}
                </span>
              </li>
            ))}
          </ol>
          <ul className="mt-5 grid gap-2 sm:grid-cols-3">
            {ENV.map((name) => {
              const missing = missingEnv.includes(name);
              return (
                <li
                  key={name}
                  className={cn(
                    "flex items-center gap-2 rounded-xl border px-3 py-2 font-mono text-xs",
                    missing ? "text-muted-foreground" : "border-success/30 bg-success/10 text-success",
                  )}
                >
                  {missing ? <CircleDashed aria-hidden className="size-3.5 shrink-0" /> : <CircleCheck aria-hidden className="size-3.5 shrink-0" />}
                  <span className="truncate">{name}</span>
                  <span className="sr-only">{missing ? t("setup.missing") : t("setup.present")}</span>
                </li>
              );
            })}
          </ul>
          {demoHref && (
            <p className="mt-4 text-xs text-muted-foreground">
              {t.rich("setup.demo", {
                link: (chunks) => (
                  <Link href={demoHref} className="font-medium text-primary hover:underline">
                    {chunks}
                  </Link>
                ),
              })}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
