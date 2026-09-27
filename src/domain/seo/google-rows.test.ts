import { describe, expect, it } from "vitest";
import { parseGa4Rows, parseGscDateRows, parseGscQueryRows, roundPosition, ga4Channel, parseGa4ChannelRows } from "./google-rows";

describe("Search Console", () => {
  it("totales por día: redondea recuentos y posición, e ignora lo que no entiende", () => {
    const response = {
      rows: [
        { keys: ["2026-09-20"], clicks: 12, impressions: 400.0, ctr: 0.03, position: 7.45678 },
        { keys: ["2026-09-21"], clicks: 0, impressions: 0, ctr: 0, position: 0 },
        { keys: ["20260922"], clicks: 1, impressions: 2 },
        { keys: [1] },
        "basura",
      ],
      responseAggregationType: "byProperty",
    };
    expect(parseGscDateRows(response)).toEqual([
      { metricOn: "2026-09-20", clicks: 12, impressions: 400, position: 7.46 },
      { metricOn: "2026-09-21", clicks: 0, impressions: 0, position: null },
    ]);
    expect(parseGscDateRows({})).toEqual([]);
    expect(parseGscDateRows(null)).toEqual([]);
  });

  it("consultas por fecha, consulta y página, o de un solo día", () => {
    const byDate = { rows: [{ keys: ["2026-09-20", "diseño web mataró", "https://gnerai.com/web/"], clicks: 3, impressions: 90, position: 4.2 }] };
    expect(parseGscQueryRows(byDate)).toEqual([
      { metricOn: "2026-09-20", query: "diseño web mataró", page: "https://gnerai.com/web/", clicks: 3, impressions: 90, position: 4.2 },
    ]);
    const oneDay = { rows: [{ keys: ["seo local", "https://gnerai.com/seo/"], clicks: 0, impressions: 12, position: 0.4 }] };
    expect(parseGscQueryRows(oneDay, "2026-09-21")).toEqual([
      { metricOn: "2026-09-21", query: "seo local", page: "https://gnerai.com/seo/", clicks: 0, impressions: 12, position: 1 },
    ]);
  });

  it("la posición nunca es mejor que la 1", () => {
    expect(roundPosition(0.99)).toBe(1);
    expect(roundPosition(12.345)).toBe(12.35);
    expect(roundPosition("3")).toBeNull();
  });
});

describe("GA4", () => {
  it("convierte la fecha YYYYMMDD y lee las métricas en el orden pedido", () => {
    const response = {
      dimensionHeaders: [{ name: "date" }],
      metricHeaders: [{ name: "sessions" }, { name: "activeUsers" }, { name: "engagedSessions" }, { name: "keyEvents" }],
      rows: [
        { dimensionValues: [{ value: "20260920" }], metricValues: [{ value: "140" }, { value: "120" }, { value: "81" }, { value: "3.0" }] },
        { dimensionValues: [{ value: "(other)" }], metricValues: [{ value: "1" }] },
      ],
      rowCount: 2,
    };
    expect(parseGa4Rows(response, "organic_search")).toEqual([
      { metricOn: "2026-09-20", channel: "organic_search", sessions: 140, users: 120, engagedSessions: 81, conversions: 3 },
    ]);
    expect(parseGa4Rows({ rowCount: 0 }, "all")).toEqual([]);
  });
});

describe("canales de GA4", () => {
  const cell = (value: string) => ({ value });
  const row = (date: string, group: string, sessions: number) => ({
    dimensionValues: [cell(date), cell(group)],
    metricValues: [cell(String(sessions)), cell(String(sessions - 5)), cell(String(Math.floor(sessions / 2))), cell("1")],
  });

  it("agrupa los canales de GA4 en los de GNERAI OS y suma por día", () => {
    const facts = parseGa4ChannelRows({
      rows: [
        row("20260920", "Organic Search", 100),
        row("20260920", "Paid Search", 30),
        row("20260920", "Paid Shopping", 10),
        row("20260920", "Unassigned", 4),
        row("20260921", "Paid Social", 12),
      ],
    });
    const byKey = Object.fromEntries(facts.map((f) => [`${f.metricOn}|${f.channel}`, f.sessions]));
    expect(byKey).toEqual({
      "2026-09-20|organic_search": 100,
      "2026-09-20|paid_search": 40,
      "2026-09-20|other": 4,
      "2026-09-21|paid_social": 12,
    });
    expect(facts.find((f) => f.channel === "paid_search")?.conversions).toBe(2);
  });

  it("un grupo desconocido va a other", () => {
    expect(ga4Channel("Organic Video")).toBe("other");
    expect(ga4Channel("Direct")).toBe("direct");
    expect(parseGa4ChannelRows({ rowCount: 0 })).toEqual([]);
  });
});
