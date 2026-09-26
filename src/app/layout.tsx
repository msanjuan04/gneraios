import type { Metadata, Viewport } from "next";
import { Manrope } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { brand, brandCss } from "@/brand";
import { Providers } from "@/components/providers";
import "./globals.css";

// La tipografía de gnerai.com.
const manrope = Manrope({ variable: "--font-manrope", subsets: ["latin"], display: "swap" });

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta");
  return {
    title: { default: brand.product, template: `%s · ${brand.product}` },
    description: t("description"),
    applicationName: brand.product,
    robots: { index: false, follow: false },
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
