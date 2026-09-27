import { describe, expect, it } from "vitest";
import type { MemberCost } from "./costs";
import {
  buildProfitability,
  clientFigures,
  type ContractLineRevenue,
  figuresOf,
  flagsOf,
  type InvoiceRevenue,
  marginChartClients,
  needsAttention,
  type ProfitabilityInput,
  type ProfitabilityReport,
  type ProjectRef,
  type TimeEntryRef,
} from "./report";
import type { ProfitabilitySettings } from "./settings";

const SETTINGS: ProfitabilitySettings = { defaultHourlyCostCents: 3000, minMarginBps: 3000, minHourlyRateCents: 4500 };

const LAIA = "m-laia";
const PAU = "m-pau";

const COSTS: MemberCost[] = [
  { memberId: LAIA, validFrom: "2026-01-01", hourlyCostCents: 3500 },
  { memberId: PAU, validFrom: "2026-01-01", hourlyCostCents: 2500 },
];

function project(id: string, clientId: string | null, contractId: string | null = null, name = id): ProjectRef {
  return { id, clientId, contractId, name, status: "active", archived: false };
}

function hours(projectId: string, h: number, memberId = LAIA, workedOn = "2026-09-10"): TimeEntryRef {
  return { memberId, projectId, workedOn, minutes: h * 60 };
}

function input(overrides: Partial<ProfitabilityInput>): ProfitabilityInput {
  return {
    invoices: [],
    contractLines: [],
    projects: [],
    entries: [],
    costs: COSTS,
    clients: [
      { id: "c-celler", name: "Celler Turó d'Alella" },
      { id: "c-dental", name: "Clínica Dental Mar Blau" },
      { id: "c-hotel", name: "Hotel Llevant" },
    ],
    settings: SETTINGS,
    ...overrides,
  };
}

const invoice = (invoiceId: string, clientId: string, baseCents: number): InvoiceRevenue => ({ invoiceId, clientId, baseCents });
const line = (invoiceId: string, contractId: string, baseCents: number): ContractLineRevenue => ({ invoiceId, contractId, baseCents });

/** Lo que tiene que cumplir siempre: cada cliente suma sus filas y el total suma los clientes. */
function expectConsistent(report: ProfitabilityReport) {
  for (const client of report.clients) {
    expect(client.projects.reduce((s, p) => s + p.revenueCents, 0)).toBe(client.revenueCents);
    expect(client.projects.reduce((s, p) => s + p.costCents, 0)).toBe(client.costCents);
    expect(client.projects.reduce((s, p) => s + p.minutes, 0)).toBe(client.minutes);
    expect(client.marginCents).toBe(client.revenueCents - client.costCents);
    for (const p of client.projects) expect(p.revenueCents).toBe(p.contractRevenueCents + p.allocatedRevenueCents + (p.projectId === null ? p.revenueCents : 0));
  }
  expect(report.totals.revenueCents).toBe(report.clients.reduce((s, c) => s + c.revenueCents, 0));
  expect(report.totals.costCents).toBe(report.clients.reduce((s, c) => s + c.costCents, 0));
  expect(report.totals.minutes).toBe(report.clients.reduce((s, c) => s + c.minutes, 0));
}

describe("cifras (figuresOf)", () => {
  it("margen, margen % sobre ingresos y €/hora efectivo", () => {
    // 3.000 € facturados, 40 h a 35 €/h = 1.400 € de coste.
    expect(figuresOf(300_000, 140_000, 2400, SETTINGS)).toEqual({
      revenueCents: 300_000,
      costCents: 140_000,
      minutes: 2400,
      marginCents: 160_000,
      marginBps: 5333,
      rateCents: 7500,
      flags: [],
    });
  });

  it("sin horas ni ingresos no divide por cero: margen % y €/hora quedan vacíos", () => {
    expect(figuresOf(0, 0, 0, SETTINGS)).toEqual({
      revenueCents: 0,
      costCents: 0,
      minutes: 0,
      marginCents: 0,
      marginBps: null,
      rateCents: null,
      flags: [],
    });
    // Ingresos sin horas: margen del 100 % y sin €/hora.
    expect(figuresOf(50_000, 0, 0, SETTINGS)).toMatchObject({ marginBps: 10_000, rateCents: null, flags: ["revenueWithoutHours"] });
    // Horas sin ingresos: todo el coste es pérdida; margen % vacío y €/hora 0.
    expect(figuresOf(0, 7000, 120, SETTINGS)).toMatchObject({ marginCents: -7000, marginBps: null, rateCents: 0, flags: ["hoursWithoutRevenue"] });
    // Ingresos negativos (manda una rectificativa): tampoco hay margen % que dar.
    expect(figuresOf(-10_000, 0, 0, SETTINGS)).toMatchObject({ marginBps: null, flags: [] });
  });

  it("avisos con los umbrales de la org (estrictamente por debajo)", () => {
    // Margen del 30 % justo y 45 €/h justos: no avisa.
    expect(flagsOf({ revenueCents: 450_000, minutes: 6000, marginBps: 3000, rateCents: 4500 }, SETTINGS)).toEqual([]);
    expect(flagsOf({ revenueCents: 450_000, minutes: 6000, marginBps: 2999, rateCents: 4499 }, SETTINGS)).toEqual(["lowMargin", "lowRate"]);
    // Pérdidas: margen negativo.
    expect(figuresOf(100_000, 150_000, 1000, SETTINGS).flags).toEqual(["lowMargin"]);
    // Sin ingresos, el €/hora bajo no se repite: ya lo dice «horas sin facturar».
    expect(figuresOf(0, 3000, 60, SETTINGS).flags).toEqual(["hoursWithoutRevenue"]);
    expect(flagsOf({ revenueCents: 1, minutes: 60, marginBps: 0, rateCents: 1 }, { ...SETTINGS, minMarginBps: 0, minHourlyRateCents: 0 })).toEqual([]);
  });

  it("«Por hacer» cuenta margen bajo, €/hora bajo y horas sin facturar; «sin horas» solo informa", () => {
    expect(needsAttention({ flags: ["revenueWithoutHours"] })).toBe(false);
    expect(needsAttention({ flags: [] })).toBe(false);
    expect(needsAttention({ flags: ["lowRate"] })).toBe(true);
    expect(needsAttention({ flags: ["hoursWithoutRevenue"] })).toBe(true);
  });
});

describe("buildProfitability", () => {
  it("un cliente, un proyecto con contrato: lo facturado del contrato y las horas por su coste", () => {
    const report = buildProfitability(
      input({
        invoices: [invoice("f1", "c-celler", 300_000)],
        contractLines: [line("f1", "k-tienda", 300_000)],
        projects: [project("p-tienda", "c-celler", "k-tienda", "Tienda online")],
        entries: [hours("p-tienda", 30, LAIA), hours("p-tienda", 10, PAU)],
      }),
    );
    expect(report.clients).toHaveLength(1);
    const [client] = report.clients;
    // 30 h × 35 € + 10 h × 25 € = 1.300 €.
    expect(client).toMatchObject({
      clientId: "c-celler",
      name: "Celler Turó d'Alella",
      revenueCents: 300_000,
      costCents: 130_000,
      minutes: 2400,
      marginCents: 170_000,
      marginBps: 5667,
      rateCents: 7500,
      flags: [],
      allocatedRevenueCents: 0,
      unassignedRevenueCents: 0,
    });
    expect(client!.projects).toEqual([
      expect.objectContaining({ projectId: "p-tienda", name: "Tienda online", revenueCents: 300_000, contractRevenueCents: 300_000, sharedContract: false }),
    ]);
    expect(report.defaultCostMinutes).toBe(0);
    expectConsistent(report);
  });

  it("el coste de cada hora es el vigente el día trabajado, y sin coste propio, el de la org", () => {
    const report = buildProfitability(
      input({
        costs: [
          { memberId: LAIA, validFrom: "2026-01-01", hourlyCostCents: 3000 },
          { memberId: LAIA, validFrom: "2026-09-15", hourlyCostCents: 4000 },
        ],
        projects: [project("p1", "c-hotel")],
        entries: [
          hours("p1", 1, LAIA, "2026-09-14"),
          hours("p1", 1, LAIA, "2026-09-15"),
          hours("p1", 1, LAIA, "2025-12-31"), // antes de su primer coste: el de la org
          hours("p1", 2, PAU, "2026-09-20"), // Pau no tiene coste: el de la org
        ],
      }),
    );
    // 3000 + 4000 + 3000 (org) + 2 × 3000 (org) = 16.000.
    expect(report.clients[0]).toMatchObject({ costCents: 16_000, minutes: 300, revenueCents: 0, flags: ["hoursWithoutRevenue"] });
    expect(report.defaultCostMinutes).toBe(180);
  });

  it("el coste se redondea una vez por proyecto, no registro a registro", () => {
    const report = buildProfitability(
      input({
        costs: [{ memberId: LAIA, validFrom: "2026-01-01", hourlyCostCents: 2500 }],
        projects: [project("p1", "c-hotel")],
        entries: [1, 1, 1].map((m) => ({ memberId: LAIA, projectId: "p1", workedOn: "2026-09-01", minutes: m })),
      }),
    );
    expect(report.clients[0]!.costCents).toBe(125);
  });

  it("un contrato compartido se reparte por las horas del periodo; sin horas, a partes iguales", () => {
    const shared = buildProfitability(
      input({
        invoices: [invoice("f1", "c-dental", 100_000)],
        contractLines: [line("f1", "k-seo-ads", 100_000)],
        projects: [project("p-seo", "c-dental", "k-seo-ads"), project("p-ads", "c-dental", "k-seo-ads")],
        entries: [hours("p-seo", 3), hours("p-ads", 1)],
      }),
    );
    const rows = shared.clients[0]!.projects;
    expect(rows.map((r) => [r.projectId, r.revenueCents, r.sharedContract])).toEqual([
      ["p-seo", 75_000, true],
      ["p-ads", 25_000, true],
    ]);
    expectConsistent(shared);

    const idle = buildProfitability(
      input({
        invoices: [invoice("f1", "c-dental", 100_001)],
        contractLines: [line("f1", "k-seo-ads", 100_001)],
        projects: [project("p-ads", "c-dental", "k-seo-ads"), project("p-seo", "c-dental", "k-seo-ads")],
      }),
    );
    // A partes iguales y el céntimo que sobra, al primero por id.
    expect(idle.clients[0]!.projects.map((r) => [r.projectId, r.revenueCents])).toEqual([
      ["p-ads", 50_001],
      ["p-seo", 50_000],
    ]);
    expect(idle.clients[0]!.projects.every((r) => r.flags.includes("revenueWithoutHours"))).toBe(true);
    expectConsistent(idle);
  });

  it("lo que no sale de un contrato con proyecto se reparte por horas entre los proyectos sin contrato", () => {
    const report = buildProfitability(
      input({
        invoices: [invoice("f1", "c-hotel", 200_000), invoice("f2", "c-hotel", 60_000)],
        // f1 sale del contrato del SEO; f2 es una factura suelta (sin contrato).
        contractLines: [line("f1", "k-seo", 200_000)],
        projects: [project("p-seo", "c-hotel", "k-seo"), project("p-banners", "c-hotel"), project("p-fotos", "c-hotel")],
        entries: [hours("p-seo", 20), hours("p-banners", 2), hours("p-fotos", 1)],
      }),
    );
    const client = report.clients[0]!;
    expect(client.allocatedRevenueCents).toBe(60_000);
    expect(client.unassignedRevenueCents).toBe(0);
    const byId = new Map(client.projects.map((p) => [p.projectId, p]));
    // El resto no va al proyecto con contrato, aunque tenga horas.
    expect(byId.get("p-seo")).toMatchObject({ revenueCents: 200_000, contractRevenueCents: 200_000, allocatedRevenueCents: 0 });
    expect(byId.get("p-banners")).toMatchObject({ revenueCents: 40_000, contractRevenueCents: 0, allocatedRevenueCents: 40_000 });
    expect(byId.get("p-fotos")).toMatchObject({ revenueCents: 20_000, allocatedRevenueCents: 20_000 });
    expectConsistent(report);
  });

  it("sin proyectos sin contrato con horas, el resto queda «Sin proyecto» (al final)", () => {
    const report = buildProfitability(
      input({
        invoices: [invoice("f1", "c-hotel", 200_000), invoice("f2", "c-hotel", 50_000)],
        // f2 sale de un contrato de hosting que no tiene proyecto.
        contractLines: [line("f1", "k-seo", 200_000), line("f2", "k-hosting", 50_000)],
        projects: [project("p-seo", "c-hotel", "k-seo"), project("p-idle", "c-hotel")],
        entries: [hours("p-seo", 10)],
      }),
    );
    const client = report.clients[0]!;
    expect(client.unassignedRevenueCents).toBe(50_000);
    expect(client.projects.map((p) => p.projectId)).toEqual(["p-seo", null]);
    expect(client.projects.at(-1)).toMatchObject({ name: null, revenueCents: 50_000, minutes: 0, costCents: 0, flags: ["revenueWithoutHours"] });
    expectConsistent(report);
  });

  it("un cliente solo con facturas sueltas (sin proyectos): todo «Sin proyecto»", () => {
    const report = buildProfitability(input({ invoices: [invoice("f1", "c-celler", 80_000)] }));
    expect(report.clients[0]).toMatchObject({ revenueCents: 80_000, unassignedRevenueCents: 80_000, flags: ["revenueWithoutHours"] });
    expect(report.clients[0]!.projects).toHaveLength(1);
  });

  it("las rectificativas restan en su periodo, también de lo que va por contrato", () => {
    const report = buildProfitability(
      input({
        invoices: [invoice("f1", "c-celler", 300_000), invoice("r1", "c-celler", -100_000)],
        contractLines: [line("f1", "k-tienda", 300_000), line("r1", "k-tienda", -100_000)],
        projects: [project("p-tienda", "c-celler", "k-tienda")],
        entries: [hours("p-tienda", 10)],
      }),
    );
    expect(report.clients[0]).toMatchObject({ revenueCents: 200_000, costCents: 35_000, marginCents: 165_000 });
    expect(report.clients[0]!.projects[0]).toMatchObject({ revenueCents: 200_000, contractRevenueCents: 200_000 });

    // Una factura y su rectificativa en el mismo periodo, sin horas: el cliente no sale.
    const voided = buildProfitability(input({ invoices: [invoice("f1", "c-hotel", 50_000), invoice("r1", "c-hotel", -50_000)] }));
    expect(voided.clients).toEqual([]);
  });

  it("horas sin facturar y facturado sin horas, con sus avisos; los proyectos sin nada no salen", () => {
    const report = buildProfitability(
      input({
        invoices: [invoice("f1", "c-celler", 90_000)],
        contractLines: [line("f1", "k-web", 90_000)],
        projects: [project("p-web", "c-celler", "k-web"), project("p-nuevo", "c-dental"), project("p-quieto", "c-dental")],
        entries: [hours("p-nuevo", 4, PAU)],
      }),
    );
    const celler = report.clients.find((c) => c.clientId === "c-celler")!;
    const dental = report.clients.find((c) => c.clientId === "c-dental")!;
    expect(celler.flags).toEqual(["revenueWithoutHours"]);
    expect(dental).toMatchObject({ revenueCents: 0, costCents: 10_000, marginCents: -10_000, marginBps: null, rateCents: 0, flags: ["hoursWithoutRevenue"] });
    expect(dental.projects.map((p) => p.projectId)).toEqual(["p-nuevo"]);
  });

  it("margen y €/hora por debajo de los umbrales", () => {
    const report = buildProfitability(
      input({
        invoices: [invoice("f1", "c-hotel", 100_000)],
        contractLines: [line("f1", "k1", 100_000)],
        projects: [project("p1", "c-hotel", "k1")],
        // 25 h a 35 €/h = 875 €: margen del 12,5 % y 40 €/h.
        entries: [hours("p1", 25)],
      }),
    );
    expect(report.clients[0]).toMatchObject({ marginBps: 1250, rateCents: 4000, flags: ["lowMargin", "lowRate"] });
    expect(report.totals.flags).toEqual(["lowMargin", "lowRate"]);
  });

  it("los proyectos internos cuentan aparte: horas y coste, fuera de los totales de clientes", () => {
    const report = buildProfitability(
      input({
        invoices: [invoice("f1", "c-hotel", 100_000)],
        contractLines: [line("f1", "k1", 100_000)],
        projects: [project("p1", "c-hotel", "k1"), project("p-web-propia", null, null, "Rediseño de la web"), project("p-parado", null)],
        entries: [hours("p1", 10), hours("p-web-propia", 6, PAU)],
      }),
    );
    expect(report.totals).toMatchObject({ revenueCents: 100_000, costCents: 35_000, minutes: 600 });
    expect(report.internal).toEqual({
      minutes: 360,
      costCents: 15_000,
      projects: [{ projectId: "p-web-propia", name: "Rediseño de la web", status: "active", archived: false, minutes: 360, costCents: 15_000 }],
    });
    expect(report.clients.map((c) => c.clientId)).toEqual(["c-hotel"]);
  });

  it("los clientes, del mejor margen al peor; el orden de las filas de entrada no cambia nada", () => {
    const base: Partial<ProfitabilityInput> = {
      invoices: [invoice("f1", "c-hotel", 100_000), invoice("f2", "c-celler", 400_000), invoice("f3", "c-dental", 10_000)],
      contractLines: [line("f1", "k1", 100_000), line("f2", "k2", 400_000), line("f3", "k3", 10_000)],
      projects: [project("p1", "c-hotel", "k1"), project("p2", "c-celler", "k2"), project("p3", "c-dental", "k3"), project("p4", "c-dental")],
      entries: [hours("p1", 10), hours("p2", 30), hours("p3", 5), hours("p4", 1), hours("p2", 2, PAU)],
    };
    const report = buildProfitability(input(base));
    expect(report.clients.map((c) => c.clientId)).toEqual(["c-celler", "c-hotel", "c-dental"]);
    const shuffled = buildProfitability(
      input({
        invoices: [...base.invoices!].reverse(),
        contractLines: [...base.contractLines!].reverse(),
        projects: [...base.projects!].reverse(),
        entries: [...base.entries!].reverse(),
      }),
    );
    expect(shuffled).toEqual(report);
    expectConsistent(report);
  });

  it("ignora horas de proyectos que no conoce y líneas de facturas que no son del periodo", () => {
    const report = buildProfitability(
      input({
        invoices: [invoice("f1", "c-hotel", 100_000)],
        contractLines: [line("f1", "k1", 100_000), line("f-otra", "k1", 999_999)],
        projects: [project("p1", "c-hotel", "k1")],
        entries: [hours("p1", 1), hours("p-fantasma", 50)],
      }),
    );
    expect(report.clients[0]).toMatchObject({ revenueCents: 100_000, minutes: 60 });
  });

  it("sin nada en el periodo, un informe vacío con los totales a cero", () => {
    const report = buildProfitability(input({}));
    expect(report.clients).toEqual([]);
    expect(report.totals).toEqual(figuresOf(0, 0, 0, SETTINGS));
    expect(report.internal).toEqual({ minutes: 0, costCents: 0, projects: [] });
  });

  it("clientFigures: las cifras de un cliente, o ceros si no tuvo ni ingresos ni horas", () => {
    const report = buildProfitability(
      input({ invoices: [invoice("f1", "c-hotel", 100_000)], projects: [project("p1", "c-hotel")], entries: [hours("p1", 10)] }),
    );
    expect(clientFigures(report, "c-hotel", SETTINGS)).toEqual(figuresOf(100_000, 35_000, 600, SETTINGS));
    expect(clientFigures(report, "c-otro", SETTINGS)).toEqual(figuresOf(0, 0, 0, SETTINGS));
  });
});

describe("marginChartClients", () => {
  const rows = [
    { id: "a", marginCents: 500, revenueCents: 1 },
    { id: "b", marginCents: -900, revenueCents: 1 },
    { id: "c", marginCents: 100, revenueCents: 1 },
    { id: "d", marginCents: 700, revenueCents: 1 },
    { id: "e", marginCents: -50, revenueCents: 1 },
  ];

  it("los de mayor margen en valor absoluto (lo que más aporta y lo que más resta), del mejor al peor", () => {
    expect(marginChartClients(rows, 3)).toEqual({ rows: [rows[3], rows[0], rows[1]], hidden: 2 });
    expect(marginChartClients(rows, 10).rows.map((r) => r.id)).toEqual(["d", "a", "c", "e", "b"]);
    expect(marginChartClients(rows, 0)).toEqual({ rows: [], hidden: 5 });
  });
});
