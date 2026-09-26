import { describe, expect, it } from "vitest";
import type { FunnelDeal, FunnelStage, StageChange } from "../pipeline";
import { channelBreakdown, defaultSeoSourceIds, nameWords, resolveSeoSourceIds, seoImpact } from "./attribution";

const sources = [
  { id: "web", name: "Web" },
  { id: "seo", name: "SEO" },
  { id: "meta", name: "Meta Ads" },
  { id: "google-ads", name: "Google Ads" },
  { id: "organic", name: "Google orgánico" },
  { id: "referral", name: "Referido" },
];

const stages: FunnelStage[] = [
  { id: "lead", name: "Lead", position: 1, kind: "open" },
  { id: "won", name: "Ganado", position: 2, kind: "won" },
  { id: "lost", name: "Perdido", position: 3, kind: "lost" },
];

function deal(id: string, sourceId: string | null, createdAt: string, stageId = "lead", oneOff = 0, mrr = 0): FunnelDeal {
  return {
    id,
    createdAt,
    stageId,
    sourceId,
    broughtById: null,
    ownerId: null,
    lossReasonId: null,
    estOneOffCents: oneOff,
    estMrrCents: mrr,
  };
}

describe("qué fuentes cuentan como SEO", () => {
  it("por defecto, las que se llaman como el canal (sin acentos ni mayúsculas); Google Ads no", () => {
    expect(nameWords("Google orgánico")).toEqual(["google", "organico"]);
    expect(defaultSeoSourceIds(sources)).toEqual(["web", "seo", "organic"]);
  });

  it("si la org lo ha decidido, manda su lista (aunque esté vacía)", () => {
    expect(resolveSeoSourceIds({ seo_source_ids: ["seo", "seo"] }, sources)).toEqual({ ids: ["seo"], custom: true });
    expect(resolveSeoSourceIds({ seo_source_ids: [] }, sources)).toEqual({ ids: [], custom: true });
    expect(resolveSeoSourceIds({ seo_source_ids: "seo" }, sources)).toEqual({ ids: ["web", "seo", "organic"], custom: false });
    expect(resolveSeoSourceIds(null, sources).custom).toBe(false);
  });
});

describe("SEO → negocio", () => {
  const range = { from: "2026-09-01T00:00:00.000Z", to: "2026-10-01T00:00:00.000Z" };
  const deals = [
    deal("d1", "seo", "2026-09-03T10:00:00Z", "won", 300_000, 45_000),
    deal("d2", "seo", "2026-09-10T10:00:00Z"),
    deal("d3", "web", "2026-08-10T10:00:00Z", "won", 0, 30_000), // creado antes, ganado en septiembre
    deal("d4", "meta", "2026-09-12T10:00:00Z", "lost"),
    deal("d5", null, "2026-09-15T10:00:00Z"),
  ];
  const history: StageChange[] = [
    { dealId: "d1", fromStageId: null, toStageId: "lead", changedAt: "2026-09-03T10:00:00Z" },
    { dealId: "d1", fromStageId: "lead", toStageId: "won", changedAt: "2026-09-20T10:00:00Z" },
    { dealId: "d3", fromStageId: null, toStageId: "lead", changedAt: "2026-08-10T10:00:00Z" },
    { dealId: "d3", fromStageId: "lead", toStageId: "won", changedAt: "2026-09-02T10:00:00Z" },
    { dealId: "d4", fromStageId: null, toStageId: "lead", changedAt: "2026-09-12T10:00:00Z" },
    { dealId: "d4", fromStageId: "lead", toStageId: "lost", changedAt: "2026-09-14T10:00:00Z" },
  ];
  const clients = [
    { id: "c1", sourceId: "seo", lifetimeBilledCents: 1_605_000 },
    { id: "c2", sourceId: "web", lifetimeBilledCents: 0 },
    { id: "c3", sourceId: "referral", lifetimeBilledCents: 624_000 },
    { id: "c4", sourceId: null, lifetimeBilledCents: 100_000 },
  ];
  const invoices = [
    { clientId: "c1", subtotalCents: 49_000 },
    { clientId: "c1", subtotalCents: -10_000 }, // rectificativa
    { clientId: "c3", subtotalCents: 60_000 },
    { clientId: "unknown", subtotalCents: 99_999 }, // cliente que ya no está: no cuenta
  ];

  it("por canal: leads por creación, ganados por cierre y facturación por la fuente del cliente", () => {
    const rows = channelBreakdown({ deals, history, stages, range, clients, invoices });
    const byId = new Map(rows.map((r) => [r.sourceId, r]));
    expect(byId.get("seo")).toEqual({
      sourceId: "seo",
      leads: 2,
      won: 1,
      wonOneOffCents: 300_000,
      wonMrrCents: 45_000,
      billedCents: 39_000,
      lifetimeBilledCents: 1_605_000,
      payingClients: 1,
    });
    expect(byId.get("web")).toMatchObject({ leads: 0, won: 1, wonMrrCents: 30_000, billedCents: 0, payingClients: 0 });
    expect(byId.get("meta")).toMatchObject({ leads: 1, won: 0 });
    expect(byId.get(null)).toMatchObject({ leads: 1, lifetimeBilledCents: 100_000 });
    // Primero lo que más factura en el periodo.
    expect(rows[0]!.sourceId).toBe("referral");
  });

  it("suma las fuentes de SEO y su parte del total", () => {
    const rows = channelBreakdown({ deals, history, stages, range, clients, invoices });
    const impact = seoImpact(rows, ["seo", "web"]);
    expect(impact).toMatchObject({ leads: 2, won: 2, billedCents: 39_000, lifetimeBilledCents: 1_605_000, payingClients: 1 });
    expect(impact.share.leads).toBeCloseTo(2 / 4);
    expect(impact.share.won).toBeCloseTo(1);
    expect(impact.share.billed).toBeCloseTo(39_000 / 99_000);
    expect(impact.share.lifetimeBilled).toBeCloseTo(1_605_000 / 2_329_000);
    expect(seoImpact([], ["seo"]).share.billed).toBeNull();
  });
});
