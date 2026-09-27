import { describe, expect, it } from "vitest";
import { addDays } from "../dates/civil-date";
import type { TrafficChannel } from "../seo/channels";
import type { SearchDay, WebDay } from "../seo/metrics";
import { eachDay } from "../seo/period";
import type { ReportWebFacts } from "./types";
import { webReport } from "./web";

const AUGUST = "2026-08-01";

function searchDays(from: string, to: string, clicks: number, impressions: number, position: number): SearchDay[] {
  return eachDay({ from, to }).map((date) => ({ date, clicks, impressions, position }));
}

function webDays(from: string, to: string, sessions: number): WebDay[] {
  return eachDay({ from, to }).map((date) => ({ date, sessions, users: sessions, engagedSessions: 0, conversions: 0 }));
}

/** Julio (31 días) y agosto (31 días) completos. */
function facts(overrides: Partial<ReportWebFacts> = {}): ReportWebFacts {
  const byChannel = new Map<TrafficChannel, WebDay[]>([
    ["organic_search", [...webDays("2026-07-01", "2026-07-31", 20), ...webDays("2026-08-01", "2026-08-31", 30)]],
    ["direct", [...webDays("2026-07-01", "2026-07-31", 10), ...webDays("2026-08-01", "2026-08-31", 10)]],
    // Trajo visitas en julio y ninguna en agosto: no sale.
    ["email", webDays("2026-07-01", "2026-07-31", 1)],
  ]);
  return {
    site: "clinicamarblau.com",
    source: "gsc",
    searchSpan: { first: "2025-01-01", last: "2026-09-20" },
    webSpan: { first: "2025-01-01", last: "2026-09-20" },
    searchDays: [...searchDays("2026-07-01", "2026-07-31", 10, 100, 9), ...searchDays("2026-08-01", "2026-08-31", 12, 110, 8)],
    webAll: [...webDays("2026-07-01", "2026-07-31", 30), ...webDays("2026-08-01", "2026-08-31", 40)],
    webByChannel: byChannel,
    topQueries: [
      { key: "dentista mataró", clicks: 40, impressions: 400, position: 3.2, compareClicks: 30, compareImpressions: 380, comparePosition: 3.8 },
      { key: "  implantes dentales  ", clicks: 20, impressions: 900, position: 7.5, compareClicks: 25, compareImpressions: 800, comparePosition: 7.1 },
      { key: "sin clics", clicks: 0, impressions: 50, position: 20, compareClicks: 0, compareImpressions: 10, comparePosition: 22 },
    ],
    ...overrides,
  };
}

describe("webReport", () => {
  it("el mes frente al anterior cuando hay datos de los dos enteros", () => {
    const web = webReport(facts(), AUGUST)!;
    expect(web.site).toBe("clinicamarblau.com");
    expect(web.search).toMatchObject({
      range: { from: "2026-08-01", to: "2026-08-31" },
      complete: true,
      compared: true,
      clicks: { value: 372, previous: 310 },
      impressions: { value: 3410, previous: 3100 },
      position: { value: 8, previous: 9, gain: 1 },
    });
    expect(web.search!.clicks.change).toBeCloseTo(0.2);
    expect(web.visits).toMatchObject({ complete: true, compared: true, sessions: { value: 1240, previous: 930 } });
    expect(web.visits!.channels!.map((c) => [c.channel, c.sessions, c.previous])).toEqual([
      ["organic_search", 930, 620],
      ["direct", 310, 310],
    ]);
    expect(web.visits!.channels![0]!.share).toBeCloseTo(0.75);
    expect(web.visits!.channels![1]!.change).toBe(0);
  });

  it("las 5 búsquedas con más clics (sin las de cero), con los clics del mes anterior", () => {
    const web = webReport(facts(), AUGUST)!;
    expect(web.topQueries).toEqual([
      { query: "dentista mataró", clicks: 40, impressions: 400, position: 3.2, previousClicks: 30 },
      { query: "implantes dentales", clicks: 20, impressions: 900, position: 7.5, previousClicks: 25 },
    ]);
  });

  it("sin datos del mes anterior entero: cifras del mes, sin comparar", () => {
    const web = webReport(facts({ searchSpan: { first: "2026-07-10", last: "2026-09-20" }, webSpan: { first: "2026-07-10", last: "2026-09-20" } }), AUGUST)!;
    expect(web.search).toMatchObject({ complete: true, compared: false, clicks: { value: 372, previous: null, change: null } });
    expect(web.search!.position.gain).toBeNull();
    expect(web.visits!.compared).toBe(false);
    expect(web.visits!.channels!.every((c) => c.previous === null && c.change === null)).toBe(true);
    expect(web.topQueries[0]!.previousClicks).toBeNull();
  });

  it("un mes a medias dice qué días cubre y no compara", () => {
    const last = "2026-08-24";
    const web = webReport(
      facts({
        searchSpan: { first: "2025-01-01", last },
        webSpan: { first: "2025-01-01", last },
        searchDays: facts().searchDays.filter((d) => d.date <= last),
      }),
      AUGUST,
    )!;
    expect(web.search).toMatchObject({ range: { from: "2026-08-01", to: last }, complete: false, compared: false });
    expect(web.search!.clicks.value).toBe(12 * 24);
    expect(web.visits).toMatchObject({ range: { from: "2026-08-01", to: last }, complete: false });
  });

  it("sin desglose por canales (solo orgánico) no hay canales", () => {
    const web = webReport(facts({ webByChannel: new Map([["organic_search", webDays("2026-08-01", "2026-08-31", 5)]]) }), AUGUST)!;
    expect(web.visits!.channels).toBeNull();
  });

  it("sin datos del mes: null", () => {
    expect(webReport(facts({ searchSpan: { first: "2026-09-01", last: "2026-09-20" }, webSpan: null }), AUGUST)).toBeNull();
    const onlyWeb = webReport(facts({ searchSpan: null }), AUGUST)!;
    expect(onlyWeb.search).toBeNull();
    expect(onlyWeb.topQueries).toEqual([]);
    expect(onlyWeb.visits).not.toBeNull();
  });

  it("un día sin fila de Search Console cuenta como cero, sin romper la cobertura", () => {
    const withGap = facts().searchDays.filter((d) => d.date !== addDays(AUGUST, 9));
    const web = webReport(facts({ searchDays: withGap }), AUGUST)!;
    expect(web.search).toMatchObject({ complete: true, compared: true, clicks: { value: 360 } });
  });
});
