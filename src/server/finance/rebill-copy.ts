// Sin "server-only": textos puros (se prueban con Vitest). Solo se importan desde código de servidor.
//
// El texto de cada línea de una repercusión, en el idioma de la factura (el del borrador o el del
// cliente), no en el de quien la añade. El catálogo es el de la app; lo que falte en ca/en se ve
// en español (como en i18n/request.ts).

import { createTranslator } from "next-intl";
import type { CivilDate } from "@/domain/dates/civil-date";
import { rebillDate, type RebillExpense } from "@/domain/finance/rebill";
import type { Locale } from "@/i18n/config";
import ca from "@/i18n/messages/ca/finance.json";
import en from "@/i18n/messages/en/finance.json";
import es from "@/i18n/messages/es/finance.json";
import { deepMerge } from "@/i18n/messages/merge";

type Catalog = typeof es;
const CATALOGS: Record<Locale, Catalog> = {
  es,
  ca: deepMerge(es, ca) as unknown as Catalog,
  en: deepMerge(es, en) as unknown as Catalog,
};
/** Para el mes de cada línea («septiembre de 2026»). */
const DATE_LOCALE: Record<Locale, string> = { es: "es-ES", ca: "ca-ES", en: "en-IE" };

const civilNoon = (date: CivilDate) => new Date(`${date}T12:00:00Z`);

/**
 * «Repercusión: Hetzner · Servidor CX22 · septiembre de 2026»: el proveedor y el concepto del
 * gasto (sin repetir el proveedor si el concepto ya lo nombra) y el mes que cobra.
 */
export function rebillLineDescriber(locale: Locale): (expense: RebillExpense) => string {
  const t = createTranslator({ locale, messages: CATALOGS[locale], namespace: "finance.rebill.line" });
  const month = new Intl.DateTimeFormat(DATE_LOCALE[locale], { month: "long", year: "numeric", timeZone: "UTC" });
  return (expense) => {
    const description = expense.description.trim();
    const vendor = expense.vendorName?.trim() ?? "";
    const concept =
      vendor && !description.toLowerCase().includes(vendor.toLowerCase()) ? t("concept", { vendor, description }) : description || vendor;
    return t("description", { concept, month: month.format(civilNoon(rebillDate(expense))) });
  };
}
