// Iconos y formato del consejo (puro: sirve en servidor y en cliente).

import { Compass, Gauge, Handshake, HeartHandshake, Landmark, type LucideIcon, Scale, Swords, Tags, TrendingUp } from "lucide-react";
import type { AgentName } from "@/council/types";
import { formatBps, formatMoney } from "@/domain/money";

export const AGENT_ICONS: Record<AgentName, LucideIcon> = {
  cfo: Landmark,
  commercial: Handshake,
  pricing: Tags,
  retention: HeartHandshake,
  operations: Gauge,
  growth: TrendingUp,
  fiscal: Scale,
  devils_advocate: Swords,
  chief_of_staff: Compass,
};

export type MoneyFormat = { locale: string; currency: string };

/** Importe en euros; sin céntimos cuando es redondo. */
export function eur(cents: number, fmt: MoneyFormat): string {
  return formatMoney(Math.round(cents), { ...fmt, wholeUnits: true });
}

export function percent(bps: number, locale: string): string {
  return formatBps(Math.round(bps), locale);
}

const usdFormats = new Map<string, Intl.NumberFormat>();

/** Millonésimas de dólar → "0,42 US$" (con más decimales si es menos de un céntimo). */
export function usd(micros: number, locale: string): string {
  const value = micros / 1_000_000;
  const digits = value !== 0 && Math.abs(value) < 0.01 ? 4 : 2;
  const key = `${locale}:${digits}`;
  let nf = usdFormats.get(key);
  if (!nf) {
    nf = new Intl.NumberFormat(locale, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: digits });
    usdFormats.set(key, nf);
  }
  return nf.format(value);
}

/** Céntimos de dólar → "15 US$". */
export function usdCents(cents: number, locale: string): string {
  return usd(cents * 10_000, locale);
}

const numberFormats = new Map<string, Intl.NumberFormat>();

export function count(value: number, locale: string): string {
  let nf = numberFormats.get(locale);
  if (!nf) {
    nf = new Intl.NumberFormat(locale, { useGrouping: "always" });
    numberFormats.set(locale, nf);
  }
  return nf.format(value);
}

/** Una fecha civil como instante del mediodía UTC (el mismo día en cualquier zona de España). */
export function civil(date: string): Date {
  return new Date(`${date.slice(0, 10)}T12:00:00Z`);
}
