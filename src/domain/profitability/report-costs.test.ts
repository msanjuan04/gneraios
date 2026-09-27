import { describe, expect, it } from "vitest";
import type { MemberCost } from "./costs";
import type { ClientExpenseRef, HostedSiteRef } from "./other-costs";
import {
  buildProfitability,
  clientCostSplit,
  clientFigures,
  type ProfitabilityInput,
  type ProfitabilityReport,
  PROFITABILITY_DEFINITION_VERSION,
  type ProjectRef,
  type TimeEntryRef,
} from "./report";
import type { ProfitabilitySettings } from "./settings";

// Rentabilidad v2: el coste de un cliente suma sus horas, sus gastos y su parte de la
// infraestructura de las webs alojadas.

const SETTINGS: ProfitabilitySettings = { defaultHourlyCostCents: 3000, minMarginBps: 3000, minHourlyRateCents: 4500 };
const LAIA = "m-laia";
const COSTS: MemberCost[] = [{ memberId: LAIA, validFrom: "2026-01-01", hourlyCostCents: 3500 }];

const project = (id: string, clientId: string | null, contractId: string | null = null): ProjectRef => ({
  id,
  clientId,
  contractId,
  name: id,
  status: "active",
  archived: false,
});
const hours = (projectId: string, h: number): TimeEntryRef => ({ memberId: LAIA, projectId, workedOn: "2026-09-10", minutes: h * 60 });
const expense = (clientId: string, costCents: number, rebill = false, rebilled = false): ClientExpenseRef => ({ clientId, costCents, rebill, rebilled });
const site = (id: string, clientId: string | null): HostedSiteRef => ({ id, clientId });

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

/** Cada cliente: sus horas son la suma de sus proyectos, y el coste, horas + gastos + infraestructura. */
function expectConsistent(report: ProfitabilityReport) {
  for (const client of report.clients) {
    expect(client.projects.reduce((s, p) => s + p.costCents, 0)).toBe(client.hoursCostCents);
    expect(client.costCents).toBe(client.hoursCostCents + client.otherCosts.expensesCents + client.otherCosts.hostingCents);
    expect(client.marginCents).toBe(client.revenueCents - client.costCents);
  }
  expect(report.totals.costCents).toBe(report.costs.hoursCents + report.costs.other.expensesCents + report.costs.other.hostingCents);
  expect(report.costs.hoursCents).toBe(report.clients.reduce((s, c) => s + c.hoursCostCents, 0));
  // Toda la infraestructura acaba en algún sitio: en los clientes o sin cliente.
  expect(report.costs.other.hostingCents + report.hosting.unassignedCents).toBe(report.hosting.totalCents);
}

describe("rentabilidad con gastos e infraestructura", () => {
  it("la definición sube de versión", () => {
    expect(PROFITABILITY_DEFINITION_VERSION).toBe(2);
  });

  it("los gastos del cliente suman a su coste y bajan su margen; los proyectos solo llevan sus horas", () => {
    const report = buildProfitability(
      input({
        invoices: [{ invoiceId: "f1", clientId: "c-hotel", baseCents: 300_000 }],
        contractLines: [{ invoiceId: "f1", contractId: "k1", baseCents: 300_000 }],
        projects: [project("p1", "c-hotel", "k1")],
        // 20 h a 35 €/h = 700 €.
        entries: [hours("p1", 20)],
        // Un plugin de pago para su web (base + IVA no deducible, ya calculado): 120 €.
        clientExpenses: [expense("c-hotel", 12_000)],
      }),
    );
    const [client] = report.clients;
    expect(client).toMatchObject({
      revenueCents: 300_000,
      hoursCostCents: 70_000,
      costCents: 82_000,
      marginCents: 218_000,
      marginBps: 7267,
      otherCosts: { expensesCents: 12_000, hostingCents: 0, hostedSites: 0 },
    });
    expect(client!.projects[0]).toMatchObject({ projectId: "p1", costCents: 70_000, marginCents: 230_000 });
    expect(report.totals).toMatchObject({ costCents: 82_000, marginCents: 218_000 });
    expect(report.costs).toEqual({
      hoursCents: 70_000,
      other: { expensesCents: 12_000, rebillCents: 0, rebillPendingCents: 0, hostingCents: 0, hostedSites: 0 },
    });
    expectConsistent(report);
  });

  it("repercutido: el gasto es coste y su factura, ingreso; el margen se queda con el recargo", () => {
    // Un dominio de 20 € repercutido con un 25 % de recargo: la línea de factura, de 25 €, va con lo facturado.
    const rebilled = buildProfitability(
      input({
        invoices: [{ invoiceId: "f-dominio", clientId: "c-celler", baseCents: 2500 }],
        clientExpenses: [expense("c-celler", 2000, true, true)],
      }),
    );
    expect(rebilled.clients[0]).toMatchObject({
      revenueCents: 2500,
      costCents: 2000,
      marginCents: 500,
      otherCosts: { expensesCents: 2000, rebillCents: 2000, rebillPendingCents: 0 },
    });
    // Sin facturar todavía: pesa como coste y lo dice.
    const pending = buildProfitability(input({ clientExpenses: [expense("c-celler", 2000, true, false)] }));
    expect(pending.clients[0]).toMatchObject({
      revenueCents: 0,
      costCents: 2000,
      marginCents: -2000,
      marginBps: null,
      flags: [],
      otherCosts: { rebillCents: 2000, rebillPendingCents: 2000 },
    });
    expect(pending.costs.other.rebillPendingCents).toBe(2000);
  });

  it("la infraestructura compartida se reparte a partes iguales entre las webs alojadas y va a sus clientes", () => {
    const report = buildProfitability(
      input({
        invoices: [
          { invoiceId: "f1", clientId: "c-hotel", baseCents: 100_000 },
          { invoiceId: "f2", clientId: "c-dental", baseCents: 50_000 },
        ],
        // Servidor (60 €) y copias (30 €) del periodo, entre 3 webs: 30 € por web.
        hostedCosts: [{ costCents: 6000 }, { costCents: 3000 }],
        hostedSites: [site("w-hotel", "c-hotel"), site("w-hotel-shop", "c-hotel"), site("w-dental", "c-dental")],
      }),
    );
    const byId = new Map(report.clients.map((c) => [c.clientId, c]));
    expect(byId.get("c-hotel")).toMatchObject({ costCents: 6000, otherCosts: { hostingCents: 6000, hostedSites: 2 }, marginCents: 94_000 });
    expect(byId.get("c-dental")).toMatchObject({ costCents: 3000, otherCosts: { hostingCents: 3000, hostedSites: 1 } });
    expect(report.hosting).toEqual({ totalCents: 9000, sites: 3, unassignedCents: 0, unassignedSites: 0, beforeStartCents: 0 });
    expectConsistent(report);
  });

  it("lo de las webs sin cliente, o todo si no hay ninguna web alojada, queda fuera de los clientes", () => {
    const withOwnSite = buildProfitability(
      input({
        invoices: [{ invoiceId: "f1", clientId: "c-hotel", baseCents: 100_000 }],
        hostedCosts: [{ costCents: 5001 }],
        hostedSites: [site("w-gnerai", null), site("w-hotel", "c-hotel")],
      }),
    );
    // 50,01 € entre 2 webs: el céntimo de más, a la primera por id (w-gnerai).
    expect(withOwnSite.hosting).toEqual({ totalCents: 5001, sites: 2, unassignedCents: 2501, unassignedSites: 1, beforeStartCents: 0 });
    expect(withOwnSite.clients[0]).toMatchObject({ costCents: 2500, otherCosts: { hostingCents: 2500 } });
    expect(withOwnSite.totals.costCents).toBe(2500);
    expectConsistent(withOwnSite);

    const noSites = buildProfitability(input({ invoices: [{ invoiceId: "f1", clientId: "c-hotel", baseCents: 100_000 }], hostedCosts: [{ costCents: 5000 }] }));
    expect(noSites.hosting).toEqual({ totalCents: 5000, sites: 0, unassignedCents: 5000, unassignedSites: 0, beforeStartCents: 0 });
    expect(noSites.clients[0]).toMatchObject({ costCents: 0 });
    expectConsistent(noSites);
  });

  it("un cliente solo con costes (sin facturas ni horas en el periodo) sale, en pérdidas", () => {
    const report = buildProfitability(
      input({
        invoices: [{ invoiceId: "f1", clientId: "c-hotel", baseCents: 100_000 }],
        hostedCosts: [{ costCents: 4000 }],
        hostedSites: [site("w-hotel", "c-hotel"), site("w-celler", "c-celler")],
      }),
    );
    expect(report.clients.map((c) => c.clientId)).toEqual(["c-hotel", "c-celler"]);
    expect(report.clients[1]).toMatchObject({
      name: "Celler Turó d'Alella",
      revenueCents: 0,
      minutes: 0,
      costCents: 2000,
      marginCents: -2000,
      projects: [],
      flags: [],
    });
    // Unos gastos que se anulan (gasto y abono) y ninguna otra cosa: no hay nada que enseñar.
    const voided = buildProfitability(input({ clientExpenses: [expense("c-dental", 5000), expense("c-dental", -5000)] }));
    expect(voided.clients).toEqual([]);
  });

  it("el margen bajo tiene en cuenta todos los costes", () => {
    const report = buildProfitability(
      input({
        invoices: [{ invoiceId: "f1", clientId: "c-hotel", baseCents: 100_000 }],
        contractLines: [{ invoiceId: "f1", contractId: "k1", baseCents: 100_000 }],
        projects: [project("p1", "c-hotel", "k1")],
        // 10 h a 35 €/h = 350 €: sin gastos, un 65 % de margen.
        entries: [hours("p1", 10)],
        // Con 400 € de gastos, un 25 %: por debajo del mínimo (30 %).
        clientExpenses: [expense("c-hotel", 40_000)],
      }),
    );
    expect(report.clients[0]).toMatchObject({ marginBps: 2500, flags: ["lowMargin"] });
  });

  it("el orden de las filas de entrada no cambia nada", () => {
    const base: Partial<ProfitabilityInput> = {
      invoices: [
        { invoiceId: "f1", clientId: "c-hotel", baseCents: 100_000 },
        { invoiceId: "f2", clientId: "c-dental", baseCents: 80_000 },
      ],
      projects: [project("p1", "c-hotel"), project("p2", "c-dental")],
      entries: [hours("p1", 5), hours("p2", 3)],
      clientExpenses: [expense("c-hotel", 1000), expense("c-dental", 2000, true), expense("c-hotel", 300, true, true)],
      hostedCosts: [{ costCents: 1001 }, { costCents: 2000 }],
      hostedSites: [site("w-3", "c-dental"), site("w-1", "c-hotel"), site("w-2", null)],
    };
    const report = buildProfitability(input(base));
    const shuffled = buildProfitability(
      input({
        ...base,
        invoices: [...base.invoices!].reverse(),
        projects: [...base.projects!].reverse(),
        entries: [...base.entries!].reverse(),
        clientExpenses: [...base.clientExpenses!].reverse(),
        hostedCosts: [...base.hostedCosts!].reverse(),
        hostedSites: [...base.hostedSites!].reverse(),
      }),
    );
    expect(shuffled).toEqual(report);
    expectConsistent(report);
  });

  it("un cliente no carga con la infraestructura de antes de ser cliente (su primera factura o su primer gasto)", () => {
    const report = buildProfitability(
      input({
        invoices: [
          { invoiceId: "f1", clientId: "c-hotel", baseCents: 100_000 },
          { invoiceId: "f2", clientId: "c-celler", baseCents: 50_000 },
        ],
        // Dos cargos del servidor (60 € cada uno), en julio y en septiembre, entre 2 webs.
        hostedCosts: [
          { costCents: 6000, issuedOn: "2026-07-01" },
          { costCents: 6000, issuedOn: "2026-09-01" },
        ],
        hostedSites: [site("w-hotel", "c-hotel"), site("w-celler", "c-celler")],
        // El hotel es cliente desde 2024; el celler, desde agosto de 2026.
        hostingStarts: new Map([
          ["c-hotel", "2024-03-01"],
          ["c-celler", "2026-08-15"],
        ]),
      }),
    );
    const byId = new Map(report.clients.map((c) => [c.clientId, c]));
    expect(byId.get("c-hotel")!.otherCosts.hostingCents).toBe(6000);
    // Del cargo de julio no es cliente todavía: esa parte queda sin cliente.
    expect(byId.get("c-celler")!.otherCosts).toMatchObject({ hostingCents: 3000, hostedSites: 1 });
    expect(report.hosting).toEqual({ totalCents: 12_000, sites: 2, unassignedCents: 3000, unassignedSites: 0, beforeStartCents: 3000 });
    expectConsistent(report);

    // Un cliente sin ninguna factura ni gasto no carga con nada.
    const unknown = buildProfitability(
      input({
        hostedCosts: [{ costCents: 6000, issuedOn: "2026-07-01" }],
        hostedSites: [site("w-dental", "c-dental")],
        hostingStarts: new Map(),
      }),
    );
    expect(unknown.clients).toEqual([]);
    expect(unknown.hosting).toMatchObject({ unassignedCents: 6000, beforeStartCents: 6000 });
  });

  it("cobrado (cobros del periodo, con IVA) y pendiente (de lo facturado en el periodo); el margen no cambia", () => {
    const report = buildProfitability(
      input({
        invoices: [
          { invoiceId: "f1", clientId: "c-hotel", baseCents: 100_000, pendingCents: 121_000 },
          { invoiceId: "f2", clientId: "c-hotel", baseCents: 50_000, pendingCents: 0 },
        ],
        // Cobrado en el periodo: f2 entera (60.500 con IVA) y una factura de antes del periodo.
        payments: [
          { clientId: "c-hotel", amountCents: 60_500 },
          { clientId: "c-hotel", amountCents: 24_200 },
          // Un cliente sin nada más en el periodo que un cobro de una factura antigua: también sale.
          { clientId: "c-dental", amountCents: 36_300 },
        ],
      }),
    );
    const byId = new Map(report.clients.map((c) => [c.clientId, c]));
    expect(byId.get("c-hotel")).toMatchObject({ revenueCents: 150_000, marginCents: 150_000, collectedCents: 84_700, pendingCents: 121_000 });
    expect(byId.get("c-dental")).toMatchObject({ revenueCents: 0, costCents: 0, marginCents: 0, collectedCents: 36_300, pendingCents: 0, flags: [] });
    expect(report.collection).toEqual({ collectedCents: 121_000, pendingCents: 121_000, receiptsCents: 0 });
    // El margen de los totales es el de la base: los cobros no cuentan.
    expect(report.totals).toMatchObject({ revenueCents: 150_000, marginCents: 150_000 });
    // Un cobro y su devolución en el periodo, sin nada más: no hay nada que enseñar.
    const refunded = buildProfitability(input({ payments: [{ clientId: "c-celler", amountCents: 1000 }, { clientId: "c-celler", amountCents: -1000 }] }));
    expect(refunded.clients).toEqual([]);
  });

  it("cobros sin factura: ingreso tal cual y cobrado; con proyecto van a él y, sin él, al resto del cliente", () => {
    const report = buildProfitability(
      input({
        projects: [project("p-web", "c-celler"), project("p-seo", "c-celler"), project("p-interno", null)],
        entries: [hours("p-web", 10), hours("p-seo", 30)],
        receipts: [
          // Apuntado a la web: todo suyo.
          { clientId: "c-celler", projectId: "p-web", amountCents: 150_000 },
          // Sin proyecto: se reparte por horas entre los proyectos sin contrato.
          { clientId: "c-celler", projectId: null, amountCents: 80_000 },
          // Un proyecto que no es suyo (interno): cuenta como sin proyecto.
          { clientId: "c-celler", projectId: "p-interno", amountCents: 20_000 },
          // Una devolución.
          { clientId: "c-celler", projectId: null, amountCents: -10_000 },
        ],
      }),
    );
    const client = report.clients[0]!;
    expect(client).toMatchObject({ revenueCents: 240_000, collectedCents: 240_000, receiptsCents: 240_000, pendingCents: 0, allocatedRevenueCents: 90_000 });
    const byId = new Map(client.projects.map((p) => [p.projectId, p]));
    // El resto (90.000) por horas: 10 h y 30 h.
    expect(byId.get("p-web")).toMatchObject({ revenueCents: 172_500, directRevenueCents: 150_000, allocatedRevenueCents: 22_500 });
    expect(byId.get("p-seo")).toMatchObject({ revenueCents: 67_500, directRevenueCents: 0, allocatedRevenueCents: 67_500 });
    expect(report.collection).toEqual({ collectedCents: 240_000, pendingCents: 0, receiptsCents: 240_000 });
    expectConsistent(report);
  });

  it("un cliente con solo cobros sin factura y horas sale con su margen; con facturas, se suman", () => {
    const onlyReceipts = buildProfitability(
      input({
        projects: [project("p1", "c-dental")],
        entries: [hours("p1", 10)],
        receipts: [{ clientId: "c-dental", projectId: null, amountCents: 100_000 }],
      }),
    );
    expect(onlyReceipts.clients[0]).toMatchObject({ clientId: "c-dental", revenueCents: 100_000, costCents: 35_000, marginCents: 65_000, flags: [] });

    const mixed = buildProfitability(
      input({
        invoices: [{ invoiceId: "f1", clientId: "c-dental", baseCents: 50_000, pendingCents: 60_500 }],
        payments: [{ clientId: "c-dental", amountCents: 12_100 }],
        receipts: [{ clientId: "c-dental", projectId: null, amountCents: 30_000 }],
      }),
    );
    expect(mixed.clients[0]).toMatchObject({ revenueCents: 80_000, collectedCents: 42_100, receiptsCents: 30_000, pendingCents: 60_500 });
  });

  it("clientCostSplit y clientFigures: el coste por partes y las cifras de un cliente, o ceros", () => {
    const report = buildProfitability(
      input({
        invoices: [{ invoiceId: "f1", clientId: "c-hotel", baseCents: 100_000 }],
        projects: [project("p1", "c-hotel")],
        entries: [hours("p1", 2)],
        clientExpenses: [expense("c-hotel", 500)],
        hostedCosts: [{ costCents: 1000 }],
        hostedSites: [site("w-hotel", "c-hotel")],
      }),
    );
    expect(clientCostSplit(report, "c-hotel")).toEqual({
      hoursCostCents: 7000,
      otherCosts: { expensesCents: 500, rebillCents: 0, rebillPendingCents: 0, hostingCents: 1000, hostedSites: 1 },
      collectedCents: 0,
      receiptsCents: 0,
      pendingCents: 0,
    });
    expect(clientFigures(report, "c-hotel", SETTINGS)).toMatchObject({ costCents: 8500, marginCents: 91_500 });
    expect(clientCostSplit(report, "c-otro")).toEqual({
      hoursCostCents: 0,
      otherCosts: { expensesCents: 0, rebillCents: 0, rebillPendingCents: 0, hostingCents: 0, hostedSites: 0 },
      collectedCents: 0,
      receiptsCents: 0,
      pendingCents: 0,
    });
  });
});
