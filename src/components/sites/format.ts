import { useFormatter, useLocale, useNow, useTranslations } from "next-intl";
import { formatDuration } from "@/domain/projects/duration";
import type { CheckError } from "@/domain/sites";

/** Una fecha civil ("2026-09-26") como instante a mediodía UTC: sin saltos de día por la zona. */
function civilToDate(civil: string): Date {
  return new Date(`${civil}T12:00:00Z`);
}

/** Cada cuánto se refrescan los tiempos relativos ("hace 3 min"). */
export const RELATIVE_REFRESH_MS = 30_000;

/** Formatos de Webs: tiempos de respuesta, uptime, días que quedan, fechas y tiempos relativos. */
export function useSiteFormat() {
  const format = useFormatter();
  const locale = useLocale();
  const now = useNow({ updateInterval: RELATIVE_REFRESH_MS });
  const t = useTranslations("sites.format");
  const tErrors = useTranslations("sites.errors");

  return {
    now,
    /** 412 → "412 ms"; 3240 → "3,2 s". */
    ms: (value: number) =>
      value < 1000
        ? t("ms", { value: format.number(value, { maximumFractionDigits: 0 }) })
        : t("seconds", { value: format.number(value / 1000, { maximumFractionDigits: 1 }) }),
    /** 0.99996 → "99,99 %" (nunca redondea a 100 % lo que no lo es). */
    uptime: (ratio: number) => format.number(Math.floor(ratio * 10_000) / 10_000, { style: "percent", maximumFractionDigits: 2 }),
    /** Días que quedan, en corto ("12 d") para las columnas. */
    daysShort: (days: number) => t("daysShort", { count: days }),
    date: (civil: string) => format.dateTime(civilToDate(civil), { dateStyle: "medium", timeZone: "UTC" }),
    dateTime: (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" }),
    time: (iso: string) => format.dateTime(new Date(iso), { hour: "2-digit", minute: "2-digit" }),
    /** "lun 21": las marcas de día de las gráficas. */
    day: (iso: string) => format.dateTime(new Date(iso), { weekday: "short", day: "numeric" }),
    // Una comprobación recién hecha puede ser unos segundos posterior al `now` (que se refresca
    // cada tanto, o el reloj del servidor va algo adelantado): nunca «dentro de 13 segundos».
    relative: (iso: string) => {
      const at = new Date(iso);
      return format.relativeTime(at.getTime() > now.getTime() ? now : at, now);
    },
    /** Minutos → "1 h 35 min" (igual en los tres idiomas). */
    duration: (minutes: number) => formatDuration(Math.max(0, Math.round(minutes)), locale),
    /** Qué falló, en palabras ("HTTP 503", "Tiempo de espera agotado"…). */
    error: (error: CheckError | null, statusCode: number | null) =>
      error === "http" && statusCode ? tErrors("httpStatus", { status: statusCode }) : tErrors(error ?? "network"),
  };
}

export type SiteFormat = ReturnType<typeof useSiteFormat>;
