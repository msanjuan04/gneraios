import { useFormatter, useLocale, useTranslations } from "next-intl";
import { formatBps, formatMoney } from "@/domain/money";

/** Una fecha civil ("2026-09-26") como instante a mediodía UTC: sin saltos de día por la zona. */
function civilToDate(civil: string): Date {
  return new Date(`${civil}T12:00:00Z`);
}

/**
 * Formatos de la sección de presupuestos: importes exactos (o redondos en el listado), por
 * ciclo (€/mes, €/año, €/uso), porcentajes y fechas civiles, con la configuración regional activa.
 */
export function useQuoteFormat() {
  const format = useFormatter();
  const locale = useLocale();
  const tBilling = useTranslations("billing");

  const date = (civil: string, style: "short" | "medium" = "medium") =>
    format.dateTime(
      civilToDate(civil),
      style === "short" ? { day: "numeric", month: "short", timeZone: "UTC" } : { dateStyle: "medium", timeZone: "UTC" },
    );

  return {
    money: (cents: number) => formatMoney(cents, { locale }),
    /** Sin céntimos cuando el importe es redondo (listado y resúmenes). */
    whole: (cents: number) => formatMoney(cents, { locale, wholeUnits: true }),
    percent: (bps: number) => formatBps(bps, locale),
    date,
    instant: (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" }),
    /** "150,00 €/mes", "1.200,00 €/año", "375,00 €/uso" o solo el importe si es puntual. */
    perCycle: (cents: number, type: "one_off" | "monthly" | "yearly" | "usage", whole = false) =>
      `${whole ? formatMoney(cents, { locale, wholeUnits: true }) : formatMoney(cents, { locale })}${tBilling(`billingTypeSuffix.${type}`)}`,
  };
}

/**
 * Traduce el mensaje de un error de Zod de los formularios de presupuestos: primero
 * `quotes.validation.*`, luego los comunes de `validation.*`.
 */
export function useQuoteValidationMessage() {
  const t = useTranslations("quotes.validation");
  const tCommon = useTranslations("validation");
  return (message: string | undefined): string | undefined => {
    if (!message) return undefined;
    if (t.has(message)) return t(message);
    return tCommon.has(message) ? tCommon(message) : tCommon("invalid");
  };
}
