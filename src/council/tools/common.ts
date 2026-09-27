// Piezas que comparten las tools: construir métricas, el MRR de un cliente con la definición v1
// (src/domain/metrics) y fechas en la zona de la org.

import { compareCivil, type CivilDate } from "@/domain/dates/civil-date";
import { dateInZone } from "@/domain/dates/zoned-time";
import { linesInForce, mrrTwelfths, twelfthsToCents, type MetricsLine } from "@/domain/metrics";
import { divRoundHalfAwayFromZero } from "@/domain/money";
import type { CouncilLine } from "../data/types";
import type { Metric, MetricUnit } from "./types";

function build(unit: MetricUnit) {
  return (key: string, label: string, value: number, period: string, href?: string): Metric => ({
    key,
    label,
    value,
    unit,
    period,
    ...(href ? { href } : {}),
  });
}

/** Constructores de métricas por unidad: `m.eur("mrr.current", "MRR actual", 123400, "2026-09-26")`. */
export const m = {
  eur: build("eur_cents"),
  bps: build("bps"),
  count: build("count"),
  days: build("days"),
  months: build("months"),
  minutes: build("minutes"),
  number: build("number"),
  position: build("position"),
  flag: (key: string, label: string, value: boolean, period: string, href?: string) => build("flag")(key, label, value ? 1 : 0, period, href),
};

/** Parte en puntos básicos (2500 = 25 %), exacta y redondeada una vez; null si el total es 0. */
export function shareBps(part: number | bigint, total: number | bigint): number | null {
  const t = BigInt(total);
  if (t === BigInt(0)) return null;
  const sign = t < BigInt(0) ? BigInt(-1) : BigInt(1);
  return Number(divRoundHalfAwayFromZero(BigInt(part) * BigInt(10_000) * sign, t * sign));
}

/** Variación relativa en puntos básicos (+1250 = +12,5 %); null sin base. */
export function changeBps(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return shareBps(current - previous, Math.abs(previous));
}

export function linesByClient<T extends MetricsLine>(lines: readonly T[]): Map<string, T[]> {
  const byClient = new Map<string, T[]>();
  for (const line of lines) {
    const list = byClient.get(line.clientId) ?? [];
    list.push(line);
    byClient.set(line.clientId, list);
  }
  return byClient;
}

/** MRR exacto (doceavos de céntimo) de unas líneas en una fecha, con las reglas de vigencia del contrato. */
export function mrrTwelfthsOn(lines: readonly MetricsLine[], date: CivilDate): bigint {
  return mrrTwelfths(linesInForce(lines, date), date);
}

export function mrrCentsOn(lines: readonly MetricsLine[], date: CivilDate): number {
  return twelfthsToCents(mrrTwelfthsOn(lines, date));
}

const isRecurring = (line: MetricsLine) => line.billingType === "monthly" || line.billingType === "yearly";

/** Alguna línea recurrente en vigor está en pausa ese día. */
export function hasPausedLineOn(lines: readonly MetricsLine[], date: CivilDate): boolean {
  return linesInForce(lines, date).some(
    (line) =>
      isRecurring(line) &&
      line.startsOn !== null &&
      compareCivil(line.startsOn, date) <= 0 &&
      (line.endsOn === null || compareCivil(date, line.endsOn) <= 0) &&
      line.pauses.some((p) => compareCivil(p.startsOn, date) <= 0 && (p.endsOn === null || compareCivil(date, p.endsOn) <= 0)),
  );
}

/** Líneas recurrentes activas o programadas ese día (no terminadas ni canceladas). */
export function liveRecurringLines<T extends CouncilLine>(lines: readonly T[], date: CivilDate): T[] {
  return linesInForce(lines, date).filter(
    (line) => isRecurring(line) && line.startsOn !== null && (line.endsOn === null || compareCivil(date, line.endsOn) <= 0),
  );
}

/** Día civil (en la zona de la org) de un instante ISO. */
export function localDay(instant: string, timeZone: string): CivilDate {
  return dateInZone(new Date(instant), timeZone);
}

/** Texto sin acentos ni mayúsculas, para comparar palabras ("Diseño" ~ "diseno"). */
export function normalizeText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

export function containsAny(text: string, words: readonly string[]): boolean {
  const normalized = normalizeText(text);
  return words.some((word) => {
    const w = normalizeText(word).trim();
    return w.length > 0 && normalized.includes(w);
  });
}

export const clientHref = (id: string) => `/clients/${id}`;
export const dealHref = (id: string) => `/pipeline?deal=${id}`;
export const contractHref = (id: string) => `/contracts/${id}`;
export const invoiceHref = (id: string) => `/invoices/${id}`;
export const projectHref = (id: string) => `/projects/${id}`;
