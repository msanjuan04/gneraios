// «Datos de tu web» del informe: lo que miden Search Console y GA4 del mes frente al mes
// anterior. Solo cifras medidas, tal cual: nada de estimaciones, previsiones ni valoraciones. Si
// no hay datos de los dos meses enteros no se compara (comparar con un mes a medias engaña), y si
// el mes aún no está completo se dice qué días cubre.

import { compareCivil, maxCivil, minCivil } from "../dates/civil-date";
import { addMonths, type Month } from "../metrics/months";
import { trafficChannels } from "../seo/channels";
import { positionGain, relativeChange, searchTotals, webTotals } from "../seo/metrics";
import { covers, type DataSpan, type DayRange } from "../seo/period";
import { monthDays } from "./month";
import type { ReportMetric, ReportQuery, ReportSearchBlock, ReportVisitsBlock, ReportWeb, ReportWebFacts } from "./types";

/** Consultas del informe: las que más clics han traído en el mes. */
export const TOP_QUERIES_LIMIT = 5;

/** Los días del rango que cubren los datos, o null si no se tocan. */
function coveredDays(span: DataSpan, range: DayRange): DayRange | null {
  if (!span) return null;
  const from = maxCivil(span.first, range.from);
  const to = minCivil(span.last, range.to);
  return compareCivil(from, to) <= 0 ? { from, to } : null;
}

function metric(value: number, previous: number | null): ReportMetric {
  return { value, previous, change: relativeChange(value, previous) };
}

function searchBlock(facts: ReportWebFacts, current: DayRange, previous: DayRange): ReportSearchBlock | null {
  const range = coveredDays(facts.searchSpan, current);
  if (!range) return null;
  const complete = covers(facts.searchSpan, current);
  const compared = complete && covers(facts.searchSpan, previous);
  const now = searchTotals(facts.searchDays, current);
  const before = compared ? searchTotals(facts.searchDays, previous) : null;
  return {
    range,
    complete,
    compared,
    clicks: metric(now.clicks, before?.clicks ?? null),
    impressions: metric(now.impressions, before?.impressions ?? null),
    position: { value: now.position, previous: before?.position ?? null, gain: positionGain(now.position, before?.position ?? null) },
  };
}

function visitsBlock(facts: ReportWebFacts, current: DayRange, previous: DayRange): ReportVisitsBlock | null {
  const range = coveredDays(facts.webSpan, current);
  if (!range) return null;
  const complete = covers(facts.webSpan, current);
  const compared = complete && covers(facts.webSpan, previous);
  const now = webTotals(facts.webAll, current);
  const before = compared ? webTotals(facts.webAll, previous) : null;
  const breakdown = trafficChannels(facts.webByChannel, current, compared ? previous : null);
  return {
    range,
    complete,
    compared,
    sessions: metric(now.sessions, before?.sessions ?? null),
    // Solo los canales que han traído visitas este mes: uno a cero no es «de dónde vienen».
    channels: breakdown
      ? breakdown.rows
          .filter((row) => row.sessions > 0)
          .map((row) => ({
            channel: row.channel,
            paid: row.paid,
            sessions: row.sessions,
            previous: compared ? row.previousSessions : null,
            change: compared ? row.change : null,
            share: row.share,
          }))
      : null,
  };
}

/** El bloque de la web del mes, o null si no hay ningún dato medido de ese mes. */
export function webReport(facts: ReportWebFacts, month: Month): ReportWeb | null {
  const current = monthDays(month);
  const previous = monthDays(addMonths(month, -1));
  const search = searchBlock(facts, current, previous);
  const visits = visitsBlock(facts, current, previous);
  if (!search && !visits) return null;

  const topQueries: ReportQuery[] = search
    ? facts.topQueries
        .filter((query) => query.clicks > 0 && query.key.trim() !== "")
        .slice(0, TOP_QUERIES_LIMIT)
        .map((query) => ({
          query: query.key.trim(),
          clicks: query.clicks,
          impressions: query.impressions,
          position: query.position,
          previousClicks: search.compared ? query.compareClicks : null,
        }))
    : [];

  return { site: facts.site, source: facts.source, search, visits, topQueries };
}
