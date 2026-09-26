import { useFormatter, useLocale, useTranslations } from "next-intl";
import { formatBps, formatMoney } from "@/domain/money";

/** Una fecha civil (YYYY-MM-DD) a mediodía UTC: el mismo día en cualquier zona horaria. */
const civil = (date: string) => new Date(`${date}T12:00:00Z`);

/**
 * Formatos de facturación con el idioma de la interfaz: dinero con separador de miles,
 * porcentajes, fechas civiles (dd/mm/aaaa, sin zona) e instantes en la zona de la org.
 */
export function useInvoiceFormat() {
  const format = useFormatter();
  const locale = useLocale();
  return {
    money: (cents: number) => formatMoney(cents, { locale }),
    percent: (bps: number) => formatBps(bps, locale),
    /** 26/09/2026 */
    date: (date: string) => format.dateTime(civil(date), { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }),
    /** 26 de septiembre de 2026 */
    dateLong: (date: string) => format.dateTime(civil(date), { dateStyle: "long", timeZone: "UTC" }),
    /** 26 sept */
    dateShort: (date: string) => format.dateTime(civil(date), { day: "numeric", month: "short", timeZone: "UTC" }),
    /** 06:00 en la zona de la org. */
    time: (iso: string, timeZone: string) => format.dateTime(new Date(iso), { hour: "2-digit", minute: "2-digit", timeZone }),
    /** 26 sept 2026, 06:00 en la zona de la org. */
    instant: (iso: string, timeZone: string) =>
      format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short", timeZone }),
  };
}

/** Periodo de una línea ("01/09/2026 – 30/09/2026") con la plantilla compartida de facturación. */
export function usePeriodLabel() {
  const t = useTranslations("billing");
  const { date } = useInvoiceFormat();
  return (from: string | null, to: string | null) => (from && to ? t("period", { from: date(from), to: date(to) }) : null);
}

/** Traduce un error de Zod de los formularios de facturas: primero `invoices.validation.*`, luego `validation.*`. */
export function useInvoiceValidationMessage() {
  const t = useTranslations("invoices.validation");
  const tCommon = useTranslations("validation");
  return (message: string | undefined): string | undefined => {
    if (!message) return undefined;
    if (t.has(message)) return t(message);
    return tCommon.has(message) ? tCommon(message) : tCommon("invalid");
  };
}
