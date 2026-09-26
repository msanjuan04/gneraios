// Sin "server-only" (lo usa la sincronización); solo servidor.
//
// Los dos proveedores de hoy detrás de `SeoProvider` (src/domain/seo/provider.ts):
// - Search Console: totales por día (una petición para todo el tramo) y consultas × páginas × día,
//   paginando de 25.000 en 25.000. Si una web es tan grande que el tramo no cabe en unas pocas
//   páginas, se pide día a día con un tope de filas por día (las de más clics).
// - GA4: sesiones, usuarios activos, sesiones con interacción y eventos clave por día, de todo el
//   tráfico y solo de la búsqueda orgánica.

import { addDays, type CivilDate, daysInclusive } from "@/domain/dates/civil-date";
import {
  capQueryRows,
  type DayRange,
  eachDay,
  type FactSink,
  GA4_METRICS,
  historyStart,
  parseGa4Rows,
  parseGscDateRows,
  parseGscQueryRows,
  type QueryDailyFact,
  type SeoProvider,
  type SyncProperty,
} from "@/domain/seo";
import { type GoogleClient, runGa4Report, searchAnalyticsQuery } from "./google-api";

/** Filas por petición de Search Console (el máximo que admite). */
const GSC_ROW_LIMIT = 25_000;
/** Filas de consultas que se guardan por día, como mucho. */
export const QUERY_ROWS_PER_DAY = 5_000;
/** Páginas de un tramo antes de pasar a pedirlo día a día. */
const GSC_MAX_PAGES = 6;

export class SearchConsoleProvider implements SeoProvider {
  readonly id = "gsc" as const;
  readonly windowDays = 30;
  // Search Console consolida con 2-3 días de retraso ("final"): se vuelven a pedir los últimos 5.
  readonly resyncDays = 5;

  constructor(private readonly client: GoogleClient) {}

  appliesTo(property: SyncProperty): boolean {
    return property.gscSiteUrl !== null;
  }

  availability(today: CivilDate): DayRange {
    return { from: historyStart(today), to: addDays(today, -1) };
  }

  async fetchRange(property: SyncProperty, range: DayRange, sink: FactSink): Promise<number> {
    const site = property.gscSiteUrl!;
    const base = { startDate: range.from, endDate: range.to, type: "web", dataState: "final" };

    const totals = parseGscDateRows(
      await searchAnalyticsQuery(this.client, site, { ...base, dimensions: ["date"], rowLimit: GSC_ROW_LIMIT }),
    );
    await sink.searchDaily(totals);

    const rows = capQueryRows(await this.#queryRows(site, range), QUERY_ROWS_PER_DAY);
    await sink.queryDaily(rows);
    return totals.length + rows.length;
  }

  async #queryRows(site: string, range: DayRange): Promise<QueryDailyFact[]> {
    const days = daysInclusive(range.from, range.to);
    const rows: QueryDailyFact[] = [];
    for (let page = 0; page < GSC_MAX_PAGES; page++) {
      const batch = parseGscQueryRows(
        await searchAnalyticsQuery(this.client, site, {
          startDate: range.from,
          endDate: range.to,
          type: "web",
          dataState: "final",
          dimensions: ["date", "query", "page"],
          rowLimit: GSC_ROW_LIMIT,
          startRow: page * GSC_ROW_LIMIT,
        }),
      );
      rows.push(...batch);
      if (batch.length < GSC_ROW_LIMIT) return rows;
      // Una web que da más filas por día de las que se guardan: mejor día a día, con tope.
      if (rows.length / days > QUERY_ROWS_PER_DAY) break;
    }
    const perDay: QueryDailyFact[] = [];
    for (const day of eachDay(range)) {
      perDay.push(
        ...parseGscQueryRows(
          await searchAnalyticsQuery(this.client, site, {
            startDate: day,
            endDate: day,
            type: "web",
            dataState: "final",
            dimensions: ["query", "page"],
            rowLimit: QUERY_ROWS_PER_DAY,
          }),
          day,
        ),
      );
    }
    return perDay;
  }
}

export class AnalyticsProvider implements SeoProvider {
  readonly id = "ga4" as const;
  // Una fila por día y canal: un tramo largo cabe en una sola petición.
  readonly windowDays = 120;
  readonly resyncDays = 3;

  constructor(private readonly client: GoogleClient) {}

  appliesTo(property: SyncProperty): boolean {
    return property.ga4PropertyId !== null;
  }

  availability(today: CivilDate): DayRange {
    return { from: historyStart(today), to: addDays(today, -1) };
  }

  async fetchRange(property: SyncProperty, range: DayRange, sink: FactSink): Promise<number> {
    const id = property.ga4PropertyId!;
    const body = {
      dateRanges: [{ startDate: range.from, endDate: range.to }],
      dimensions: [{ name: "date" }],
      metrics: GA4_METRICS.map((name) => ({ name })),
      limit: 100_000,
      keepEmptyRows: false,
    };
    const all = parseGa4Rows(await runGa4Report(this.client, id, body), "all");
    const organic = parseGa4Rows(
      await runGa4Report(this.client, id, {
        ...body,
        dimensionFilter: {
          filter: { fieldName: "sessionDefaultChannelGroup", stringFilter: { matchType: "EXACT", value: "Organic Search" } },
        },
      }),
      "organic_search",
    );
    const rows = [...all, ...organic];
    await sink.webDaily(rows);
    return rows.length;
  }
}
