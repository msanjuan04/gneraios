// Rentabilidad de cada cliente y de cada proyecto en un periodo (definición v2). Nada de esto se
// guarda: se deriva de lo facturado y lo cobrado sin factura, de las horas y del coste por hora de
// cada persona, y de los gastos.
//
// Ingresos: la base imponible, sin IVA ni IRPF, de las facturas emitidas con fecha de emisión en el
// periodo (la misma definición que el dashboard y Finanzas; las rectificativas restan en la suya),
// más los cobros sin factura (client_receipts) con fecha en el periodo, tal cual: no desglosan IVA.
// Van al cliente y, dentro de él, a sus proyectos así:
//   0. Directo: un cobro sin factura apuntado a un proyecto del cliente va a ese proyecto.
//   1. Por contrato: una línea que sale de un contrato (directamente o porque rectifica una que
//      salía de él; vista project_contract_revenue) va a los proyectos de ese contrato. Si son
//      varios, se reparte por sus horas del periodo (a partes iguales si nadie ha registrado).
//   2. Por horas: el resto del cliente (líneas sin contrato, de contratos sin proyecto o cobros sin
//      proyecto) se reparte por horas del periodo entre sus proyectos sin contrato que tienen horas.
//   3. Sin proyecto: si no hay entre quién repartirlo, queda en una fila «Sin proyecto».
// Todos los repartos son exactos (mayor resto): un cliente suma lo mismo que sus filas.
//
// Coste (definición v2): las horas, los gastos del cliente y su parte de la infraestructura.
//   - Horas: cada registro terminado (el temporizador en marcha no cuenta) por el coste por hora de
//     quien lo hizo ese día (costs.ts), redondeado al céntimo una vez por proyecto. Las horas no
//     facturables también cuestan.
//   - Gastos e infraestructura (other-costs.ts): los gastos asignados al cliente y la parte de sus
//     webs alojadas de lo que se reparte entre ellas. Son del cliente, no de un proyecto: cuentan en
//     su fila y no en las de sus proyectos. Lo repercutido es coste y su factura, ingreso.
//
// Cobrado y pendiente (solo una vista de caja: el margen no los usa): lo cobrado son los cobros de
// facturas (tabla payments, la única fuente de «cobrada» de una factura) con fecha en el periodo,
// con IVA, sean de facturas del periodo o de antes, más los cobros sin factura del periodo; lo
// pendiente, lo que falta hoy por cobrar de las facturas emitidas en el periodo, también con IVA.
//
// Margen = ingresos − coste; su porcentaje, sobre los ingresos (null si no son positivos). €/hora
// efectivo = ingresos × 60 ÷ minutos (null sin horas). Los proyectos internos (sin cliente) y la
// infraestructura de las webs sin cliente se cuentan aparte: cuestan, pero no a ningún cliente.

import type { CivilDate } from "../dates/civil-date";
import { marginBps } from "../finance/pnl";
import { assertCents, type Bps, type Cents } from "../money";
import { effectiveRateCents } from "../projects/economics";
import type { ProjectStatus } from "../projects/types";
import { allocateCents } from "./allocate";
import { centMinutesToCents, costBook, costMinuteCents, hourlyCostOn, type MemberCost } from "./costs";
import {
  addOtherCosts,
  type ClientExpenseRef,
  hasOtherCosts,
  type HostedCostRef,
  type HostedSiteRef,
  noOtherCosts,
  type OtherCosts,
  otherCostsByClient,
  otherCostsCents,
  splitHostingCosts,
} from "./other-costs";
import type { ProfitabilitySettings } from "./settings";

/**
 * Sube si cambia la definición (qué ingresos cuentan, cómo se reparten o cómo se calcula el coste).
 * v2: el coste suma los gastos del cliente y su parte de la infraestructura de las webs alojadas.
 */
export const PROFITABILITY_DEFINITION_VERSION = 2;

export const FLAGS = ["lowMargin", "lowRate", "hoursWithoutRevenue", "revenueWithoutHours"] as const;
export type Flag = (typeof FLAGS)[number];

/** Los avisos que piden hacer algo; «Sin horas» (facturado sin horas registradas) solo informa. */
export const ATTENTION_FLAGS = ["lowMargin", "lowRate", "hoursWithoutRevenue"] as const satisfies readonly Flag[];

export type Figures = {
  revenueCents: Cents;
  costCents: Cents;
  minutes: number;
  marginCents: Cents;
  /** Margen sobre ingresos en puntos básicos; null si los ingresos no son positivos. */
  marginBps: Bps | null;
  /** €/hora efectivo en céntimos; null sin horas. */
  rateCents: Cents | null;
  /** En el orden de FLAGS. */
  flags: Flag[];
};

// ---------------------------------------------------------------------------
// Entradas (las carga src/server/profitability con la sesión del usuario)
// ---------------------------------------------------------------------------

/** Una factura emitida en el periodo: su base (subtotal sin IVA ni IRPF; negativa si rectifica). */
export type InvoiceRevenue = {
  invoiceId: string;
  clientId: string;
  baseCents: Cents;
  /** Lo que falta hoy por cobrar de ella, con IVA (0 si está cobrada o es una rectificativa). */
  pendingCents?: Cents;
};

/** Un cobro de factura con fecha en el periodo (con IVA): del cliente de su factura. Negativo si se devolvió. */
export type PaymentRef = { clientId: string; amountCents: Cents };

/**
 * Un cobro sin factura (client_receipts) con fecha en el periodo: es ingreso (tal cual, sin IVA
 * desglosado) y cobrado. Negativo si se devolvió. Con proyecto, va a ese proyecto.
 */
export type ReceiptRef = { clientId: string; projectId: string | null; amountCents: Cents };

/** Una línea emitida en el periodo que sale de un contrato (vista project_contract_revenue). */
export type ContractLineRevenue = { invoiceId: string; contractId: string; baseCents: Cents };

export type ProjectRef = {
  id: string;
  /** null: proyecto interno. */
  clientId: string | null;
  contractId: string | null;
  name: string;
  status: ProjectStatus;
  archived: boolean;
};

/** Un registro de horas terminado del periodo. */
export type TimeEntryRef = { memberId: string; projectId: string; workedOn: CivilDate; minutes: number };

export type ClientRef = { id: string; name: string };

export type ProfitabilityInput = {
  invoices: readonly InvoiceRevenue[];
  contractLines: readonly ContractLineRevenue[];
  projects: readonly ProjectRef[];
  entries: readonly TimeEntryRef[];
  /** Todo el historial (también lo anterior al periodo: un coste sigue vigente hasta el siguiente). */
  costs: readonly MemberCost[];
  clients: readonly ClientRef[];
  settings: ProfitabilitySettings;
  /** Gastos asignados a un cliente con fecha en el periodo. Sin ellos, solo cuentan las horas. */
  clientExpenses?: readonly ClientExpenseRef[];
  /** Gastos repartidos entre las webs alojadas, con fecha en el periodo. */
  hostedCosts?: readonly HostedCostRef[];
  /** Las webs que alojamos y están activas: entre ellas se reparte lo anterior. */
  hostedSites?: readonly HostedSiteRef[];
  /**
   * Desde cuándo es cliente cada uno (su primera factura o su primer gasto directo): su parte de la
   * infraestructura cuenta desde ese día. Sin él, cuenta toda la del periodo.
   */
  hostingStarts?: ReadonlyMap<string, CivilDate>;
  /** Cobros de facturas con fecha en el periodo. */
  payments?: readonly PaymentRef[];
  /** Cobros sin factura con fecha en el periodo. */
  receipts?: readonly ReceiptRef[];
};

// ---------------------------------------------------------------------------
// Salida
// ---------------------------------------------------------------------------

export type ProjectRow = Figures & {
  /** null: lo facturado al cliente que no va a ningún proyecto («Sin proyecto»). */
  projectId: string | null;
  name: string | null;
  status: ProjectStatus | null;
  archived: boolean;
  /** Lo que le llega por su contrato (paso 1). */
  contractRevenueCents: Cents;
  /** Lo que le llega repartido por horas (paso 2). */
  allocatedRevenueCents: Cents;
  /** Lo que le llega directamente: cobros sin factura apuntados a este proyecto (paso 0). */
  directRevenueCents: Cents;
  /** Comparte contrato con otros proyectos del cliente: lo del contrato se reparte por horas. */
  sharedContract: boolean;
};

export type ClientRow = Figures & {
  clientId: string;
  /** null si el cliente no está en la lista (no debería pasar). */
  name: string | null;
  /** Con horas o ingresos en el periodo; «Sin proyecto» al final. */
  projects: ProjectRow[];
  /** El coste de sus horas: la suma de sus proyectos. */
  hoursCostCents: Cents;
  /** Gastos e infraestructura. costCents = hoursCostCents + gastos + infraestructura. */
  otherCosts: OtherCosts;
  /** Cobrado en el periodo: cobros de facturas (con IVA) y cobros sin factura (vista de caja: no cuenta en el margen). */
  collectedCents: Cents;
  /** De los ingresos, los cobros sin factura del periodo. */
  receiptsCents: Cents;
  /** Lo que falta hoy por cobrar de lo facturado en el periodo, con IVA. */
  pendingCents: Cents;
  /** Parte de los ingresos repartida por horas (paso 2). */
  allocatedRevenueCents: Cents;
  /** Parte de los ingresos que no va a ningún proyecto (paso 3). */
  unassignedRevenueCents: Cents;
};

export type InternalRow = {
  projectId: string;
  name: string;
  status: ProjectStatus;
  archived: boolean;
  minutes: number;
  costCents: Cents;
};

export type ProfitabilityReport = {
  /** Del mejor margen al peor. */
  clients: ClientRow[];
  /** La suma de los clientes (el trabajo interno va aparte). */
  totals: Figures;
  internal: { minutes: number; costCents: Cents; projects: InternalRow[] };
  /** Minutos valorados con el coste por defecto de la org (sin coste propio vigente ese día). */
  defaultCostMinutes: number;
  /** El coste de los totales por partes: horas, y gastos e infraestructura (la suma de los clientes). */
  costs: { hoursCents: Cents; other: OtherCosts };
  /**
   * La infraestructura compartida del periodo: cuánto es, entre cuántas webs se reparte y lo que no
   * va a ningún cliente (las webs sin cliente o, sin ninguna web alojada, todo). Va aparte, como el
   * trabajo interno.
   */
  hosting: {
    totalCents: Cents;
    sites: number;
    unassignedCents: Cents;
    unassignedSites: number;
    /** De lo que no va a ningún cliente, la parte de clientes que aún no lo eran en la fecha del gasto. */
    beforeStartCents: Cents;
  };
  /** Cobrado y pendiente de todos los clientes; de lo cobrado, lo que son cobros sin factura. */
  collection: { collectedCents: Cents; pendingCents: Cents; receiptsCents: Cents };
};

// ---------------------------------------------------------------------------
// Cálculo
// ---------------------------------------------------------------------------

/** Los avisos de unas cifras con los umbrales de la org, en el orden de FLAGS. */
export function flagsOf(
  figures: Pick<Figures, "revenueCents" | "minutes" | "marginBps" | "rateCents">,
  settings: ProfitabilitySettings,
): Flag[] {
  const flags: Flag[] = [];
  if (figures.marginBps !== null && figures.marginBps < settings.minMarginBps) flags.push("lowMargin");
  if (figures.revenueCents > 0 && figures.rateCents !== null && figures.rateCents < settings.minHourlyRateCents) flags.push("lowRate");
  if (figures.minutes > 0 && figures.revenueCents <= 0) flags.push("hoursWithoutRevenue");
  if (figures.minutes === 0 && figures.revenueCents > 0) flags.push("revenueWithoutHours");
  return flags;
}

/** Margen, margen %, €/hora y avisos de unos ingresos, un coste y unos minutos. Sin divisiones por cero. */
export function figuresOf(revenueCents: Cents, costCents: Cents, minutes: number, settings: ProfitabilitySettings): Figures {
  assertCents(revenueCents);
  assertCents(costCents);
  if (!Number.isSafeInteger(minutes) || minutes < 0) throw new Error(`Minutos no válidos: ${String(minutes)}.`);
  const marginCents = assertCents(revenueCents - costCents);
  const base = {
    revenueCents,
    costCents,
    minutes,
    marginCents,
    marginBps: marginBps(marginCents, revenueCents),
    rateCents: effectiveRateCents(revenueCents, minutes),
  };
  return { ...base, flags: flagsOf(base, settings) };
}

/** ¿Tiene algún aviso de los que piden hacer algo? */
export function needsAttention(figures: Pick<Figures, "flags">): boolean {
  return figures.flags.some((flag) => (ATTENTION_FLAGS as readonly Flag[]).includes(flag));
}

const add = (a: Cents, b: Cents): Cents => assertCents(a + b);

type Work = { minutes: number; centMinutes: bigint };

/** Del mejor margen al peor; a igualdad, más ingresos y luego por nombre. */
function compareByMargin(a: Figures & { name: string | null }, b: Figures & { name: string | null }): number {
  return b.marginCents - a.marginCents || b.revenueCents - a.revenueCents || (a.name ?? "").localeCompare(b.name ?? "", "es");
}

export function buildProfitability(input: ProfitabilityInput): ProfitabilityReport {
  const { settings } = input;
  const book = costBook(input.costs);
  const projectsById = new Map(input.projects.map((p) => [p.id, p]));
  const clientNames = new Map(input.clients.map((c) => [c.id, c.name]));

  // Horas y coste (en céntimos-minuto, sin redondear) de cada proyecto.
  const work = new Map<string, Work>();
  let defaultCostMinutes = 0;
  for (const entry of input.entries) {
    if (!projectsById.has(entry.projectId)) continue;
    const cost = hourlyCostOn(book, entry.memberId, entry.workedOn, settings.defaultHourlyCostCents);
    if (cost.fromDefault) defaultCostMinutes += entry.minutes;
    const current = work.get(entry.projectId) ?? { minutes: 0, centMinutes: BigInt(0) };
    current.minutes += entry.minutes;
    current.centMinutes += costMinuteCents(entry.minutes, cost.cents);
    work.set(entry.projectId, current);
  }
  const minutesOf = (projectId: string) => work.get(projectId)?.minutes ?? 0;
  const costOf = (projectId: string) => {
    const w = work.get(projectId);
    return w ? centMinutesToCents(w.centMinutes) : 0;
  };

  // Lo facturado a cada cliente y, de ello, lo que sale de cada contrato.
  const clientOfInvoice = new Map<string, string>();
  const revenueByClient = new Map<string, Cents>();
  const pendingByClient = new Map<string, Cents>();
  for (const invoice of input.invoices) {
    clientOfInvoice.set(invoice.invoiceId, invoice.clientId);
    revenueByClient.set(invoice.clientId, add(revenueByClient.get(invoice.clientId) ?? 0, assertCents(invoice.baseCents)));
    if (invoice.pendingCents) pendingByClient.set(invoice.clientId, add(pendingByClient.get(invoice.clientId) ?? 0, assertCents(invoice.pendingCents)));
  }
  const collectedByClient = new Map<string, Cents>();
  for (const payment of input.payments ?? []) {
    collectedByClient.set(payment.clientId, add(collectedByClient.get(payment.clientId) ?? 0, assertCents(payment.amountCents)));
  }
  // Los cobros sin factura: ingreso y cobrado del cliente; con proyecto, ingreso directo de ese proyecto.
  const receiptsByClient = new Map<string, Cents>();
  const directByProject = new Map<string, Cents>();
  for (const receipt of input.receipts ?? []) {
    const cents = assertCents(receipt.amountCents);
    receiptsByClient.set(receipt.clientId, add(receiptsByClient.get(receipt.clientId) ?? 0, cents));
    revenueByClient.set(receipt.clientId, add(revenueByClient.get(receipt.clientId) ?? 0, cents));
    collectedByClient.set(receipt.clientId, add(collectedByClient.get(receipt.clientId) ?? 0, cents));
    const project = receipt.projectId ? projectsById.get(receipt.projectId) : undefined;
    if (project && project.clientId === receipt.clientId) directByProject.set(project.id, add(directByProject.get(project.id) ?? 0, cents));
  }
  const contractRevenue = new Map<string, Map<string, Cents>>();
  for (const line of input.contractLines) {
    const clientId = clientOfInvoice.get(line.invoiceId);
    if (!clientId) continue;
    const byContract = contractRevenue.get(clientId) ?? new Map<string, Cents>();
    byContract.set(line.contractId, add(byContract.get(line.contractId) ?? 0, assertCents(line.baseCents)));
    contractRevenue.set(clientId, byContract);
  }

  const projectsByClient = new Map<string, ProjectRef[]>();
  const internalProjects: ProjectRef[] = [];
  for (const project of input.projects) {
    if (project.clientId === null) {
      internalProjects.push(project);
      continue;
    }
    const list = projectsByClient.get(project.clientId) ?? [];
    list.push(project);
    projectsByClient.set(project.clientId, list);
  }
  // Por id: los repartos (y sus desempates) no dependen del orden en que llegan las filas.
  for (const list of projectsByClient.values()) list.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // Gastos del cliente y su parte de la infraestructura compartida (el reparto, entre todas las webs).
  const hosting = splitHostingCosts(input.hostedCosts ?? [], input.hostedSites ?? [], input.hostingStarts);
  const otherByClient = otherCostsByClient(input.clientExpenses ?? [], hosting);

  // Clientes con ingresos, con horas, con otros costes o con cobros en el periodo.
  const clientIds = new Set(revenueByClient.keys());
  for (const [clientId, projects] of projectsByClient) {
    if (projects.some((p) => minutesOf(p.id) > 0)) clientIds.add(clientId);
  }
  for (const [clientId, other] of otherByClient) {
    if (hasOtherCosts(other)) clientIds.add(clientId);
  }
  for (const [clientId, cents] of collectedByClient) {
    if (cents !== 0) clientIds.add(clientId);
  }

  const clients: ClientRow[] = [];
  // En orden de id: con la ordenación estable, un empate total también sale siempre igual.
  for (const clientId of [...clientIds].sort()) {
    const projects = projectsByClient.get(clientId) ?? [];
    const revenueCents = revenueByClient.get(clientId) ?? 0;
    const fromContract = new Map<string, Cents>();
    const fromHours = new Map<string, Cents>();
    const shared = new Set<string>();

    // 0. Directo: los cobros sin factura apuntados a un proyecto. 1. Por contrato. Lo de un contrato
    // sin proyectos pasa al resto.
    let rest = revenueCents;
    for (const project of projects) rest = assertCents(rest - (directByProject.get(project.id) ?? 0));
    const byContract = [...(contractRevenue.get(clientId) ?? new Map<string, Cents>())].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    for (const [contractId, cents] of byContract) {
      const linked = projects.filter((p) => p.contractId === contractId);
      if (linked.length === 0) continue;
      rest = assertCents(rest - cents);
      const parts = allocateCents(cents, linked.map((p) => minutesOf(p.id)));
      linked.forEach((p, i) => fromContract.set(p.id, add(fromContract.get(p.id) ?? 0, parts[i]!)));
      if (linked.length > 1) for (const p of linked) shared.add(p.id);
    }

    // 2. Por horas, entre los proyectos sin contrato con horas. 3. Si no hay ninguno, sin proyecto.
    let unassignedRevenueCents = 0;
    let allocatedRevenueCents = 0;
    const byHours = projects.filter((p) => p.contractId === null && minutesOf(p.id) > 0);
    if (rest !== 0 && byHours.length > 0) {
      const parts = allocateCents(rest, byHours.map((p) => minutesOf(p.id)));
      byHours.forEach((p, i) => fromHours.set(p.id, parts[i]!));
      allocatedRevenueCents = rest;
    } else {
      unassignedRevenueCents = rest;
    }

    const rows: ProjectRow[] = [];
    for (const project of projects) {
      const minutes = minutesOf(project.id);
      const contractRevenueCents = fromContract.get(project.id) ?? 0;
      const hoursRevenueCents = fromHours.get(project.id) ?? 0;
      const directRevenueCents = directByProject.get(project.id) ?? 0;
      const projectRevenue = add(add(contractRevenueCents, hoursRevenueCents), directRevenueCents);
      if (minutes === 0 && projectRevenue === 0) continue;
      rows.push({
        ...figuresOf(projectRevenue, costOf(project.id), minutes, settings),
        projectId: project.id,
        name: project.name,
        status: project.status,
        archived: project.archived,
        contractRevenueCents,
        allocatedRevenueCents: hoursRevenueCents,
        directRevenueCents,
        sharedContract: shared.has(project.id),
      });
    }
    rows.sort(compareByMargin);
    if (unassignedRevenueCents !== 0) {
      rows.push({
        ...figuresOf(unassignedRevenueCents, 0, 0, settings),
        projectId: null,
        name: null,
        status: null,
        archived: false,
        contractRevenueCents: 0,
        allocatedRevenueCents: 0,
        directRevenueCents: 0,
        sharedContract: false,
      });
    }

    const hoursCostCents = rows.reduce((sum, r) => add(sum, r.costCents), 0);
    const minutes = rows.reduce((sum, r) => sum + r.minutes, 0);
    const otherCosts = otherByClient.get(clientId) ?? noOtherCosts();
    const collectedCents = collectedByClient.get(clientId) ?? 0;
    const pendingCents = pendingByClient.get(clientId) ?? 0;
    // Una factura y su rectificativa en el mismo periodo, sin horas, costes ni cobros: no hay nada que enseñar.
    if (revenueCents === 0 && minutes === 0 && !hasOtherCosts(otherCosts) && collectedCents === 0 && pendingCents === 0) continue;
    clients.push({
      ...figuresOf(revenueCents, add(hoursCostCents, otherCostsCents(otherCosts)), minutes, settings),
      clientId,
      name: clientNames.get(clientId) ?? null,
      projects: rows,
      hoursCostCents,
      otherCosts,
      collectedCents,
      receiptsCents: receiptsByClient.get(clientId) ?? 0,
      pendingCents,
      allocatedRevenueCents,
      unassignedRevenueCents,
    });
  }
  clients.sort(compareByMargin);

  const internal = internalProjects
    .filter((p) => minutesOf(p.id) > 0)
    .map(
      (p): InternalRow => ({ projectId: p.id, name: p.name, status: p.status, archived: p.archived, minutes: minutesOf(p.id), costCents: costOf(p.id) }),
    )
    .sort((a, b) => b.costCents - a.costCents || a.name.localeCompare(b.name, "es"));

  return {
    clients,
    totals: figuresOf(
      clients.reduce((sum, c) => add(sum, c.revenueCents), 0),
      clients.reduce((sum, c) => add(sum, c.costCents), 0),
      clients.reduce((sum, c) => sum + c.minutes, 0),
      settings,
    ),
    internal: {
      minutes: internal.reduce((sum, p) => sum + p.minutes, 0),
      costCents: internal.reduce((sum, p) => add(sum, p.costCents), 0),
      projects: internal,
    },
    defaultCostMinutes,
    costs: {
      hoursCents: clients.reduce((sum, c) => add(sum, c.hoursCostCents), 0),
      other: clients.reduce((sum, c) => addOtherCosts(sum, c.otherCosts), noOtherCosts()),
    },
    hosting: {
      totalCents: hosting.totalCents,
      sites: hosting.sites,
      unassignedCents: hosting.unassigned.cents,
      unassignedSites: hosting.unassigned.sites,
      beforeStartCents: hosting.beforeStartCents,
    },
    collection: {
      collectedCents: clients.reduce((sum, c) => add(sum, c.collectedCents), 0),
      pendingCents: clients.reduce((sum, c) => add(sum, c.pendingCents), 0),
      receiptsCents: clients.reduce((sum, c) => add(sum, c.receiptsCents), 0),
    },
  };
}

/** Las cifras de un cliente en un informe (ceros si no tuvo ni ingresos, ni horas, ni otros costes). */
export function clientFigures(report: ProfitabilityReport, clientId: string, settings: ProfitabilitySettings): Figures {
  const row = report.clients.find((c) => c.clientId === clientId);
  if (!row) return figuresOf(0, 0, 0, settings);
  const { revenueCents, costCents, minutes, marginCents, marginBps: bps, rateCents, flags } = row;
  return { revenueCents, costCents, minutes, marginCents, marginBps: bps, rateCents, flags };
}

export type ClientBreakdown = { hoursCostCents: Cents; otherCosts: OtherCosts; collectedCents: Cents; receiptsCents: Cents; pendingCents: Cents };

/** El coste de un cliente por partes (sus horas y lo demás) y lo cobrado y pendiente; ceros si no está en el informe. */
export function clientCostSplit(report: ProfitabilityReport, clientId: string): ClientBreakdown {
  const row = report.clients.find((c) => c.clientId === clientId);
  return row
    ? {
        hoursCostCents: row.hoursCostCents,
        otherCosts: { ...row.otherCosts },
        collectedCents: row.collectedCents,
        receiptsCents: row.receiptsCents,
        pendingCents: row.pendingCents,
      }
    : { hoursCostCents: 0, otherCosts: noOtherCosts(), collectedCents: 0, receiptsCents: 0, pendingCents: 0 };
}

/**
 * Los clientes de la gráfica de margen: los `limit` de mayor margen en valor absoluto (lo que más
 * aporta y lo que más resta), del mejor al peor. `hidden`: cuántos se quedan fuera (están en la tabla).
 */
export function marginChartClients<T extends Pick<Figures, "marginCents" | "revenueCents">>(clients: readonly T[], limit: number): { rows: T[]; hidden: number } {
  const picked = [...clients]
    .map((client, index) => ({ client, index }))
    .sort((a, b) => Math.abs(b.client.marginCents) - Math.abs(a.client.marginCents) || a.index - b.index)
    .slice(0, Math.max(0, limit))
    .sort((a, b) => b.client.marginCents - a.client.marginCents || a.index - b.index)
    .map((x) => x.client);
  return { rows: picked, hidden: clients.length - picked.length };
}
