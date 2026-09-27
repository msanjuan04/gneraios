// Lo que cuesta un cliente además de sus horas (definición v2 de la rentabilidad). Nada de esto se
// guarda: se deriva de los gastos del periodo y de las webs que alojamos.
//
// - Gastos del cliente: los gastos asignados a él (expenses.allocation = 'client') con fecha de
//   factura en el periodo. Cuestan lo mismo que en Finanzas: la base y, si el IVA no se deduce,
//   también el IVA (expenseCostCents). Un gasto que se repercute (rebill) es coste en su fecha y su
//   línea de factura es ingreso cuando se emite (va con lo facturado al cliente): el margen solo se
//   queda con el recargo. Mientras no está facturado, pesa como coste («pendiente de repercutir»).
// - Infraestructura compartida: cada gasto repartido entre las webs alojadas (allocation =
//   'hosted_sites') con fecha en el periodo se divide a partes iguales entre las webs que alojamos
//   (Webs: hosted_by_us y activas; Webs no guarda desde cuándo, así que son las de hoy) y cada
//   cliente suma la parte de sus webs. Un cliente no carga con lo de antes de ser cliente: su parte
//   de un gasto anterior a su primera factura o a su primer gasto directo no es suya. Esa parte, la
//   de las webs sin cliente (la nuestra) y todo, si no hay ninguna web alojada, no es de ningún
//   cliente: queda aparte («Infraestructura sin cliente»).
//
// Una sola fuente: los gastos. Las suscripciones cuentan por los gastos que generan (cada cargo es
// un gasto con la misma asignación), así que ninguna cuota se cuenta dos veces.

import { type CivilDate, compareCivil } from "../dates/civil-date";
import { assertCents, type Cents } from "../money";
import { allocateCents } from "./allocate";

/** Un gasto de un cliente con fecha en el periodo. */
export type ClientExpenseRef = {
  clientId: string;
  /** Lo que cuesta: base + IVA no deducible (negativo en un abono del proveedor). */
  costCents: Cents;
  /** Se repercute al cliente (su factura cuenta como ingreso al emitirse). */
  rebill: boolean;
  /** Ya tiene su línea de factura (expenses.rebill_invoice_line_id). */
  rebilled: boolean;
};

/** Un gasto repartido entre las webs alojadas, con fecha en el periodo. */
export type HostedCostRef = {
  costCents: Cents;
  /** Fecha de la factura: con ella se sabe si cada cliente ya lo era. Sin fecha, cuenta para todos. */
  issuedOn?: CivilDate;
};

/** Una web que alojamos y está activa (Webs). Sin cliente: la nuestra o de nadie en concreto. */
export type HostedSiteRef = { id: string; clientId: string | null };

/** Lo que cuesta un cliente además de sus horas. */
export type OtherCosts = {
  /** Sus gastos del periodo. */
  expensesCents: Cents;
  /** De ellos, los que se le repercuten. */
  rebillCents: Cents;
  /** De lo repercutible, lo que aún no tiene línea de factura. */
  rebillPendingCents: Cents;
  /** Su parte de la infraestructura compartida (la de sus webs alojadas). */
  hostingCents: Cents;
  /** Sus webs alojadas activas: cuántas partes le tocan. */
  hostedSites: number;
};

export function noOtherCosts(): OtherCosts {
  return { expensesCents: 0, rebillCents: 0, rebillPendingCents: 0, hostingCents: 0, hostedSites: 0 };
}

/** Gastos + infraestructura: lo que se suma al coste de las horas. */
export function otherCostsCents(costs: Pick<OtherCosts, "expensesCents" | "hostingCents">): Cents {
  return assertCents(costs.expensesCents + costs.hostingCents);
}

/** ¿Hay algo que contar? (Unos gastos que se anulan entre sí, o webs sin coste en el periodo, no.) */
export function hasOtherCosts(costs: Pick<OtherCosts, "expensesCents" | "hostingCents">): boolean {
  return costs.expensesCents !== 0 || costs.hostingCents !== 0;
}

export function addOtherCosts(a: OtherCosts, b: OtherCosts): OtherCosts {
  return {
    expensesCents: assertCents(a.expensesCents + b.expensesCents),
    rebillCents: assertCents(a.rebillCents + b.rebillCents),
    rebillPendingCents: assertCents(a.rebillPendingCents + b.rebillPendingCents),
    hostingCents: assertCents(a.hostingCents + b.hostingCents),
    hostedSites: a.hostedSites + b.hostedSites,
  };
}

export type HostingSplit = {
  totalCents: Cents;
  /** Webs alojadas activas entre las que se reparte. */
  sites: number;
  /** La parte de cada web; suman exactamente el total. */
  bySite: ReadonlyMap<string, Cents>;
  /** Por cliente: la suma de las partes de sus webs y cuántas son. */
  byClient: ReadonlyMap<string, { cents: Cents; sites: number }>;
  /** Lo que no va a ningún cliente: las webs sin cliente o, si no hay ninguna web, todo. */
  unassigned: { cents: Cents; sites: number };
};

/**
 * Reparte un coste a partes iguales entre las webs alojadas (exacto: el céntimo que sobra va a la
 * primera por id, así que no depende del orden en que llegan) y suma las de cada cliente. Una web
 * repetida cuenta una vez. Sin webs, no hay entre quién repartir: todo queda sin cliente.
 */
export function splitHosting(totalCents: Cents, sites: readonly HostedSiteRef[]): HostingSplit {
  assertCents(totalCents);
  const unique = [...new Map(sites.map((site) => [site.id, site])).values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (unique.length === 0) {
    return { totalCents, sites: 0, bySite: new Map(), byClient: new Map(), unassigned: { cents: totalCents, sites: 0 } };
  }
  const parts = allocateCents(
    totalCents,
    unique.map(() => 1),
  );
  const bySite = new Map<string, Cents>();
  const byClient = new Map<string, { cents: Cents; sites: number }>();
  const unassigned = { cents: 0, sites: 0 };
  unique.forEach((site, index) => {
    const part = parts[index]!;
    bySite.set(site.id, part);
    if (site.clientId === null) {
      unassigned.cents = assertCents(unassigned.cents + part);
      unassigned.sites += 1;
      return;
    }
    const current = byClient.get(site.clientId) ?? { cents: 0, sites: 0 };
    byClient.set(site.clientId, { cents: assertCents(current.cents + part), sites: current.sites + 1 });
  });
  return { totalCents, sites: unique.length, bySite, byClient, unassigned };
}

export type DatedHostingSplit = Omit<HostingSplit, "bySite"> & {
  /** De lo que no va a ningún cliente, la parte de clientes que aún no lo eran en la fecha del gasto. */
  beforeStartCents: Cents;
};

/**
 * Reparte cada gasto de las webs alojadas entre las webs (splitHosting, gasto a gasto por fecha) y
 * suma las partes de cada cliente. Con `starts` (desde cuándo es cliente cada uno: su primera
 * factura o su primer gasto directo), la parte de un cliente en un gasto anterior, o de un cliente
 * que aún no tiene ninguna de las dos cosas, no es suya: va a lo que no es de ningún cliente. Sin
 * `starts`, todo cuenta (es splitHosting del total).
 */
export function splitHostingCosts(
  costs: readonly HostedCostRef[],
  sites: readonly HostedSiteRef[],
  starts?: ReadonlyMap<string, CivilDate>,
): DatedHostingSplit {
  const totalCents = costs.reduce((sum, cost) => assertCents(sum + assertCents(cost.costCents)), 0);
  if (!starts) {
    const split = splitHosting(totalCents, sites);
    return { totalCents, sites: split.sites, byClient: split.byClient, unassigned: split.unassigned, beforeStartCents: 0 };
  }

  // Un reparto por fecha (los gastos del mismo día se suman antes): cada uno es exacto, así que la
  // suma también lo es.
  const byDate = new Map<string, Cents>();
  for (const cost of costs) byDate.set(cost.issuedOn ?? "", assertCents((byDate.get(cost.issuedOn ?? "") ?? 0) + cost.costCents));
  const shape = splitHosting(0, sites);
  const byClient = new Map<string, { cents: Cents; sites: number }>();
  for (const [clientId, share] of shape.byClient) byClient.set(clientId, { cents: 0, sites: share.sites });
  const unassigned = { cents: 0, sites: shape.unassigned.sites };
  let beforeStartCents = 0;
  for (const [date, cents] of [...byDate].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const split = splitHosting(cents, sites);
    unassigned.cents = assertCents(unassigned.cents + split.unassigned.cents);
    for (const [clientId, share] of split.byClient) {
      const start = starts.get(clientId);
      if (date === "" || (start !== undefined && compareCivil(start, date) <= 0)) {
        const current = byClient.get(clientId)!;
        current.cents = assertCents(current.cents + share.cents);
      } else {
        unassigned.cents = assertCents(unassigned.cents + share.cents);
        beforeStartCents = assertCents(beforeStartCents + share.cents);
      }
    }
  }
  return { totalCents, sites: shape.sites, byClient, unassigned, beforeStartCents };
}

/** Lo que le cuesta a cada cliente, además de sus horas: sus gastos y la parte de sus webs. */
export function otherCostsByClient(expenses: readonly ClientExpenseRef[], hosting: Pick<HostingSplit, "byClient">): Map<string, OtherCosts> {
  const byClient = new Map<string, OtherCosts>();
  const entry = (clientId: string) => {
    const current = byClient.get(clientId) ?? noOtherCosts();
    byClient.set(clientId, current);
    return current;
  };
  for (const expense of expenses) {
    const cost = assertCents(expense.costCents);
    const current = entry(expense.clientId);
    current.expensesCents = assertCents(current.expensesCents + cost);
    if (expense.rebill) {
      current.rebillCents = assertCents(current.rebillCents + cost);
      if (!expense.rebilled) current.rebillPendingCents = assertCents(current.rebillPendingCents + cost);
    }
  }
  for (const [clientId, share] of hosting.byClient) {
    const current = entry(clientId);
    current.hostingCents = share.cents;
    current.hostedSites = share.sites;
  }
  return byClient;
}
