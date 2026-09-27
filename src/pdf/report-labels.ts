import type { ReportLocale } from "@/domain/reports";
import caCatalog from "@/i18n/messages/ca/report-pdf.json";
import enCatalog from "@/i18n/messages/en/report-pdf.json";
import esCatalog from "@/i18n/messages/es/report-pdf.json";
import { deepMerge, type Messages } from "@/i18n/messages/merge";

/**
 * Textos del PDF del informe mensual. Sale en el idioma del cliente, así que los tres catálogos
 * van completos; aun así, una clave que falte en `ca` o `en` cae al español, como en la UI. La
 * forma la marca el catálogo español. Los meses van en el catálogo (y no en `Intl`) porque cada
 * idioma los combina a su manera: «frente a agosto», «respecte a l’agost», «vs August».
 */
export type ReportPdfLabels = (typeof esCatalog)["reportPdf"];

const catalogs: Record<ReportLocale, Messages> = {
  es: esCatalog.reportPdf,
  ca: caCatalog.reportPdf,
  en: enCatalog.reportPdf,
};

const cache = new Map<ReportLocale, ReportPdfLabels>();

export function getReportPdfLabels(locale: ReportLocale): ReportPdfLabels {
  let labels = cache.get(locale);
  if (!labels) {
    const merged = locale === "es" ? catalogs.es : deepMerge(catalogs.es, catalogs[locale]);
    labels = merged as unknown as ReportPdfLabels;
    cache.set(locale, labels);
  }
  return labels;
}
