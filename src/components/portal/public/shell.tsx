import { Lock } from "lucide-react";
import Image from "next/image";
import type { ReactNode } from "react";
import { brand } from "@/brand";
import type { PortalLocale } from "@/domain/portal";
import { portalCopy } from "@/server/portal/copy";

/**
 * Marco de las páginas públicas: sin la barra ni el menú de la app, con la marca de gnerai.com
 * (fondo, halo azul, vidrio y Manrope) y el tema del sistema del cliente. El idioma va en `lang`
 * para lectores de pantalla y traductores.
 */
export function PortalShell({
  locale,
  headerEnd,
  footer,
  hero,
  children,
}: {
  locale: PortalLocale;
  /** A la derecha de la barra superior (p. ej. volver al espacio). */
  headerEnd?: ReactNode;
  footer?: { issuers: string[]; email: string | null };
  /** Zona alta con las estrellas de la web detrás (el saludo del portal). */
  hero?: ReactNode;
  children: ReactNode;
}) {
  const t = portalCopy(locale);
  return (
    <div lang={locale} className="portal-root relative isolate min-h-svh overflow-x-clip bg-background text-foreground antialiased">
      <a
        href="#main"
        className="sr-only z-50 rounded-full bg-background px-4 py-2 text-sm font-semibold focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        {t("brand.skip")}
      </a>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[620px] bg-[radial-gradient(60%_60%_at_50%_0%,rgb(46_128_255/0.22),transparent_70%)]"
      />
      <div
        aria-hidden
        className="portal-stars pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px] starfield opacity-50 [mask-image:linear-gradient(to_bottom,black,transparent)]"
      />

      <header className="glass sticky top-0 z-30 border-b border-border/60">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
          <Image src={brand.logos.logoFlat} alt={brand.name} width={900} height={220} loading="eager" className="portal-logo h-5 w-auto select-none" />
          {headerEnd}
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-5xl px-4 pt-8 pb-16 sm:px-6">
        {hero && <div className="pt-2 pb-8 sm:pt-8 sm:pb-10">{hero}</div>}
        {children}
      </main>

      <footer className="border-t border-border/60">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-4 py-8 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="space-y-1">
            {footer && footer.issuers.length > 0 && <p>{t("brand.providedBy", { issuers: footer.issuers.join(" · ") })}</p>}
            {footer?.email && (
              <p>
                {t.rich("brand.questions", {
                  email: footer.email,
                  mail: (chunks) => (
                    <a href={`mailto:${footer.email}`} className="font-semibold text-foreground underline-offset-4 hover:underline">
                      {chunks}
                    </a>
                  ),
                })}
              </p>
            )}
          </div>
          <p className="flex items-center gap-1.5">
            <Lock className="size-3.5" aria-hidden />
            {t("brand.privateLink")}
          </p>
        </div>
      </footer>
    </div>
  );
}
