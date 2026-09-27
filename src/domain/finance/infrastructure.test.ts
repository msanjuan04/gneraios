import { describe, expect, it } from "vitest";
import {
  buildInfrastructure,
  chargeCostCents,
  type InfraBreakdownRow,
  type InfrastructureInput,
  type InfraSubscriptionInput,
  isInfrastructureCost,
  monthlyEquivalentCents,
  topWithOthers,
  yearlyCostCents,
} from "./infrastructure";
import { COMPANY_ASSIGNMENT } from "./allocation";
import { type ExpenseSubscription, subscriptionMonthlyCostCents } from "./subscriptions";

const TODAY = "2026-09-27";

const CATEGORIES: InfrastructureInput["categories"] = [
  { id: "cat-servers", name: "Servidores y hosting", expenseGroup: "operating", isInfrastructure: true },
  { id: "cat-domains", name: "Dominios", expenseGroup: "operating", isInfrastructure: true },
  { id: "cat-software", name: "Software y suscripciones", expenseGroup: "operating", isInfrastructure: false },
  { id: "cat-office", name: "Oficina y coworking", expenseGroup: "operating", isInfrastructure: false },
];

function sub(overrides: Partial<InfraSubscriptionInput> & { id: string }): InfraSubscriptionInput {
  return {
    description: overrides.id,
    vendorId: null,
    categoryId: "cat-servers",
    baseCents: 6000,
    vatBps: 2100,
    vatDeductible: true,
    irpfBps: 0,
    interval: "monthly",
    startsOn: "2026-01-10",
    endsOn: null,
    billingDay: 10,
    isActive: true,
    allocation: "company",
    clientId: null,
    ...overrides,
  };
}

function input(overrides: Partial<InfrastructureInput>): InfrastructureInput {
  return {
    today: TODAY,
    settings: { warningDays: 14, monthlyMinCents: 5000 },
    subscriptions: [],
    categories: CATEGORIES,
    vendors: [
      { id: "v-hetzner", name: "Hetzner" },
      { id: "v-dondominio", name: "DonDominio" },
      { id: "v-supabase", name: "Supabase" },
    ],
    clients: [
      { id: "c-hotel", name: "Hotel Llevant" },
      { id: "c-dental", name: "Clínica Dental Mar Blau" },
    ],
    expenses: [],
    sites: [],
    ...overrides,
  };
}

describe("qué es infraestructura", () => {
  it("una categoría de infraestructura o lo que se reparte entre las webs alojadas", () => {
    expect(isInfrastructureCost("company", { isInfrastructure: true })).toBe(true);
    expect(isInfrastructureCost("hosted_sites", { isInfrastructure: false })).toBe(true);
    expect(isInfrastructureCost("client", { isInfrastructure: false })).toBe(false);
    expect(isInfrastructureCost("company", undefined)).toBe(false);
  });
});

describe("coste de una suscripción", () => {
  it("base + IVA no deducible (la regla de Finanzas); la retención no cambia el coste", () => {
    expect(chargeCostCents({ baseCents: 6000, vatBps: 2100, irpfBps: 0, vatDeductible: true })).toBe(6000);
    expect(chargeCostCents({ baseCents: 6000, vatBps: 2100, irpfBps: 0, vatDeductible: false })).toBe(7260);
    expect(chargeCostCents({ baseCents: 6000, vatBps: 2100, irpfBps: 1500, vatDeductible: true })).toBe(6000);
  });

  it("equivalente mensual (la anual entre 12, redondeada una vez) y coste de un año", () => {
    expect(monthlyEquivalentCents("monthly", 6000)).toBe(6000);
    expect(monthlyEquivalentCents("yearly", 1815)).toBe(151);
    expect(monthlyEquivalentCents("yearly", 18)).toBe(2);
    expect(yearlyCostCents("monthly", 6000)).toBe(72_000);
    expect(yearlyCostCents("yearly", 1815)).toBe(1815);
  });

  it("el equivalente mensual es el mismo que el de la lista de suscripciones (subscriptionMonthlyCostCents)", () => {
    type Case = Pick<ExpenseSubscription, "interval" | "billingDay" | "baseCents" | "vatBps" | "vatDeductible"> & { irpfBps?: number };
    const cases: Case[] = [
      { interval: "monthly", billingDay: 10, baseCents: 6049, vatBps: 2100, vatDeductible: true },
      { interval: "yearly", billingDay: null, baseCents: 1500, vatBps: 2100, vatDeductible: false },
      { interval: "yearly", billingDay: null, baseCents: 24_000, vatBps: 2100, vatDeductible: true },
      { interval: "monthly", billingDay: 1, baseCents: 45_000, vatBps: 2100, irpfBps: 1900, vatDeductible: true },
    ];
    for (const overrides of cases) {
      const full: ExpenseSubscription = {
        ...COMPANY_ASSIGNMENT,
        id: "s",
        issuerId: "sl",
        vendorId: null,
        categoryId: "cat-servers",
        memberId: null,
        description: "s",
        irpfBps: 0,
        startsOn: "2026-01-01",
        endsOn: null,
        paymentMethod: "card",
        isActive: true,
        ...overrides,
      };
      expect(monthlyEquivalentCents(full.interval, chargeCostCents(full))).toBe(subscriptionMonthlyCostCents(full, TODAY));
    }
  });
});

describe("Finanzas → Infraestructura (buildInfrastructure)", () => {
  it("solo lo de infraestructura; totales mensual y anual de lo que está en marcha", () => {
    const report = buildInfrastructure(
      input({
        subscriptions: [
          sub({ id: "s-server", vendorId: "v-hetzner", baseCents: 6000 }),
          sub({ id: "s-domain", vendorId: "v-dondominio", categoryId: "cat-domains", interval: "yearly", billingDay: null, startsOn: "2025-10-05", baseCents: 1500, vatDeductible: false }),
          // Software, pero repartido entre las webs: también entra.
          sub({ id: "s-db", vendorId: "v-supabase", categoryId: "cat-software", baseCents: 2500, allocation: "hosted_sites" }),
          // Ni categoría de infraestructura ni de las webs: fuera.
          sub({ id: "s-office", categoryId: "cat-office", baseCents: 45_000 }),
        ],
      }),
    );
    expect(report.subscriptions.map((r) => r.id).sort()).toEqual(["s-db", "s-domain", "s-server"]);
    // 60 + 25 + 18,15 / 12 (1,51) = 86,51 € al mes; 60 × 12 + 25 × 12 + 18,15 = 1.038,15 € al año.
    expect(report.totals).toEqual({ monthlyCents: 8651, yearlyCents: 103_815, running: 3 });
    const domain = report.subscriptions.find((r) => r.id === "s-domain")!;
    expect(domain).toMatchObject({
      vendorName: "DonDominio",
      categoryName: "Dominios",
      chargeTotalCents: 1815,
      chargeCostCents: 1815,
      monthlyCents: 151,
      yearlyCents: 1815,
      nextRenewalOn: "2026-10-05",
      daysLeft: 8,
      watched: true,
      dueSoon: true,
      firstCharge: false,
    });
    expect(report.dueSoon).toBe(2);
    expect(report.empty).toBe(false);
  });

  it("las renovaciones: del cargo más cercano al más lejano; resalta solo lo que avisa", () => {
    const report = buildInfrastructure(
      input({
        subscriptions: [
          sub({ id: "s-late", baseCents: 9000, startsOn: "2026-01-20", billingDay: 20 }),
          sub({ id: "s-small", baseCents: 1000, startsOn: "2026-01-01", billingDay: 1 }),
          sub({ id: "s-soon", baseCents: 9000, startsOn: "2026-01-30", billingDay: 30 }),
        ],
      }),
    );
    expect(report.subscriptions.map((r) => [r.id, r.nextRenewalOn, r.daysLeft, r.dueSoon])).toEqual([
      ["s-soon", "2026-09-30", 3, true],
      // 12,10 € al mes: por debajo del mínimo de las mensuales, no avisa ni se resalta.
      ["s-small", "2026-10-01", 4, false],
      ["s-late", "2026-10-20", 23, false],
    ]);
  });

  it("apagadas y terminadas: se listan al final, sin renovación y fuera de los totales", () => {
    const report = buildInfrastructure(
      input({
        subscriptions: [
          sub({ id: "s-off", isActive: false }),
          sub({ id: "s-ended", endsOn: "2026-09-01" }),
          sub({ id: "s-on", baseCents: 1000 }),
          // Aún no ha empezado: su primer cargo.
          sub({ id: "s-new", startsOn: "2026-11-01", billingDay: 1, baseCents: 2000 }),
        ],
      }),
    );
    expect(report.subscriptions.map((r) => [r.id, r.isActive, r.running, r.nextRenewalOn, r.monthlyCents])).toEqual([
      ["s-on", true, true, "2026-10-10", 1000],
      ["s-new", true, true, "2026-11-01", 2000],
      ["s-ended", true, false, null, 0],
      ["s-off", false, false, null, 0],
    ]);
    expect(report.subscriptions.find((r) => r.id === "s-new")!.firstCharge).toBe(true);
    expect(report.totals).toEqual({ monthlyCents: 3000, yearlyCents: 36_000, running: 2 });
  });

  it("reparto por proveedor y por categoría, del que más cuesta al que menos (sin proveedor, a igualdad, al final)", () => {
    const report = buildInfrastructure(
      input({
        subscriptions: [
          sub({ id: "s1", vendorId: "v-hetzner", baseCents: 4000 }),
          sub({ id: "s2", vendorId: "v-hetzner", baseCents: 2000, categoryId: "cat-domains" }),
          sub({ id: "s3", vendorId: null, baseCents: 1000, categoryId: "cat-domains" }),
          sub({ id: "s4", vendorId: "v-supabase", baseCents: 1000 }),
          sub({ id: "s-off", vendorId: "v-dondominio", isActive: false }),
        ],
      }),
    );
    expect(report.byVendor).toEqual([
      { id: "v-hetzner", name: "Hetzner", monthlyCents: 6000, count: 2 },
      { id: "v-supabase", name: "Supabase", monthlyCents: 1000, count: 1 },
      { id: null, name: null, monthlyCents: 1000, count: 1 },
    ]);
    expect(report.byCategory).toEqual([
      { id: "cat-servers", name: "Servidores y hosting", monthlyCents: 5000, count: 2 },
      { id: "cat-domains", name: "Dominios", monthlyCents: 3000, count: 2 },
    ]);
  });

  it("coste por web alojada: lo que se reparte entre las webs, a partes iguales, agrupado por cliente", () => {
    const report = buildInfrastructure(
      input({
        subscriptions: [
          sub({ id: "s-server", baseCents: 6000, allocation: "hosted_sites" }),
          sub({ id: "s-backups", baseCents: 3001, allocation: "hosted_sites" }),
          // De la empresa: no se reparte.
          sub({ id: "s-own", baseCents: 9999 }),
        ],
        sites: [
          { id: "w-hotel", name: "hotelllevant.com", clientId: "c-hotel" },
          { id: "w-gnerai", name: "gnerai.com", clientId: null },
          { id: "w-hotel-shop", name: "botiga.hotelllevant.com", clientId: "c-hotel" },
        ],
      }),
    );
    expect(report.hosting.monthlyCents).toBe(9001);
    expect(report.hosting.sites).toBe(3);
    expect(report.hosting.perSiteCents).toBe(3000);
    expect(report.hosting.groups).toEqual([
      {
        clientId: "c-hotel",
        name: "Hotel Llevant",
        monthlyCents: 6000,
        sites: [
          { id: "w-hotel-shop", name: "botiga.hotelllevant.com", monthlyCents: 3000 },
          { id: "w-hotel", name: "hotelllevant.com", monthlyCents: 3000 },
        ],
      },
      // Las webs sin cliente, al final. El céntimo de más va a la primera por id (w-gnerai).
      { clientId: null, name: null, monthlyCents: 3001, sites: [{ id: "w-gnerai", name: "gnerai.com", monthlyCents: 3001 }] },
    ]);
  });

  it("sin webs alojadas no hay coste por web; lo de un cliente concreto lleva su nombre", () => {
    const report = buildInfrastructure(
      input({ subscriptions: [sub({ id: "s-vps", allocation: "client", clientId: "c-dental" }), sub({ id: "s-shared", allocation: "hosted_sites" })] }),
    );
    expect(report.hosting).toEqual({ monthlyCents: 6000, sites: 0, perSiteCents: null, groups: [] });
    expect(report.subscriptions.find((r) => r.id === "s-vps")!.clientName).toBe("Clínica Dental Mar Blau");
    expect(report.subscriptions.find((r) => r.id === "s-shared")!.clientName).toBeNull();
  });

  it("gastado en 12 meses: los gastos de infraestructura registrados (también los sueltos)", () => {
    const report = buildInfrastructure(
      input({
        expenses: [
          { categoryId: "cat-servers", allocation: "company", costCents: 6000 },
          { categoryId: "cat-software", allocation: "hosted_sites", costCents: 2500 },
          { categoryId: "cat-office", allocation: "company", costCents: 45_000 },
          { categoryId: "cat-domains", allocation: "client", costCents: -500 },
        ],
      }),
    );
    expect(report.spent12m).toEqual({ cents: 8000, count: 3 });
    expect(report.subscriptions).toEqual([]);
    expect(report.empty).toBe(false);
    expect(buildInfrastructure(input({ expenses: [{ categoryId: "cat-office", allocation: "company", costCents: 100 }] })).empty).toBe(true);
  });
});

describe("topWithOthers", () => {
  const rows: InfraBreakdownRow[] = [5, 4, 3, 2, 1].map((n) => ({ id: `v${n}`, name: `V${n}`, monthlyCents: n * 100, count: 1 }));

  it("los de más coste y el resto sumado en «Otros»; si solo sobra uno, se enseña tal cual", () => {
    expect(topWithOthers(rows, 3)).toEqual({ rows: rows.slice(0, 3), others: { id: null, name: null, monthlyCents: 300, count: 2 } });
    expect(topWithOthers(rows, 4)).toEqual({ rows, others: null });
    expect(topWithOthers(rows, 10)).toEqual({ rows, others: null });
  });
});
