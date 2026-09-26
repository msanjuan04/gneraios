import { describe, expect, it } from "vitest";
import { createRandom, type DemoSiteProfile, generateDemoSite, hashSeed } from "./demo";
import { searchTotals } from "./metrics";

const profile: DemoSiteProfile = {
  seed: "test-site",
  origin: "https://ejemplo.example",
  pages: ["/", "/servicios/", "/blog/guia/"],
  queries: [
    { text: "ejemplo", page: 0, volume: 900, from: 1.2, to: 1.1, brand: true },
    { text: "servicio mataró", page: 1, altPage: 0, volume: 1500, from: 14, to: 5 },
    { text: "guía completa", page: 2, volume: 600, from: 30, to: 9, since: 0.5 },
  ],
  longTail: { heads: ["servicio"], tails: ["barato", "precio", "cerca"], page: 1, volume: [15, 60], position: [12, 30] },
  seasonality: [0.9, 0.95, 1, 1, 1.05, 1.1, 1.1, 0.8, 1.05, 1.05, 1, 0.9],
  weekday: [0.7, 1.1, 1.1, 1.1, 1.05, 1, 0.75],
  growth: 1.3,
  anonymizedShare: 0.2,
  web: { organicShare: [0.4, 0.55], sessionsPerClick: 1.08, engagementRate: 0.6, organicConversionRate: 0.02, otherConversionRate: 0.01 },
};
const range = { from: "2025-06-01", to: "2026-05-31" };

describe("datos de demo", () => {
  it("son deterministas", () => {
    expect(generateDemoSite(profile, range)).toEqual(generateDemoSite(profile, range));
    expect(hashSeed("a")).not.toBe(hashSeed("b"));
    const a = createRandom(1);
    const b = createRandom(1);
    expect([a.next(), a.next()]).toEqual([b.next(), b.next()]);
  });

  it("son coherentes: clics ≤ impresiones, posiciones ≥ 1 y totales ≥ lo desglosado por consulta", () => {
    const data = generateDemoSite(profile, range);
    for (const row of data.queries) {
      expect(row.clicks).toBeLessThanOrEqual(row.impressions);
      expect(row.impressions).toBeGreaterThan(0);
      expect(row.position).toBeGreaterThanOrEqual(1);
      expect(row.page.startsWith("https://ejemplo.example/")).toBe(true);
    }
    const byDay = new Map<string, number>();
    for (const row of data.queries) byDay.set(row.metricOn, (byDay.get(row.metricOn) ?? 0) + row.impressions);
    for (const day of data.daily) expect(day.impressions).toBeGreaterThanOrEqual(byDay.get(day.metricOn) ?? 0);
    // GA4: dos canales por día y el orgánico nunca supera al total.
    expect(data.web).toHaveLength(2 * 365);
    for (let i = 0; i < data.web.length; i += 2) {
      expect(data.web[i + 1]!.sessions).toBeLessThanOrEqual(data.web[i]!.sessions);
      expect(data.web[i]!.engagedSessions).toBeLessThanOrEqual(data.web[i]!.sessions);
    }
  });

  it("cuentan una historia: el trabajo de SEO sube las posiciones y los clics", () => {
    const data = generateDemoSite(profile, range);
    // Sin la marca, que ya estaba arriba: la consulta trabajada pasa de la segunda página a la primera.
    const worked = data.queries
      .filter((q) => q.query === "servicio mataró")
      .map((q) => ({ date: q.metricOn, clicks: q.clicks, impressions: q.impressions, position: q.position }));
    const start = searchTotals(worked, { from: "2025-06-01", to: "2025-07-31" });
    const end = searchTotals(worked, { from: "2026-04-01", to: "2026-05-31" });
    expect(end.clicks).toBeGreaterThan(start.clicks * 3);
    expect(end.position!).toBeLessThan(start.position! - 5);
    const days = data.daily.map((d) => ({ date: d.metricOn, clicks: d.clicks, impressions: d.impressions, position: d.position }));
    expect(searchTotals(days, { from: "2026-04-01", to: "2026-05-31" }).clicks).toBeGreaterThan(
      searchTotals(days, { from: "2025-06-01", to: "2025-07-31" }).clicks,
    );
    // El contenido nuevo aparece a mitad de periodo.
    const guide = data.queries.filter((q) => q.query === "guía completa");
    expect(guide.length).toBeGreaterThan(0);
    expect(guide.every((q) => q.metricOn >= "2025-11-30")).toBe(true);
    // La cola larga existe y tiene pocas impresiones por día.
    expect(data.queries.some((q) => q.query === "servicio barato")).toBe(true);
  });
});
