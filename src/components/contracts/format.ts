import { useFormatter, useLocale, useTranslations } from "next-intl";
import { formatBps, formatMoney } from "@/domain/money";
import type { BillingType } from "./types";

/** Una fecha civil ("2026-09-26") como instante a mediodía UTC: sin saltos de día por la zona. */
export function civilToDate(civil: string): Date {
  return new Date(`${civil}T12:00:00Z`);
}

/**
 * Formatos de la sección de contratos: importes exactos (o redondos en los KPIs), fechas
 * civiles, periodos, porcentajes y cantidades, todo con la configuración regional activa.
 */
export function useContractFormat() {
  const format = useFormatter();
  const locale = useLocale();
  const tBilling = useTranslations("billing");

  const date = (civil: string, style: "short" | "medium" | "long" = "medium") =>
    format.dateTime(
      civilToDate(civil),
      style === "short"
        ? { day: "numeric", month: "short", timeZone: "UTC" }
        : { dateStyle: style === "long" ? "long" : "medium", timeZone: "UTC" },
    );

  return {
    money: (cents: number) => formatMoney(cents, { locale }),
    /** Sin céntimos cuando el importe es redondo (KPIs y resúmenes). */
    whole: (cents: number) => formatMoney(cents, { locale, wholeUnits: true }),
    percent: (bps: number) => formatBps(bps, locale),
    quantity: (quantity: number) => format.number(quantity, { maximumFractionDigits: 3 }),
    date,
    period: (from: string, to: string) => tBilling("period", { from: date(from, "short"), to: date(to) }),
    /** "150,00 €/mes", "1.200,00 €/año", "375,00 €/uso" o solo el importe si es puntual. */
    perCycle: (cents: number, billingType: BillingType, whole = false) =>
      `${whole ? formatMoney(cents, { locale, wholeUnits: true }) : formatMoney(cents, { locale })}${tBilling(`billingTypeSuffix.${billingType}`)}`,
  };
}

export type ContractFormat = ReturnType<typeof useContractFormat>;
