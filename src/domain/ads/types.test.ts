import { describe, expect, it } from "vitest";
import {
  AD_TYPES,
  adsTotals,
  adTypesForProvider,
  campaignsForAdType,
  countOf,
  isAdsCampaign,
  isAdsSnapshotFresh,
  microsToCents,
  moneyToCents,
  type AdsCampaign,
} from "./types";

const campaign = (over: Partial<AdsCampaign>): AdsCampaign => ({ id: "c", name: "Campaña", channel: null, impressions: 0, clicks: 0, spend_cents: 0, ...over });

describe("tipos de anuncio y plataformas", () => {
  it("Google Ads y YouTube Ads comparten la conexión de Google; el resto va una a una", () => {
    expect(adTypesForProvider("google")).toEqual(["google", "youtube"]);
    expect(adTypesForProvider("openai")).toEqual(["chatgpt"]);
    expect(adTypesForProvider("meta")).toEqual(["meta"]);
    expect(adTypesForProvider("linkedin")).toEqual(["linkedin"]);
    expect(AD_TYPES).toHaveLength(5);
  });

  it("en Google, las campañas de vídeo son YouTube Ads y las demás Google Ads", () => {
    const video = campaign({ id: "v", channel: "video" });
    const search = campaign({ id: "s", channel: "search" });
    const pmax = campaign({ id: "p", channel: "performance_max" });
    expect(campaignsForAdType("youtube", [video, search, pmax]).map((c) => c.id)).toEqual(["v"]);
    expect(campaignsForAdType("google", [video, search, pmax]).map((c) => c.id)).toEqual(["s", "p"]);
    // En Meta todo cuenta, tenga o no canal.
    expect(campaignsForAdType("meta", [video, search])).toHaveLength(2);
  });
});

describe("totales y dinero", () => {
  it("suma impresiones, clics e inversión y saca el CTR de los totales", () => {
    const totals = adsTotals([
      campaign({ impressions: 1000, clicks: 10, spend_cents: 12_34 }),
      campaign({ impressions: 3000, clicks: 90, spend_cents: 87_66 }),
    ]);
    expect(totals).toEqual({ impressions: 4000, clicks: 100, spend_cents: 100_00, ctr: 0.025 });
    expect(adsTotals([]).ctr).toBeNull();
  });

  it("convierte importes decimales y micros a céntimos enteros, y lo raro a 0", () => {
    expect(moneyToCents("12.34")).toBe(1234);
    expect(moneyToCents(0.1 + 0.2)).toBe(30);
    expect(moneyToCents("nada")).toBe(0);
    expect(microsToCents(1_234_560)).toBe(123);
    expect(microsToCents("5000000")).toBe(500);
    expect(countOf("42")).toBe(42);
    expect(countOf(-3)).toBe(0);
    expect(countOf(undefined)).toBe(0);
  });
});

describe("frescura de la caché", () => {
  const now = new Date("2026-10-02T20:00:00Z");
  it("vale 15 minutos", () => {
    expect(isAdsSnapshotFresh(new Date("2026-10-02T19:50:00Z"), now)).toBe(true);
    expect(isAdsSnapshotFresh("2026-10-02T19:44:59Z", now)).toBe(false);
    expect(isAdsSnapshotFresh(null, now)).toBe(false);
  });
});

describe("lectura de la caché", () => {
  it("acepta solo campañas con la forma esperada", () => {
    expect(isAdsCampaign(campaign({}))).toBe(true);
    expect(isAdsCampaign({ id: "x", name: "y", impressions: "1" })).toBe(false);
    expect(isAdsCampaign(null)).toBe(false);
  });
});
