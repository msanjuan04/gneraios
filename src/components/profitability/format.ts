import { useFormatter, useLocale, useTranslations } from "next-intl";
import { formatBps, formatMoney } from "@/domain/money";
import { type Period, quarterOfDate } from "@/domain/profitability";
import { formatHours } from "@/domain/projects/duration";

/** Una fecha civil (YYYY-MM-DD) a mediodía UTC: el mismo día en cualquier zona horaria. */
export const civilToDate = (date: string) => new Date(`${date.slice(0, 10)}T12:00:00Z`);

/**
 * Formatos de la rentabilidad con el idioma de la interfaz. Los importes van al euro (es un informe:
 * cifras grandes y comparables), los porcentajes con un decimal y el €/hora al euro.
 */
export function useProfitabilityFormat() {
  const format = useFormatter();
  const locale = useLocale();
  const t = useTranslations("profitability");
  const euros = (cents: number) => formatMoney(Math.round(cents / 100) * 100, { locale, wholeUnits: true });
  return {
    money: euros,
    /** "−1.250 €" / "+300 €" en los ejes y tooltips de la gráfica. */
    compact: (cents: number) =>
      format.number(cents / 100, { style: "currency", currency: "EUR", notation: "compact", maximumFractionDigits: 1 }),
    /** 5333 → "53,3 %". */
    percent: (bps: number) => formatBps(Math.round(bps / 10) * 10, locale),
    /** "72 €/h". */
    rate: (cents: number) => t("perHour", { amount: euros(cents) }),
    hours: (minutes: number) => formatHours(minutes, locale),
    date: (date: string) => format.dateTime(civilToDate(date), { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }),
    // Cada fecha por separado y unidas a mano: dateTimeRange (Intl.formatRange) pone espacios
    // distintos en Node y en el navegador y rompía la hidratación de la página.
    range: (from: string, to: string) => {
      const opts = { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" } as const;
      return `${format.dateTime(civilToDate(from), opts)} – ${format.dateTime(civilToDate(to), opts)}`;
    },
  };
}

export type ProfitabilityFormat = ReturnType<typeof useProfitabilityFormat>;

/** El nombre de un periodo: «Últimos 3 meses», «Septiembre de 2026», «3T 2026», «2026», «Desde siempre» o el rango. */
export function usePeriodLabel() {
  const t = useTranslations("profitability.period");
  const format = useFormatter();
  const locale = useLocale();
  const { range } = useProfitabilityFormat();
  return (period: Period): string => {
    switch (period.kind) {
      case "last3m":
        return t("last3m");
      case "last12m":
        return t("last12m");
      case "month": {
        const text = format.dateTime(civilToDate(period.from), { month: "long", year: "numeric", timeZone: "UTC" });
        return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
      }
      case "quarter":
        return t("quarter", { quarter: quarterOfDate(period.from), year: period.from.slice(0, 4) });
      case "year":
        return period.from.slice(0, 4);
      case "all":
        return t("all");
      case "custom":
        return range(period.from, period.to);
    }
  };
}
