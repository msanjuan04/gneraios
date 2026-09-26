import { describe, expect, it } from "vitest";
import {
  fillSearchDays,
  performanceSeries,
  positionGain,
  ratioDiff,
  relativeChange,
  type SearchDay,
  searchSpark,
  searchTotals,
  sparkBucketDays,
  type WebDay,
  webSpark,
  webTotals,
} from "./metrics";

const day = (date: string, clicks: number, impressions: number, position: number | null): SearchDay => ({
  date,
  clicks,
  impressions,
  position,
});

describe("totales del periodo", () => {
  it("el CTR es clics / impresiones del periodo y la posición se pondera por impresiones", () => {
    const days = [day("2026-09-01", 10, 100, 2), day("2026-09-02", 0, 300, 6), day("2026-09-03", 5, 0, null)];
    const totals = searchTotals(days, { from: "2026-09-01", to: "2026-09-30" });
    expect(totals.clicks).toBe(15);
    expect(totals.impressions).toBe(400);
    expect(totals.ctr).toBeCloseTo(0.0375);
    // Media de CTR diarios sería (0,1 + 0) / 2 = 5 %; media simple de posiciones, 4.
    expect(totals.position).toBeCloseTo(5);
  });

  it("solo cuenta los días del rango, y sin impresiones no hay CTR ni posición", () => {
    const days = [day("2026-08-31", 99, 999, 1), day("2026-09-01", 1, 10, 3)];
    expect(searchTotals(days, { from: "2026-09-01", to: "2026-09-01" })).toMatchObject({ clicks: 1, impressions: 10 });
    expect(searchTotals([], { from: "2026-09-01", to: "2026-09-01" })).toEqual({ clicks: 0, impressions: 0, ctr: null, position: null });
  });

  it("GA4: sesiones y conversiones se suman; las tasas salen de los totales", () => {
    const web: WebDay[] = [
      { date: "2026-09-01", sessions: 100, users: 90, engagedSessions: 60, conversions: 2 },
      { date: "2026-09-02", sessions: 300, users: 250, engagedSessions: 120, conversions: 4 },
    ];
    const totals = webTotals(web, { from: "2026-09-01", to: "2026-09-02" });
    expect(totals).toMatchObject({ sessions: 400, engagedSessions: 180, conversions: 6 });
    expect(totals.engagementRate).toBeCloseTo(0.45);
    expect(totals.conversionRate).toBeCloseTo(0.015);
  });
});

describe("variaciones", () => {
  it("relativa, en posiciones (subir es positivo) y en puntos", () => {
    expect(relativeChange(120, 100)).toBeCloseTo(0.2);
    expect(relativeChange(80, 100)).toBeCloseTo(-0.2);
    expect(relativeChange(5, 0)).toBeNull();
    expect(relativeChange(null, 10)).toBeNull();
    expect(positionGain(5, 8)).toBe(3);
    expect(positionGain(9.5, 8)).toBe(-1.5);
    expect(positionGain(null, 8)).toBeNull();
    expect(ratioDiff(0.031, 0.025)).toBeCloseTo(0.006);
  });
});

describe("series", () => {
  const range = { from: "2026-09-01", to: "2026-09-10" };

  it("rellena con ceros los días sin fila", () => {
    const filled = fillSearchDays([day("2026-09-03", 4, 40, 5)], { from: "2026-09-02", to: "2026-09-04" });
    expect(filled.map((d) => [d.date, d.clicks, d.position])).toEqual([
      ["2026-09-02", 0, null],
      ["2026-09-03", 4, 5],
      ["2026-09-04", 0, null],
    ]);
  });

  it("las sparklines agrupan hacia atrás desde el final, en media diaria (un tramo incompleto no se hunde)", () => {
    const days = Array.from({ length: 10 }, (_, i) => day(`2026-09-${String(i + 1).padStart(2, "0")}`, 10, 100, 3));
    expect(searchSpark(days, range, "clicks", 1)).toHaveLength(10);
    // 10 días en tramos de 4: [2] [4] [4], siempre 10 clics por día.
    expect(searchSpark(days, range, "clicks", 4)).toEqual([10, 10, 10]);
    expect(searchSpark(days, range, "ctr", 4)).toEqual([0.1, 0.1, 0.1]);
    const web: WebDay[] = [{ date: "2026-09-10", sessions: 20, users: 18, engagedSessions: 10, conversions: 1 }];
    expect(webSpark(web, range, "sessions", 5)).toEqual([0, 4]);
    expect(webSpark(web, range, "engagementRate", 5)).toEqual([null, 0.5]);
    expect(sparkBucketDays(28)).toBe(1);
    expect(sparkBucketDays(92)).toBe(3);
    expect(sparkBucketDays(365)).toBe(7);
  });

  it("la gráfica principal alinea cada día con el mismo índice del periodo de comparación", () => {
    const days = [day("2026-09-01", 3, 30, 4), day("2026-08-01", 1, 10, 9)];
    const series = performanceSeries(days, { from: "2026-09-01", to: "2026-09-02" }, { from: "2026-08-01", to: "2026-08-02" });
    expect(series).toEqual([
      { date: "2026-09-01", clicks: 3, impressions: 30, compareDate: "2026-08-01", compareClicks: 1, compareImpressions: 10 },
      { date: "2026-09-02", clicks: 0, impressions: 0, compareDate: "2026-08-02", compareClicks: 0, compareImpressions: 0 },
    ]);
    expect(performanceSeries(days, { from: "2026-09-01", to: "2026-09-01" }, null)[0]).toMatchObject({ compareClicks: null });
  });
});
