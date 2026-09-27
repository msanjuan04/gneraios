import { useFormatter, useLocale, useTranslations } from "next-intl";
import { formatMoney } from "@/domain/money";
import { formatDuration, formatHours } from "@/domain/projects";

/** Una fecha civil ("2026-09-26") como instante a mediodía UTC: sin saltos de día por la zona. */
export function civilToDate(civil: string): Date {
  return new Date(`${civil}T12:00:00Z`);
}

/** Formatos de proyectos: fechas civiles, duraciones ("1 h 30 min"), importes redondos y €/h. */
export function useProjectFormat() {
  const format = useFormatter();
  const locale = useLocale();
  const t = useTranslations("projects.rate");
  const whole = (cents: number) => formatMoney(cents, { locale, wholeUnits: true });

  return {
    date: (civil: string, style: "short" | "medium" | "weekday" = "medium") =>
      format.dateTime(
        civilToDate(civil),
        style === "short"
          ? { day: "numeric", month: "short", timeZone: "UTC" }
          : style === "weekday"
            ? { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }
            : { dateStyle: "medium", timeZone: "UTC" },
      ),
    /** "sept 26": ejes de las gráficas mensuales. */
    month: (civil: string) => format.dateTime(civilToDate(civil), { month: "short", year: "2-digit", timeZone: "UTC" }),
    /** "septiembre de 2026". */
    monthLong: (civil: string) => format.dateTime(civilToDate(civil), { month: "long", year: "numeric", timeZone: "UTC" }),
    time: (iso: string) => format.dateTime(new Date(iso), { hour: "2-digit", minute: "2-digit" }),
    /** Un instante (timestamptz) como fecha, en la zona de la app. */
    instant: (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium" }),
    duration: (minutes: number) => formatDuration(minutes, locale),
    hours: (minutes: number) => formatHours(minutes, locale),
    /** Importe redondo al euro (KPIs, resúmenes). */
    money: (cents: number) => whole(Math.round(cents / 100) * 100),
    /** "72 €/h": la tarifa se enseña al euro. */
    rate: (cents: number) => t("perHour", { amount: whole(Math.round(cents / 100) * 100) }),
    percent: (ratio: number) => format.number(ratio, { style: "percent", maximumFractionDigits: 0 }),
  };
}

export type ProjectFormat = ReturnType<typeof useProjectFormat>;
