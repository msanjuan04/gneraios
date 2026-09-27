import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { brand, themes } from "@/brand";
import { portalThemeCss } from "@/components/portal/public/theme";

// Páginas públicas (enlaces secretos que comparten los socios): sin la barra de la app, con el
// tema del sistema del cliente y fuera de los buscadores. El token va en la URL, así que ninguna
// página pasa el Referer a otros sitios.
export const metadata: Metadata = {
  title: { absolute: brand.name },
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false, noimageindex: true } },
  referrer: "no-referrer",
};

export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: themes.light.background },
    { media: "(prefers-color-scheme: dark)", color: themes.dark.background },
  ],
};

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <style href="portal-theme" precedence="high">
        {portalThemeCss}
      </style>
      {children}
    </>
  );
}
