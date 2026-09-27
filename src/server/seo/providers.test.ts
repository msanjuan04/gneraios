import { describe, expect, it } from "vitest";
import type { FactSink, QueryDailyFact, SearchDailyFact, WebDailyFact } from "@/domain/seo";
import { GoogleClient } from "./google-api";
import { AnalyticsProvider, QUERY_ROWS_PER_DAY, SearchConsoleProvider } from "./providers";

const property = { id: "p1", orgId: "o1", gscSiteUrl: "sc-domain:gnerai.com", ga4PropertyId: "123" };

function sink() {
  const out = { daily: [] as SearchDailyFact[], queries: [] as QueryDailyFact[], web: [] as WebDailyFact[] };
  const s: FactSink = {
    searchDaily: async (rows) => void out.daily.push(...rows),
    queryDaily: async (rows) => void out.queries.push(...rows),
    webDaily: async (rows) => void out.web.push(...rows),
  };
  return { out, s };
}

function clientFor(handler: (url: string, body: Record<string, unknown>) => unknown) {
  const bodies: Record<string, unknown>[] = [];
  const client = new GoogleClient(
    { get: async () => "t", refresh: async () => "t" },
    {
      fetch: async (url, init) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        bodies.push(body);
        return new Response(JSON.stringify(handler(url, body)), { status: 200 });
      },
      minIntervalMs: 0,
    },
  );
  return { client, bodies };
}

describe("Search Console", () => {
  it("pide los totales por día y las consultas por fecha, consulta y página", async () => {
    const { client, bodies } = clientFor((_url, body) => {
      const dims = body.dimensions as string[];
      if (dims.length === 1) return { rows: [{ keys: ["2026-09-20"], clicks: 10, impressions: 200, position: 5.5 }] };
      return { rows: [{ keys: ["2026-09-20", "seo mataró", "https://gnerai.com/seo/"], clicks: 3, impressions: 40, position: 4.1 }] };
    });
    const { out, s } = sink();
    const rows = await new SearchConsoleProvider(client).fetchRange(property, { from: "2026-09-01", to: "2026-09-20" }, s);
    expect(rows).toBe(2);
    expect(out.daily).toEqual([{ metricOn: "2026-09-20", clicks: 10, impressions: 200, position: 5.5 }]);
    expect(out.queries).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ startDate: "2026-09-01", endDate: "2026-09-20", dimensions: ["date"], dataState: "final", type: "web" });
    expect(bodies[1]).toMatchObject({ dimensions: ["date", "query", "page"], rowLimit: 25_000, startRow: 0 });
  });

  it("pagina mientras llegan páginas llenas y, si la web es enorme, pasa a pedir día a día con tope", async () => {
    // 25.000 filas de un solo día por página: más de lo que se guarda por día.
    const full = Array.from({ length: 25_000 }, (_, i) => ({ keys: ["2026-09-01", `q${i}`, "https://x/"], clicks: 1, impressions: 2, position: 9 }));
    const { client, bodies } = clientFor((_url, body) => {
      const dims = body.dimensions as string[];
      if (dims.length === 1) return { rows: [] };
      if (dims.length === 3) return { rows: full };
      return { rows: [{ keys: ["día a día", "https://x/"], clicks: 2, impressions: 5, position: 3 }] };
    });
    const { out, s } = sink();
    await new SearchConsoleProvider(client).fetchRange(property, { from: "2026-09-01", to: "2026-09-02" }, s);
    const perDay = bodies.filter((b) => (b.dimensions as string[]).length === 2);
    expect(perDay.map((b) => [b.startDate, b.endDate, b.rowLimit])).toEqual([
      ["2026-09-01", "2026-09-01", QUERY_ROWS_PER_DAY],
      ["2026-09-02", "2026-09-02", QUERY_ROWS_PER_DAY],
    ]);
    expect(out.queries.map((q) => q.metricOn)).toEqual(["2026-09-01", "2026-09-02"]);
  });
});

describe("GA4", () => {
  it("pide el total del día y el desglose por canales, con las métricas en orden", async () => {
    const { client, bodies } = clientFor((_url, body) =>
      (body.dimensions as unknown[]).length === 1
        ? { rows: [{ dimensionValues: [{ value: "20260920" }], metricValues: [{ value: "100" }, { value: "80" }, { value: "60" }, { value: "2" }] }] }
        : {
            rows: [
              { dimensionValues: [{ value: "20260920" }, { value: "Organic Search" }], metricValues: [{ value: "60" }, { value: "50" }, { value: "40" }, { value: "1" }] },
              { dimensionValues: [{ value: "20260920" }, { value: "Paid Search" }], metricValues: [{ value: "40" }, { value: "30" }, { value: "20" }, { value: "1" }] },
            ],
          },
    );
    const { out, s } = sink();
    const rows = await new AnalyticsProvider(client).fetchRange(property, { from: "2026-09-01", to: "2026-09-20" }, s);
    expect(rows).toBe(3);
    expect(out.web.map((w) => w.channel)).toEqual(["all", "organic_search", "paid_search"]);
    expect(bodies[0]!.metrics).toEqual([{ name: "sessions" }, { name: "activeUsers" }, { name: "engagedSessions" }, { name: "keyEvents" }]);
    expect(bodies[1]!.dimensions).toEqual([{ name: "date" }, { name: "sessionDefaultChannelGroup" }]);
    expect(bodies.some((b) => "dimensionFilter" in b)).toBe(false);
  });
});
