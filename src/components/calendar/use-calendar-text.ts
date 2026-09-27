"use client";

import { useLocale, useTranslations } from "next-intl";
import { createContext, useContext, useMemo } from "react";
import {
  type CalendarEvent,
  type CalendarFact,
  type DayHint,
  eventDetail,
  eventSummary,
  type FactFormat,
  factLabel,
  factValue,
  formatAmount,
  formatCivilDate,
  type Translate,
} from "@/domain/calendar";

export type MoneyFormat = { locale: string; currency: string };

/** Moneda y locale de la org para los importes (los pone CalendarView). */
export const CalendarMoneyContext = createContext<MoneyFormat>({ locale: "es-ES", currency: "EUR" });

/** Los textos de un evento con i18n (`calendar.*`): los mismos que el ICS y el dashboard. */
export function useCalendarText() {
  const t = useTranslations("calendar");
  const locale = useLocale();
  const money = useContext(CalendarMoneyContext);
  return useMemo(() => {
    const translate: Translate = (key, values) => t(key, values);
    const format: FactFormat = { t: translate, locale, moneyLocale: money.locale, currency: money.currency };
    return {
      t: translate,
      locale,
      summary: (event: CalendarEvent) => eventSummary(event, translate),
      detail: (event: CalendarEvent) => eventDetail(event, translate),
      amount: (event: CalendarEvent) =>
        event.amountCents === null ? null : formatAmount(event.amountCents, event.amountPeriod, format),
      factLabel: (fact: CalendarFact) => factLabel(fact, translate),
      factValue: (fact: CalendarFact) => factValue(fact, format),
      longDate: (date: string) => formatCivilDate(date, locale),
      money: (cents: number) => formatAmount(cents, null, format),
      hint: (hint: DayHint) =>
        hint.kind === "collections"
          ? translate("hints.collections", { count: hint.count, amount: formatAmount(hint.amountCents, null, format) })
          : translate(`hints.${hint.kind}`, { count: hint.count }),
    };
  }, [t, locale, money]);
}

export type CalendarText = ReturnType<typeof useCalendarText>;
