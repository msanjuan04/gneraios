// Formato de cifras del dashboard. Puro (sirve en servidor y en cliente): los importes con la
// moneda y el locale de la org, los porcentajes y los meses con el locale de la interfaz.

import { formatBps, formatMoney } from "@/domain/money";
import type { MoneyFormat } from "./types";

const MINUS = "−";

/** Importe exacto; sin céntimos cuando es redondo ("2.910 €"). */
export function money(cents: number, fmt: MoneyFormat): string {
  return formatMoney(cents, { ...fmt, wholeUnits: true });
}

/** Importe con signo explícito: "+400 €", "−250 €" (con el signo menos tipográfico). */
export function signedMoney(cents: number, fmt: MoneyFormat): string {
  if (cents === 0) return money(0, fmt);
  const text = money(Math.abs(cents), fmt);
  return cents > 0 ? `+${text}` : `${MINUS}${text}`;
}

const compactFormatters = new Map<string, Intl.NumberFormat>();

/** Importe compacto para ejes: "3 mil €", "12 k". Redondeado: solo para marcas de escala. */
export function compactMoney(cents: number, fmt: MoneyFormat): string {
  const key = `${fmt.locale}:${fmt.currency}`;
  let nf = compactFormatters.get(key);
  if (!nf) {
    nf = new Intl.NumberFormat(fmt.locale, {
      style: "currency",
      currency: fmt.currency,
      notation: "compact",
      maximumFractionDigits: 1,
    });
    compactFormatters.set(key, nf);
  }
  return nf.format(cents / 100);
}

/** Puntos básicos como porcentaje: 2610 → "26,1 %". */
export function share(bps: number, locale: string): string {
  return formatBps(Math.round(bps / 10) * 10, locale);
}

const percentFormatters = new Map<string, Intl.NumberFormat>();

/** Variación relativa con signo: 0,125 → "+12,5 %". */
export function signedPercent(ratio: number, locale: string): string {
  let nf = percentFormatters.get(locale);
  if (!nf) {
    nf = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1, signDisplay: "exceptZero" });
    percentFormatters.set(locale, nf);
  }
  return nf.format(ratio).replace("-", MINUS);
}

/** Una fecha civil como instante del mediodía UTC: el mismo día en cualquier zona de España. */
export function civilToDate(date: string): Date {
  return new Date(`${date.slice(0, 10)}T12:00:00Z`);
}
