import { Link2Off, TimerOff } from "lucide-react";
import type { PortalLocale } from "@/domain/portal";
import { portalCopy } from "@/server/portal/copy";
import { PortalShell } from "./shell";

/** Un enlace que no lleva a nada: incompleto, caducado o sustituido por otro. Nunca enseña datos. */
export function LinkStatePage({ locale, state }: { locale: PortalLocale; state: "unknown" | "expired" | "revoked" }) {
  const t = portalCopy(locale);
  const Icon = state === "expired" ? TimerOff : Link2Off;
  return (
    <PortalShell locale={locale}>
      <div className="mx-auto flex max-w-md flex-col items-center py-16 text-center sm:py-24">
        <span className="flex size-16 items-center justify-center rounded-3xl bg-brand-gradient text-white shadow-[0_20px_60px_-20px_rgb(46_128_255/0.8)]">
          <Icon className="size-7" aria-hidden />
        </span>
        <h1 className="mt-6 text-3xl font-extrabold heading-tight">{t(`link.${state}.title`)}</h1>
        <p className="mt-3 text-muted-foreground">{t(`link.${state}.text`)}</p>
      </div>
    </PortalShell>
  );
}
