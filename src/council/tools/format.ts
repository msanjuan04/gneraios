// Cómo se escribe cada cifra de una tool (en español, como la leen los socios). El modelo recibe
// este texto y lo copia; el guardarraíl de números lo reconoce al comprobar el texto final.

import { formatBps, formatMoney } from "@/domain/money";
import { formatHours } from "@/domain/projects";
import type { Metric, MetricUnit } from "./types";

const numberFormats = new Map<string, Intl.NumberFormat>();

function numberFormat(decimals: number, locale: string): Intl.NumberFormat {
  const key = `${locale}:${decimals}`;
  let nf = numberFormats.get(key);
  if (!nf) {
    nf = new Intl.NumberFormat(locale, { useGrouping: "always", maximumFractionDigits: decimals });
    numberFormats.set(key, nf);
  }
  return nf;
}

export function formatMetricValue(value: number, unit: MetricUnit, locale = "es-ES"): string {
  switch (unit) {
    case "eur_cents":
      return formatMoney(Math.round(value), { locale, wholeUnits: true });
    case "bps":
      return formatBps(Math.round(value), locale);
    case "count":
      return numberFormat(0, locale).format(value);
    case "days":
      return `${numberFormat(1, locale).format(value)} ${Math.abs(value) === 1 ? "día" : "días"}`;
    case "months":
      return `${numberFormat(1, locale).format(value)} ${Math.abs(value) === 1 ? "mes" : "meses"}`;
    case "minutes":
      // Como en Proyectos: horas con un decimal como mucho (90 → "1,5 h").
      return formatHours(Math.round(value), locale);
    case "position":
      return numberFormat(1, locale).format(value);
    case "flag":
      return value === 1 ? "sí" : "no";
    case "number":
      return numberFormat(2, locale).format(value);
  }
}

export function formatMetric(metric: Pick<Metric, "value" | "unit">): string {
  return formatMetricValue(metric.value, metric.unit);
}

const monthLabels = new Intl.DateTimeFormat("es-ES", { month: "short", year: "numeric", timeZone: "UTC" });

/** `2026-08-01` → "ago 2026". */
export function monthLabel(month: string): string {
  return monthLabels.format(new Date(`${month.slice(0, 7)}-01T12:00:00Z`)).replace(".", "");
}

/** Periodo de un mes: `2026-08`. */
export const monthPeriod = (month: string) => month.slice(0, 7);

/** Periodo de un rango de días (ambos incluidos). */
export const rangePeriod = (from: string, to: string) => `${from}/${to}`;
