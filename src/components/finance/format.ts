import { useFormatter, useLocale, useTranslations } from "next-intl";
import { formatBps, formatMoney } from "@/domain/money";

/** Una fecha civil (YYYY-MM-DD) a mediodía UTC: el mismo día en cualquier zona horaria. */
export const civil = (date: string) => new Date(`${date.slice(0, 10)}T12:00:00Z`);

/**
 * Formatos de Finanzas con el idioma de la interfaz: dinero exacto o redondo, porcentajes y
 * fechas civiles (sin zona). Para componentes de cliente; los de servidor usan getFormatter.
 */
export function useFinanceFormat() {
  const format = useFormatter();
  const locale = useLocale();
  return {
    money: (cents: number) => formatMoney(cents, { locale }),
    /** Sin céntimos cuando el importe es redondo (cifras grandes, resúmenes). */
    whole: (cents: number) => formatMoney(cents, { locale, wholeUnits: true }),
    percent: (bps: number) => formatBps(bps, locale),
    /** 26/09/2026 */
    date: (date: string) => format.dateTime(civil(date), { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }),
    /** 26 sept */
    dateShort: (date: string) => format.dateTime(civil(date), { day: "numeric", month: "short", timeZone: "UTC" }),
    /** 26 sept 2026 */
    dateMedium: (date: string) => format.dateTime(civil(date), { dateStyle: "medium", timeZone: "UTC" }),
    /** septiembre de 2026 */
    month: (month: string) => format.dateTime(civil(month), { month: "long", year: "numeric", timeZone: "UTC" }),
    /** sept 26 */
    monthShort: (month: string) => format.dateTime(civil(month), { month: "short", year: "2-digit", timeZone: "UTC" }),
  };
}

export type FinanceFormat = ReturnType<typeof useFinanceFormat>;

/** "2026-Q3" → "3T 2026" (con el texto de i18n). */
export function useQuarterLabel() {
  const t = useTranslations("finance.taxes");
  return (key: string) => {
    const [year, q] = key.split("-Q");
    return t("quarter", { quarter: Number(q), year: String(year) });
  };
}

/** Traduce un error de Zod de los formularios de Finanzas: primero `finance.validation.*`, luego `validation.*`. */
export function useFinanceValidationMessage() {
  const t = useTranslations("finance.validation");
  const tCommon = useTranslations("validation");
  return (message: string | undefined): string | undefined => {
    if (!message) return undefined;
    if (t.has(message)) return t(message);
    return tCommon.has(message) ? tCommon(message) : tCommon("invalid");
  };
}
