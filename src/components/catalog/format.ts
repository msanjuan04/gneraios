import { useLocale, useTranslations } from "next-intl";
import { type CatalogBillingType, type CatalogLocale, pricingKind } from "@/domain/catalog";
import { formatBps, formatMoney } from "@/domain/money";
import { formatQuantity, intlLocale } from "@/pdf/format";
import { getPdfLabels, interpolate } from "@/pdf/labels";

/**
 * Formatos del catálogo con la configuración regional de la app: importes, precio con su ciclo o
 * su unidad ("450,00 €/mes", "60,00 €/hora") y porcentajes.
 */
export function useCatalogFormat() {
  const locale = useLocale();
  const tBilling = useTranslations("billing");
  const money = (cents: number) => formatMoney(cents, { locale });
  const whole = (cents: number) => formatMoney(cents, { locale, wholeUnits: true });
  const suffix = (type: CatalogBillingType) => tBilling(`billingTypeSuffix.${type}`);
  return {
    money,
    whole,
    percent: (bps: number) => formatBps(bps, locale),
    /** "150,00 €/mes", "1.200,00 €/año", "375,00 €/uso" o solo el importe si es puntual. */
    perCycle: (cents: number, type: CatalogBillingType, round = false) => `${round ? whole(cents) : money(cents)}${suffix(type)}`,
    /** El precio de un servicio: por ciclo en las recurrentes y, si tiene unidad, por unidad. */
    price: (cents: number, type: CatalogBillingType, unitLabel: string | null) =>
      pricingKind(type) !== "recurring" && unitLabel ? `${money(cents)}/${unitLabel}` : `${money(cents)}${suffix(type)}`,
    quantity: (quantity: string) => Number(quantity).toLocaleString(locale, { maximumFractionDigits: 3 }),
  };
}

/**
 * Traduce el mensaje de un error de Zod de los formularios del catálogo: primero
 * `catalog.validation.*`, luego los comunes de `validation.*`.
 */
export function useCatalogValidationMessage() {
  const t = useTranslations("catalog.validation");
  const tCommon = useTranslations("validation");
  return (message: string | undefined): string | undefined => {
    if (!message) return undefined;
    if (t.has(message)) return t(message);
    return tCommon.has(message) ? tCommon(message) : tCommon("invalid");
  };
}

/**
 * Formatos del documento, en el idioma del cliente y con los textos del PDF del presupuesto: así
 * la vista previa dice exactamente lo que dirá el presupuesto.
 */
export function documentFormat(locale: CatalogLocale) {
  const labels = getPdfLabels(locale);
  const intl = intlLocale(locale);
  const money = (cents: number) => formatMoney(cents, { locale: intl });
  return {
    labels,
    money,
    percent: (bps: number) => formatBps(bps, intl),
    quantity: (quantity: string) => formatQuantity(quantity, locale),
    /** Como en el PDF: "150,00 €/mes", "375,00 €/uso"; lo puntual, solo el importe. */
    perCycle: (cents: number, type: CatalogBillingType) =>
      type === "one_off" ? money(cents) : interpolate(labels.quote.cycle[type], { amount: money(cents) }),
    /** Tipo y vigencia de una línea sin fechas: "Mensual · Desde la aceptación". */
    detail: (type: CatalogBillingType) => {
      if (type === "one_off") return null;
      const name = type === "usage" ? labels.quote.summary.usage : labels.billingType[type];
      return `${name} · ${labels.quote.recurring.fromAcceptance}`;
    },
  };
}
