import "server-only";
import { createTranslator } from "next-intl";
import type { PortalLocale } from "@/domain/portal";
import ca from "@/i18n/messages/ca/portal-public.json";
import en from "@/i18n/messages/en/portal-public.json";
import es from "@/i18n/messages/es/portal-public.json";
import { deepMerge } from "@/i18n/messages/merge";

/**
 * Textos de las páginas públicas, en el idioma del cliente (el del presupuesto o su idioma
 * preferido), no en el de quien tenga la sesión abierta en ese navegador. Los tres catálogos van
 * completos; aun así, lo que falte en ca o en cae al español, como en la app.
 */
type Catalog = typeof es;

const catalogs: Record<PortalLocale, Catalog> = {
  es,
  ca: deepMerge(es, ca) as unknown as Catalog,
  en: deepMerge(es, en) as unknown as Catalog,
};

export function portalCopy(locale: PortalLocale) {
  return createTranslator({ locale, messages: catalogs[locale], namespace: "portalPublic", timeZone: "UTC" });
}

export type PortalCopy = ReturnType<typeof portalCopy>;
