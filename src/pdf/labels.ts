import { deepMerge, type Messages } from "@/i18n/messages/merge";
import caCatalog from "@/i18n/messages/ca/pdf.json";
import enCatalog from "@/i18n/messages/en/pdf.json";
import esCatalog from "@/i18n/messages/es/pdf.json";
import type { PdfLocale } from "./types";

/**
 * Textos de la plantilla PDF. Las facturas salen en el idioma del cliente, así que los
 * tres catálogos van completos; aun así, una clave que falte en `ca` o `en` cae al
 * español, igual que en la UI. La forma la marca el catálogo español.
 */
export type PdfLabels = (typeof esCatalog)["pdf"];

const catalogs: Record<PdfLocale, Messages> = {
  es: esCatalog.pdf,
  ca: caCatalog.pdf,
  en: enCatalog.pdf,
};

const cache = new Map<PdfLocale, PdfLabels>();

export function getPdfLabels(locale: PdfLocale): PdfLabels {
  let labels = cache.get(locale);
  if (!labels) {
    const merged = locale === "es" ? catalogs.es : deepMerge(catalogs.es, catalogs[locale]);
    labels = merged as unknown as PdfLabels;
    cache.set(locale, labels);
  }
  return labels;
}

/**
 * Sustituye los argumentos `{nombre}` de un mensaje. Los catálogos solo usan argumentos
 * simples (sin plural ni select), así que siguen siendo mensajes ICU válidos.
 */
export function interpolate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match: string, key: string) =>
    Object.hasOwn(values, key) ? String(values[key]) : match,
  );
}

/**
 * Nombre del país en el idioma del documento: primero el catálogo (UE, GB, US, CH, AD y
 * algunos más), después `Intl.DisplayNames` y, si el código no es válido, el propio código.
 */
export function countryName(countryCode: string, locale: PdfLocale): string {
  const code = countryCode.trim().toUpperCase();
  const countries: Record<string, string | undefined> = getPdfLabels(locale).countries;
  const fromCatalog = countries[code];
  if (fromCatalog) return fromCatalog;
  try {
    return new Intl.DisplayNames([locale], { type: "region", fallback: "code" }).of(code) ?? code;
  } catch {
    return code;
  }
}
