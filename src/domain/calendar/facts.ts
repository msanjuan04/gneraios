// Cómo se leen los datos de un evento ("Vence: 20 de octubre de 2026"): lo mismo en el panel
// lateral y en la descripción del ICS. Puro: fechas con Intl, importes con src/domain/money.

import { formatBps, formatMoney } from "../money";
import { fiscalPeriodLabel, type Translate } from "./summary";
import type { CalendarFact } from "./types";

export type FactFormat = {
  t: Translate;
  /** Locale de la interfaz ("es"), para fechas y porcentajes. */
  locale: string;
  /** Locale y moneda de la org para los importes ("es-ES", "EUR"). */
  moneyLocale: string;
  currency: string;
};

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

/** Una fecha civil como texto largo ("20 de octubre de 2026"), igual en cualquier zona horaria. */
export function formatCivilDate(date: string, locale: string, style: "long" | "short" = "long"): string {
  const key = `${locale}:${style}`;
  let formatter = dateFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: style === "long" ? "long" : "short",
      year: "numeric",
      timeZone: "UTC",
    });
    dateFormatters.set(key, formatter);
  }
  // Mediodía UTC: el mismo día en cualquier zona de España.
  return formatter.format(new Date(`${date.slice(0, 10)}T12:00:00Z`));
}

/** Importe con su periodo si lo tiene: "350 €/mes". Sin céntimos cuando es redondo. */
export function formatAmount(cents: number, period: "month" | "year" | null | undefined, f: Pick<FactFormat, "t" | "moneyLocale" | "currency">): string {
  const amount = formatMoney(cents, { locale: f.moneyLocale, currency: f.currency, wholeUnits: true });
  if (period === "month") return f.t("amount.perMonth", { amount });
  if (period === "year") return f.t("amount.perYear", { amount });
  return amount;
}

/** La etiqueta de un dato: la de i18n o, en una partida, su propio texto. */
export function factLabel(fact: CalendarFact, t: Translate): string {
  return fact.type === "item" ? fact.label : t(`facts.${fact.key}`);
}

export function factValue(fact: CalendarFact, f: FactFormat): string {
  switch (fact.type) {
    case "date":
      return formatCivilDate(fact.value, f.locale);
    case "money":
      return formatAmount(fact.value, fact.period, f);
    case "text":
      return fact.value;
    case "label":
      return f.t(`values.${fact.value}`);
    case "bps":
      return formatBps(fact.value, f.locale);
    case "number":
      return f.t(`factValues.${fact.key}`, { count: fact.value });
    case "range":
      return f.t("range", { from: formatCivilDate(fact.from, f.locale, "short"), to: formatCivilDate(fact.to, f.locale, "short") });
    case "fiscalPeriod":
      return fiscalPeriodLabel(fact.value, f.t);
    case "item":
      return fact.cents === null ? "—" : formatAmount(fact.cents, fact.period, f);
  }
}
