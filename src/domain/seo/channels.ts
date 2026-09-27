// De dónde vienen las visitas (GA4): el periodo por canal, con su peso, su variación y lo que
// convierte. Los de pago (Google Ads, Meta…) se destacan: es lo que se mira en una campaña.

import { type WebDay, relativeChange, webSpark, webTotals } from "./metrics";
import type { DayRange } from "./period";
import { WEB_CHANNELS, type WebChannel } from "./provider";

export type TrafficChannel = Exclude<WebChannel, "all">;

export const PAID_CHANNELS: readonly TrafficChannel[] = ["paid_search", "paid_social"];

export type TrafficChannelRow = {
  channel: TrafficChannel;
  paid: boolean;
  sessions: number;
  /** Peso en las sesiones del periodo (0..1). */
  share: number;
  previousSessions: number | null;
  change: number | null;
  conversions: number;
  conversionRate: number | null;
  engagementRate: number | null;
  /** Sesiones por día (o por tramo) del periodo, para la minigráfica. */
  spark: (number | null)[];
};

export type TrafficChannels = {
  rows: TrafficChannelRow[];
  totalSessions: number;
  paid: { sessions: number; share: number; conversions: number; change: number | null };
};

/**
 * El desglose por canales. `byChannel` son los días de cada canal (sin "all"); null si aún no hay
 * ningún canal aparte del orgánico (propiedades sincronizadas antes de que existieran los canales).
 */
export function trafficChannels(
  byChannel: ReadonlyMap<TrafficChannel, readonly WebDay[]>,
  range: DayRange,
  compare: DayRange | null,
  bucketDays = 1,
): TrafficChannels | null {
  const hasBreakdown = [...byChannel.entries()].some(([channel, days]) => channel !== "organic_search" && days.length > 0);
  if (!hasBreakdown) return null;

  const rows = WEB_CHANNELS.map((channel): TrafficChannelRow => {
    const days = byChannel.get(channel) ?? [];
    const now = webTotals(days, range);
    const before = compare ? webTotals(days, compare) : null;
    return {
      channel,
      paid: PAID_CHANNELS.includes(channel),
      sessions: now.sessions,
      share: 0,
      previousSessions: before?.sessions ?? null,
      change: relativeChange(now.sessions, before?.sessions ?? null),
      conversions: now.conversions,
      conversionRate: now.conversionRate,
      engagementRate: now.engagementRate,
      spark: webSpark(days, range, "sessions", bucketDays),
    };
  }).filter((row) => row.sessions > 0 || (row.previousSessions ?? 0) > 0);

  const totalSessions = rows.reduce((sum, row) => sum + row.sessions, 0);
  for (const row of rows) row.share = totalSessions > 0 ? row.sessions / totalSessions : 0;
  rows.sort((a, b) => b.sessions - a.sessions);

  const paidRows = rows.filter((row) => row.paid);
  const paidSessions = paidRows.reduce((sum, row) => sum + row.sessions, 0);
  const paidBefore = compare ? paidRows.reduce((sum, row) => sum + (row.previousSessions ?? 0), 0) : null;
  return {
    rows,
    totalSessions,
    paid: {
      sessions: paidSessions,
      share: totalSessions > 0 ? paidSessions / totalSessions : 0,
      conversions: paidRows.reduce((sum, row) => sum + row.conversions, 0),
      change: relativeChange(paidSessions, paidBefore),
    },
  };
}
