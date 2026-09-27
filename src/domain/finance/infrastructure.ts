// Finanzas → Infraestructura: lo que cuestan de verdad los servidores, las bases de datos, los
// dominios y el software de las webs. Nada se guarda: se deriva de las suscripciones, los gastos y
// las webs que alojamos (Webs).
//
// Qué entra: todo lo de una categoría de infraestructura (expense_categories.is_infrastructure) y
// todo lo que se reparte entre las webs alojadas (allocation = 'hosted_sites'), sea de la categoría
// que sea.
//
// - Coste mensual: el equivalente mensual de las suscripciones en marcha (la cuota de las mensuales
//   y la doceava parte de las anuales, redondeada una vez), con la misma regla de coste que Finanzas
//   (base + IVA no deducible). Anual: las mensuales × 12 más las anuales enteras.
// - Gastado en 12 meses: los gastos registrados (también los sueltos y los que generan las
//   suscripciones) con fecha de factura en los últimos 12 meses. Es otra cifra: no se suma a la de
//   las suscripciones.
// - Coste por web alojada: lo mensual que se reparte entre las webs alojadas, a partes iguales entre
//   las activas (el mismo reparto que la rentabilidad, splitHosting); cada cliente suma sus webs.
// - Renovaciones: el próximo cargo de cada suscripción y los días que faltan (renewals.ts).

import { compareCivil, type CivilDate } from "../dates/civil-date";
import { assertCents, type Bps, type Cents, divRoundHalfAwayFromZero } from "../money";
import { splitHosting } from "../profitability/other-costs";
import type { CostAllocation } from "./allocation";
import { type ExpenseGroup, expenseCostCents } from "./expense";
import { daysUntil, isRenewalWatched, isRunning, isWithinWarning, nextRenewalOn, type RenewalSchedule, type RenewalSettings } from "./renewals";
import { subscriptionAmounts } from "./subscriptions";

export type InfraCategory = { id: string; name: string; expenseGroup: ExpenseGroup; isInfrastructure: boolean };
export type InfraNamed = { id: string; name: string };

export type InfraSubscriptionInput = RenewalSchedule & {
  id: string;
  description: string;
  vendorId: string | null;
  categoryId: string;
  baseCents: Cents;
  vatBps: Bps;
  vatDeductible: boolean;
  irpfBps: Bps;
  allocation: CostAllocation;
  clientId: string | null;
};

/** Un gasto registrado (de la ventana de 12 meses que carga el servidor). */
export type InfraExpenseInput = { categoryId: string; allocation: CostAllocation; costCents: Cents };

/** Una web alojada y activa. */
export type InfraSiteInput = { id: string; name: string; clientId: string | null };

export type InfrastructureInput = {
  today: CivilDate;
  settings: RenewalSettings;
  subscriptions: readonly InfraSubscriptionInput[];
  categories: readonly InfraCategory[];
  vendors: readonly InfraNamed[];
  clients: readonly InfraNamed[];
  /** Los gastos de los últimos 12 meses (de cualquier categoría: aquí se filtran). */
  expenses: readonly InfraExpenseInput[];
  sites: readonly InfraSiteInput[];
};

export type InfraSubscriptionRow = {
  id: string;
  description: string;
  vendorId: string | null;
  vendorName: string | null;
  categoryId: string;
  categoryName: string | null;
  interval: InfraSubscriptionInput["interval"];
  allocation: CostAllocation;
  /** Solo si es de un cliente concreto. */
  clientName: string | null;
  /** Encendida (apagada no genera cargos). */
  isActive: boolean;
  /** Encendida y sin terminar: cuenta en los totales. */
  running: boolean;
  /** Lo que se paga en cada cargo: base + IVA − IRPF. */
  chargeTotalCents: Cents;
  /** Lo que cuesta cada cargo: base + IVA no deducible. */
  chargeCostCents: Cents;
  /** Equivalente mensual y coste anual (0 si no está en marcha). */
  monthlyCents: Cents;
  yearlyCents: Cents;
  nextRenewalOn: CivilDate | null;
  daysLeft: number | null;
  /** ¿Es su primer cargo (aún no ha empezado)? */
  firstCharge: boolean;
  /** ¿Se avisa de sus renovaciones (bandeja y push)? */
  watched: boolean;
  /** Se avisa y el cargo cae dentro de los días de aviso: se resalta. */
  dueSoon: boolean;
};

export type InfraBreakdownRow = {
  /** Id del proveedor o de la categoría; null: sin proveedor (o «Otros» al plegar). */
  id: string | null;
  name: string | null;
  monthlyCents: Cents;
  /** Cuántas suscripciones. */
  count: number;
};

export type HostedSiteShare = { id: string; name: string; monthlyCents: Cents };
export type HostedClientGroup = { clientId: string | null; name: string | null; sites: HostedSiteShare[]; monthlyCents: Cents };

export type InfrastructureReport = {
  /** En marcha primero, del cargo más cercano al más lejano; después, las apagadas o terminadas. */
  subscriptions: InfraSubscriptionRow[];
  totals: { monthlyCents: Cents; yearlyCents: Cents; running: number };
  /** Del mayor coste mensual al menor. */
  byVendor: InfraBreakdownRow[];
  byCategory: InfraBreakdownRow[];
  /** Gastos registrados en los últimos 12 meses. */
  spent12m: { cents: Cents; count: number };
  hosting: {
    /** Lo mensual que se reparte entre las webs alojadas. */
    monthlyCents: Cents;
    sites: number;
    /** El coste medio por web y mes (null sin webs). */
    perSiteCents: Cents | null;
    /** Por cliente, del que más paga al que menos; las webs sin cliente, al final. */
    groups: HostedClientGroup[];
  };
  /** Las que se avisan y se renuevan dentro de los días de aviso. */
  dueSoon: number;
  /** ¿Hay algo que enseñar (alguna suscripción o gasto de infraestructura)? */
  empty: boolean;
};

/** ¿Entra en Infraestructura? Una categoría de infraestructura o un coste de las webs alojadas. */
export function isInfrastructureCost(allocation: CostAllocation, category: Pick<InfraCategory, "isInfrastructure"> | undefined): boolean {
  return allocation === "hosted_sites" || category?.isInfrastructure === true;
}

/** Coste de un cargo (base + IVA no deducible): la regla de Finanzas (expenseCostCents). */
export function chargeCostCents(sub: Pick<InfraSubscriptionInput, "baseCents" | "vatBps" | "irpfBps" | "vatDeductible">): Cents {
  const amounts = subscriptionAmounts(sub);
  return expenseCostCents({ baseCents: amounts.baseCents, vatCents: amounts.vatCents, vatDeductible: sub.vatDeductible });
}

/**
 * Equivalente mensual de una suscripción en marcha: la cuota o, si es anual, la doceava parte
 * (redondeada una vez). La misma regla que subscriptionMonthlyCostCents (hay un test de paridad).
 */
export function monthlyEquivalentCents(interval: InfraSubscriptionInput["interval"], costPerChargeCents: Cents): Cents {
  assertCents(costPerChargeCents);
  return interval === "monthly" ? costPerChargeCents : Number(divRoundHalfAwayFromZero(BigInt(costPerChargeCents), BigInt(12)));
}

/** Coste de un año: 12 cuotas o una anualidad. */
export function yearlyCostCents(interval: InfraSubscriptionInput["interval"], costPerChargeCents: Cents): Cents {
  return assertCents(interval === "monthly" ? costPerChargeCents * 12 : costPerChargeCents);
}

/**
 * Las `limit` filas de más coste y, si sobran, una más con el resto sumado (id y nombre null:
 * «Otros»). Así la gráfica nunca pasa de `limit + 1` barras.
 */
export function topWithOthers(rows: readonly InfraBreakdownRow[], limit: number): { rows: InfraBreakdownRow[]; others: InfraBreakdownRow | null } {
  if (rows.length <= limit + 1) return { rows: [...rows], others: null };
  const head = rows.slice(0, Math.max(0, limit));
  const tail = rows.slice(Math.max(0, limit));
  return {
    rows: head,
    others: {
      id: null,
      name: null,
      monthlyCents: tail.reduce((sum, r) => assertCents(sum + r.monthlyCents), 0),
      count: tail.reduce((sum, r) => sum + r.count, 0),
    },
  };
}

function breakdown(rows: readonly InfraSubscriptionRow[], keyOf: (row: InfraSubscriptionRow) => { id: string | null; name: string | null }): InfraBreakdownRow[] {
  const groups = new Map<string, InfraBreakdownRow>();
  for (const row of rows) {
    const { id, name } = keyOf(row);
    const key = id ?? "";
    const current = groups.get(key) ?? { id, name, monthlyCents: 0, count: 0 };
    current.monthlyCents = assertCents(current.monthlyCents + row.monthlyCents);
    current.count += 1;
    groups.set(key, current);
  }
  return [...groups.values()].sort(
    (a, b) => b.monthlyCents - a.monthlyCents || Number(a.id === null) - Number(b.id === null) || (a.name ?? "").localeCompare(b.name ?? "", "es"),
  );
}

export function buildInfrastructure(input: InfrastructureInput): InfrastructureReport {
  const { today, settings } = input;
  const categories = new Map(input.categories.map((c) => [c.id, c]));
  const vendors = new Map(input.vendors.map((v) => [v.id, v.name]));
  const clients = new Map(input.clients.map((c) => [c.id, c.name]));

  const rows: InfraSubscriptionRow[] = [];
  for (const sub of input.subscriptions) {
    const category = categories.get(sub.categoryId);
    if (!isInfrastructureCost(sub.allocation, category)) continue;
    const running = isRunning(sub, today);
    const costPerCharge = chargeCostCents(sub);
    const chargeTotalCents = subscriptionAmounts(sub).totalCents;
    const nextOn = running ? nextRenewalOn(sub, today) : null;
    const watched = isRenewalWatched({ interval: sub.interval, chargeTotalCents, expenseGroup: category?.expenseGroup ?? "operating" }, settings);
    rows.push({
      id: sub.id,
      description: sub.description.trim(),
      vendorId: sub.vendorId,
      vendorName: sub.vendorId ? (vendors.get(sub.vendorId) ?? null) : null,
      categoryId: sub.categoryId,
      categoryName: category?.name ?? null,
      interval: sub.interval,
      allocation: sub.allocation,
      clientName: sub.allocation === "client" && sub.clientId ? (clients.get(sub.clientId) ?? null) : null,
      isActive: sub.isActive,
      running,
      chargeTotalCents,
      chargeCostCents: costPerCharge,
      monthlyCents: running ? monthlyEquivalentCents(sub.interval, costPerCharge) : 0,
      yearlyCents: running ? yearlyCostCents(sub.interval, costPerCharge) : 0,
      nextRenewalOn: nextOn,
      daysLeft: nextOn === null ? null : daysUntil(nextOn, today),
      firstCharge: nextOn !== null && nextOn === sub.startsOn,
      watched,
      dueSoon: watched && isWithinWarning(nextOn, today, settings.warningDays),
    });
  }
  rows.sort(
    (a, b) =>
      Number(b.running) - Number(a.running) ||
      (a.nextRenewalOn === null ? 1 : 0) - (b.nextRenewalOn === null ? 1 : 0) ||
      (a.nextRenewalOn && b.nextRenewalOn ? compareCivil(a.nextRenewalOn, b.nextRenewalOn) : 0) ||
      b.monthlyCents - a.monthlyCents ||
      a.description.localeCompare(b.description, "es"),
  );

  const running = rows.filter((r) => r.running);
  const spent = input.expenses.filter((e) => isInfrastructureCost(e.allocation, categories.get(e.categoryId)));

  // Coste por web alojada: lo mensual de las suscripciones en marcha repartidas entre las webs.
  const hostedMonthly = running.filter((r) => r.allocation === "hosted_sites").reduce((sum, r) => assertCents(sum + r.monthlyCents), 0);
  const split = splitHosting(hostedMonthly, input.sites);
  const groups = new Map<string, HostedClientGroup>();
  for (const site of input.sites) {
    if (!split.bySite.has(site.id)) continue;
    const key = site.clientId ?? "";
    const group = groups.get(key) ?? { clientId: site.clientId, name: site.clientId ? (clients.get(site.clientId) ?? null) : null, sites: [], monthlyCents: 0 };
    if (group.sites.some((s) => s.id === site.id)) continue;
    const share = split.bySite.get(site.id)!;
    group.sites.push({ id: site.id, name: site.name, monthlyCents: share });
    group.monthlyCents = assertCents(group.monthlyCents + share);
    groups.set(key, group);
  }
  for (const group of groups.values()) group.sites.sort((a, b) => a.name.localeCompare(b.name, "es") || (a.id < b.id ? -1 : 1));
  const hostedGroups = [...groups.values()].sort(
    (a, b) =>
      Number(a.clientId === null) - Number(b.clientId === null) ||
      b.monthlyCents - a.monthlyCents ||
      b.sites.length - a.sites.length ||
      (a.name ?? "").localeCompare(b.name ?? "", "es"),
  );

  return {
    subscriptions: rows,
    totals: {
      monthlyCents: running.reduce((sum, r) => assertCents(sum + r.monthlyCents), 0),
      yearlyCents: running.reduce((sum, r) => assertCents(sum + r.yearlyCents), 0),
      running: running.length,
    },
    byVendor: breakdown(running, (r) => ({ id: r.vendorId, name: r.vendorName })),
    byCategory: breakdown(running, (r) => ({ id: r.categoryId, name: r.categoryName })),
    spent12m: { cents: spent.reduce((sum, e) => assertCents(sum + assertCents(e.costCents)), 0), count: spent.length },
    hosting: {
      monthlyCents: hostedMonthly,
      sites: split.sites,
      perSiteCents: split.sites === 0 ? null : Number(divRoundHalfAwayFromZero(BigInt(hostedMonthly), BigInt(split.sites))),
      groups: hostedGroups,
    },
    dueSoon: running.filter((r) => r.dueSoon).length,
    empty: rows.length === 0 && spent.length === 0,
  };
}
