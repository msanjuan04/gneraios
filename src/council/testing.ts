// Escenario de referencia para los tests de las tools, del runner y de los agentes: una agencia
// pequeña con altas, una baja, impagados, una renovación cerca, un deal parado y candidatos a
// venta cruzada. Hoy es el 26/09/2026. Solo lo usan los tests (y los evals como base).

import { buildToolContext, cachedData } from "./context";
import { FixtureCouncilData, type CouncilFixture, type FixtureFinance } from "./data/fixture";
import { buildFixture, type Scenario, type ScenarioProject } from "./data/scenario";
import { EXAMPLE_POLICY, resolvePolicy, type FinancialPolicy } from "./policy/schema";
import type { RunnerDeps } from "./runner";
import { FakeRuntime, type FakeScript } from "./runtime/fake";
import { MemoryCouncilStore } from "./store/memory";
import type { AgentSettingsRecord, JobRecord, NewJob } from "./store/types";
import type { ToolContext, UpsellRule } from "./tools/types";

export const ORG_ID = "org-fixture";
export const TODAY = "2026-09-26";

/** Las reglas de venta cruzada que la migración siembra en cada org. */
export const DEFAULT_UPSELL_RULES: UpsellRule[] = [
  { id: "rule-web-maintenance", label: "Web sin mantenimiento", requiresAny: ["web", "tienda", "shopify"], excludesAny: ["mantenimiento"], maxServices: null, minMonths: null, suggestion: "Ofrecer el mantenimiento mensual de la web", referenceMrrCents: null },
  { id: "rule-web-seo", label: "Web sin SEO", requiresAny: ["web", "tienda", "shopify"], excludesAny: ["seo"], maxServices: null, minMonths: null, suggestion: "Proponer SEO local para que la web traiga clientes", referenceMrrCents: 45_000 },
  { id: "rule-ads-landing", label: "Ads sin landing", requiresAny: ["ads"], excludesAny: ["landing", "web"], maxServices: null, minMonths: null, suggestion: "Proponer una landing propia para las campañas", referenceMrrCents: null },
  { id: "rule-seo-report", label: "SEO sin informe mensual", requiresAny: ["seo"], excludesAny: ["informe"], maxServices: null, minMonths: null, suggestion: "Añadir un informe mensual de resultados del SEO", referenceMrrCents: null },
  { id: "rule-single", label: "Un solo servicio desde hace más de 6 meses", requiresAny: [], excludesAny: [], maxServices: 1, minMonths: 6, suggestion: "Explorar un segundo servicio (venta cruzada)", referenceMrrCents: null },
];

export function agencyScenario(): Scenario {
  return {
    today: TODAY,
    members: [
      { id: "m1", fullName: "Marc Sanjuan", initials: "MS", role: "owner" },
      { id: "m2", fullName: "Marc Costa", initials: "MC", role: "owner" },
      { id: "m3", fullName: "Helena Lluch", initials: "HL", role: "partner" },
    ],
    sources: [
      { id: "src-web", name: "Web" },
      { id: "src-seo", name: "SEO" },
      { id: "src-ref", name: "Referido" },
    ],
    clients: [
      {
        id: "c1",
        name: "Restaurant Can Sorra",
        sourceId: "src-web",
        ownerMemberId: "m1",
        createdAt: "2025-02-01T09:00:00Z",
        lastActivityAt: "2026-09-10T10:00:00Z",
        lines: [
          { id: "l1", contractId: "k1", contractTitle: "Web + mantenimiento", signedOn: "2025-02-20", description: "Diseño y desarrollo de la web", billingType: "one_off", unitPriceCents: 240_000, startsOn: "2025-02-20" },
          { id: "l2", contractId: "k1", contractTitle: "Web + mantenimiento", signedOn: "2025-02-20", description: "Mantenimiento web", billingType: "monthly", unitPriceCents: 9_000, startsOn: "2025-05-01" },
        ],
      },
      {
        id: "c2",
        name: "Clínica Dental Mar Blau",
        sourceId: "src-seo",
        ownerMemberId: "m2",
        createdAt: "2025-04-01T09:00:00Z",
        lastActivityAt: "2026-06-01T10:00:00Z",
        lines: [
          { id: "l3", contractId: "k2", contractTitle: "SEO local y campañas", signedOn: "2025-04-10", description: "SEO local", billingType: "monthly", unitPriceCents: 45_000, startsOn: "2025-04-15", prorateFirst: true },
          { id: "l4", contractId: "k2", contractTitle: "SEO local y campañas", signedOn: "2025-04-10", description: "Gestión de Google Ads", billingType: "monthly", unitPriceCents: 30_000, startsOn: "2025-06-01" },
        ],
        unpaid: ["l3@2026-07", "l3@2026-08", "l4@2026-08"],
      },
      {
        id: "c3",
        name: "Immobiliària Costa Nord",
        sourceId: "src-ref",
        ownerMemberId: "m3",
        createdAt: "2025-09-01T09:00:00Z",
        lastActivityAt: "2026-09-20T10:00:00Z",
        lines: [
          { id: "l5", contractId: "k3", contractTitle: "Redes sociales y hosting", signedOn: "2025-09-05", description: "Hosting y dominio", billingType: "yearly", unitPriceCents: 24_000, startsOn: "2025-10-15" },
          { id: "l6", contractId: "k3", contractTitle: "Redes sociales y hosting", signedOn: "2025-09-05", description: "Gestión de redes sociales", billingType: "monthly", unitPriceCents: 60_000, startsOn: "2025-10-01" },
        ],
      },
      {
        id: "c4",
        name: "Maresme Fit Gym",
        sourceId: "src-web",
        ownerMemberId: "m2",
        createdAt: "2025-06-01T09:00:00Z",
        lastActivityAt: "2026-06-15T10:00:00Z",
        lines: [
          { id: "l7", contractId: "k4", contractTitle: "Captación con Meta Ads", signedOn: "2025-06-15", description: "Gestión de Meta Ads", billingType: "monthly", unitPriceCents: 25_000, startsOn: "2025-07-01", endsOn: "2026-06-30" },
        ],
      },
      {
        id: "c5",
        name: "Hotel Llevant Calella",
        sourceId: "src-seo",
        ownerMemberId: "m1",
        createdAt: "2025-07-01T09:00:00Z",
        lastActivityAt: "2026-09-01T10:00:00Z",
        lines: [
          { id: "l8", contractId: "k5", contractTitle: "SEO y analítica", signedOn: "2025-07-20", description: "SEO para hoteles", billingType: "monthly", unitPriceCents: 70_000, startsOn: "2025-08-01" },
          { id: "l9", contractId: "k5", contractTitle: "SEO y analítica", signedOn: "2025-07-20", description: "Licencia de analítica", billingType: "yearly", unitPriceCents: 120_000, startsOn: "2025-08-01" },
        ],
      },
      { id: "c6", name: "Tallers Rius", sourceId: "src-web", ownerMemberId: "m3", createdAt: "2026-06-20T09:00:00Z", lastActivityAt: "2026-08-10T10:00:00Z" },
    ],
    deals: [
      {
        id: "d1",
        title: "Tienda online",
        clientId: "c6",
        stageId: "stage-proposal",
        estOneOffCents: 650_000,
        sourceId: "src-web",
        ownerMemberId: "m3",
        nextAction: "Llamar para cerrar la propuesta",
        nextActionOn: "2026-09-01",
        createdAt: "2026-07-01T09:00:00Z",
        stageEnteredAt: "2026-08-10T09:00:00Z",
      },
      {
        id: "d2",
        title: "SEO local 6 meses",
        clientId: "c1",
        stageId: "stage-negotiation",
        estMrrCents: 30_000,
        sourceId: "src-ref",
        ownerMemberId: "m1",
        createdAt: "2026-09-01T09:00:00Z",
        stageEnteredAt: "2026-09-20T09:00:00Z",
      },
      {
        id: "d3",
        title: "Web corporativa",
        clientId: "c4",
        stageId: "stage-lost",
        estOneOffCents: 180_000,
        sourceId: "src-web",
        lossReasonId: "reason-price",
        createdAt: "2026-04-01T09:00:00Z",
        stageEnteredAt: "2026-05-10T09:00:00Z",
      },
    ],
    history: [
      { dealId: "d1", fromStageId: null, toStageId: "stage-lead", changedAt: "2026-07-01T09:00:00Z" },
      { dealId: "d1", fromStageId: "stage-lead", toStageId: "stage-proposal", changedAt: "2026-08-10T09:00:00Z" },
      { dealId: "d2", fromStageId: null, toStageId: "stage-meeting", changedAt: "2026-09-01T09:00:00Z" },
      { dealId: "d2", fromStageId: "stage-meeting", toStageId: "stage-negotiation", changedAt: "2026-09-20T09:00:00Z" },
      { dealId: "d3", fromStageId: null, toStageId: "stage-lead", changedAt: "2026-04-01T09:00:00Z" },
      { dealId: "d3", fromStageId: "stage-lead", toStageId: "stage-lost", changedAt: "2026-05-10T09:00:00Z" },
    ],
    activities: [{ clientId: "c1", dealId: "d2", occurredAt: "2026-09-20T10:00:00Z" }],
  };
}

/** Finanzas de ejemplo: saldo de caja, 3 meses de gastos (fijos y variables) y participaciones iguales. */
export function financeFixture(overrides: Partial<FixtureFinance> = {}): FixtureFinance {
  return {
    accounts: [{ id: "acc-1", name: "Cuenta principal", issuerId: "issuer-sl", balanceOn: "2026-09-25", balanceCents: 2_500_000 }],
    expenses: [
      { month: "2026-06-01", isFixed: true, costCents: 100_000, inputVatCents: 0 },
      { month: "2026-06-01", isFixed: false, costCents: 20_000 },
      { month: "2026-07-01", isFixed: true, costCents: 100_000, inputVatCents: 20_000 },
      { month: "2026-07-01", isFixed: false, costCents: 30_000 },
      { month: "2026-08-01", isFixed: true, costCents: 100_000, inputVatCents: 22_000 },
      { month: "2026-08-01", isFixed: false, costCents: 40_000 },
    ],
    shareholdings: [
      { memberId: "m1", percentBps: 3334 },
      { memberId: "m2", percentBps: 3333 },
      { memberId: "m3", percentBps: 3333 },
    ],
    ...overrides,
  };
}

/**
 * Proyectos de la agencia con horas desde el 1 de junio (cada día laborable) y tareas abiertas: el
 * SEO de Mar Blau rinde por encima del objetivo, el del hotel también, las redes de Costa Nord muy
 * por debajo, Can Sorra y el gimnasio facturan sin horas y hay un proyecto interno. Los tests y los
 * evals que quieren horas lo añaden a agencyScenario() (en los evals, `"projects": "default"`).
 */
export function projectsFixture(): ScenarioProject[] {
  const from = "2026-06-01";
  const to = "2026-09-25";
  return [
    {
      id: "p1",
      name: "SEO local Mar Blau",
      clientId: "c2",
      contractId: "k2",
      ownerMemberId: "m2",
      hours: [{ memberId: "m2", from, to, minutesPerDay: 30 }],
      tasks: [{ id: "t6", assigneeMemberId: "m2", dueOn: "2026-09-24", estimateMinutes: 180, status: "done" }],
    },
    {
      id: "p2",
      name: "Redes sociales Costa Nord",
      clientId: "c3",
      contractId: "k3",
      ownerMemberId: "m3",
      hours: [{ memberId: "m3", from, to, minutesPerDay: 45 }],
      tasks: [
        { id: "t1", assigneeMemberId: "m3", dueOn: "2026-09-30", estimateMinutes: 240 },
        { id: "t2", assigneeMemberId: "m3", dueOn: "2026-10-05", estimateMinutes: 120, status: "doing" },
        { id: "t3", assigneeMemberId: "m3", dueOn: "2026-09-18", estimateMinutes: 180 },
        { id: "t4", assigneeMemberId: "m3", dueOn: "2026-10-02", estimateMinutes: null },
      ],
    },
    {
      id: "p3",
      name: "SEO Hotel Llevant",
      clientId: "c5",
      contractId: "k5",
      ownerMemberId: "m1",
      hours: [{ memberId: "m1", from, to, minutesPerDay: 40 }],
      tasks: [{ id: "t5", assigneeMemberId: "m1", dueOn: "2026-10-09", estimateMinutes: 360 }],
    },
    {
      id: "p4",
      name: "Web de GNERAI",
      clientId: null,
      ownerMemberId: "m1",
      hours: [{ memberId: "m1", from, to, minutesPerDay: 60 }],
      tasks: [
        { id: "t7", assigneeMemberId: null, dueOn: "2026-10-20", estimateMinutes: 480 },
        { id: "t8", assigneeMemberId: "m1", dueOn: null, estimateMinutes: 120 },
      ],
    },
  ];
}

export function fixtureData(scenario: Scenario = agencyScenario()): { fixture: CouncilFixture; data: FixtureCouncilData } {
  const fixture = buildFixture(scenario);
  return { fixture, data: new FixtureCouncilData(fixture) };
}

/** Un almacén en memoria con la org de prueba, las reglas de venta cruzada y, si se pasa, una política guardada. */
export function memoryStore(opts: { policy?: FinancialPolicy; settings?: AgentSettingsRecord[]; now?: () => Date } = {}): MemoryCouncilStore {
  const store = new MemoryCouncilStore({ orgs: [{ id: ORG_ID, timezone: "Europe/Madrid" }], now: opts.now ?? (() => new Date(`${TODAY}T08:00:00Z`)) });
  store.rules.set(ORG_ID, DEFAULT_UPSELL_RULES);
  if (opts.policy) store.policies.set(ORG_ID, { version: 1, data: opts.policy, createdAt: "2026-09-01T10:00:00Z", note: null });
  if (opts.settings) store.settings.set(ORG_ID, opts.settings);
  return store;
}

export async function toolContext(opts: { scenario?: Scenario; store?: MemoryCouncilStore; policy?: FinancialPolicy } = {}): Promise<ToolContext> {
  const { data } = fixtureData(opts.scenario);
  const store = opts.store ?? memoryStore();
  return buildToolContext({
    orgId: ORG_ID,
    today: opts.scenario?.today ?? TODAY,
    data: cachedData(data),
    store,
    policy: opts.policy ? resolvePolicy({ version: 1, data: opts.policy, createdAt: "2026-09-01T10:00:00Z", note: null }) : resolvePolicy(null),
    settings: [],
  });
}

/** Dependencias del runner para los tests: fixture, almacén en memoria y FakeRuntime con guiones. */
export function runnerDeps(opts: { scenario?: Scenario; store?: MemoryCouncilStore; scripts: Record<string, FakeScript>; now?: Date; apiKey?: boolean }): RunnerDeps & { store: MemoryCouncilStore; runtime: FakeRuntime } {
  const { data } = fixtureData(opts.scenario);
  const store = opts.store ?? memoryStore();
  const runtime = new FakeRuntime(opts.scripts);
  const now = opts.now ?? new Date(`${TODAY}T08:00:00Z`);
  return {
    store,
    runtime,
    dataFor: () => data,
    runtimeFor: () => (opts.apiKey === false ? null : runtime),
    now: () => now,
  };
}

/** Un trabajo de la cola ya reclamado, para llamar a runJob directamente. */
export async function claimedJob(store: MemoryCouncilStore, job: Omit<NewJob, "orgId"> & { orgId?: string }): Promise<JobRecord> {
  const { id } = await store.enqueueJob({ orgId: ORG_ID, ...job });
  const [claimed] = await store.claimJobs({ limit: 1, jobIds: [id] });
  if (!claimed) throw new Error("No se ha podido reclamar el trabajo");
  return claimed;
}

export { EXAMPLE_POLICY };
