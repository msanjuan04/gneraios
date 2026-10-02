import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { brand, brandCss } from "@/brand";
import { Providers } from "@/components/providers";
import "./globals.css";

// La tipografía de gnerai.com.
const manrope = localFont({
  variable: "--font-manrope",
  display: "swap",
  src: [
    { path: "../../public/fonts/manrope/manrope-latin-400-normal.woff", weight: "400", style: "normal" },
    { path: "../../public/fonts/manrope/manrope-latin-500-normal.woff", weight: "500", style: "normal" },
    { path: "../../public/fonts/manrope/manrope-latin-600-normal.woff", weight: "600", style: "normal" },
    { path: "../../public/fonts/manrope/manrope-latin-700-normal.woff", weight: "700", style: "normal" },
    { path: "../../public/fonts/manrope/manrope-latin-800-normal.woff", weight: "800", style: "normal" },
  ],
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta");
  return {
    title: { default: brand.product, template: `%s · ${brand.product}` },
    description: t("description"),
    applicationName: brand.product,
    robots: { index: false, follow: false },
    // Instalada en iPhone/iPad (Añadir a pantalla de inicio): pantalla completa y barra oscura.
    appleWebApp: { capable: true, title: brand.name, statusBarStyle: "black-translucent" },
  };
}

export const viewport: Viewport = {
  themeColor: brand.palette.black,
  colorScheme: "dark light",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();
  return (
    <html lang={locale} className={`${manrope.variable} h-full`} suppressHydrationWarning>
      <head>
        <style id="brand-tokens" dangerouslySetInnerHTML={{ __html: brandCss() }} />
      </head>
      <body className="min-h-full">
        <NextIntlClientProvider>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
