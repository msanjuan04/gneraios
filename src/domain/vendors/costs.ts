// Lo que nos cuesta un proveedor y para quién: la empresa, cada cliente o las webs que alojamos.
// Nada se guarda: las cifras de cada destino salen de sus gastos (la vista
// vendor_costs_by_allocation) y aquí se agrupan, se reparten en porcentajes y se ordenan.
//
// Coste = base + IVA no deducible, la misma regla que el resto de Finanzas (expenseCostCents).

import type { CivilDate } from "../dates/civil-date";
import { COST_ALLOCATIONS, type CostAllocation } from "../finance/allocation";
import { assertCents, type Bps, type Cents } from "../money";

/** Lo gastado con un proveedor para un destino (una fila de vendor_costs_by_allocation). */
export type AllocationCostRow = {
  allocation: CostAllocation;
  /** Solo con allocation = 'client'. */
  clientId: string | null;
  clientName: string | null;
  expensesCount: number;
  costCents: Cents;
  /** Lo del año natural en curso (en la zona de la org). */
  yearExpensesCount: number;
  yearCostCents: Cents;
  /** El total (base + IVA − IRPF) de lo que aún no se ha pagado. */
  pendingCents: Cents;
  lastExpenseOn: CivilDate | null;
};

/** Qué cifras se miran: las del año en curso o las de siempre. */
export const COST_PERIODS = ["year", "total"] as const;
export type CostPeriod = (typeof COST_PERIODS)[number];

export type AllocationBucket = {
  /** "company", "hosted_sites" o "client:<id>". */
  key: string;
  allocation: CostAllocation;
  clientId: string | null;
  clientName: string | null;
  /** Gastos y coste del periodo. */
  count: number;
  amountCents: Cents;
  /** Parte del coste positivo del periodo (puntos básicos): las de todos suman 10.000. */
  shareBps: Bps;
  pendingCents: Cents;
  lastExpenseOn: CivilDate | null;
};

export type AllocationSummary = {
  period: CostPeriod;
  /** Los destinos con algún gasto en el periodo, del que más cuesta al que menos. */
  buckets: AllocationBucket[];
  count: number;
  amountCents: Cents;
  pendingCents: Cents;
  /** Clientes distintos con algún gasto en el periodo. */
  clientsCount: number;
  /** Parte del coste que es de clientes concretos (puntos básicos). */
  clientShareBps: Bps;
};

const BPS_TOTAL = 10_000;
const KIND_ORDER: Record<CostAllocation, number> = Object.fromEntries(COST_ALLOCATIONS.map((a, i) => [a, i])) as Record<CostAllocation, number>;

/** La clave de un destino: la empresa, las webs alojadas o un cliente concreto. */
export function allocationKey(allocation: CostAllocation, clientId: string | null): string {
  if (allocation !== "client") {
    if (clientId !== null) throw new Error(`Un gasto de «${allocation}» no lleva cliente.`);
    return allocation;
  }
  if (!clientId) throw new Error("Un gasto de un cliente necesita el cliente.");
  return `client:${clientId}`;
}

/**
 * Reparte 10.000 puntos básicos en proporción a los importes positivos (lo negativo, un abono que
 * supera lo gastado, cuenta como 0) por el método del mayor resto: la suma es exactamente 10.000
 * (o 0 si no hay nada positivo) y los empates se resuelven a favor del primero.
 */
export function sharesBps(amounts: readonly Cents[]): Bps[] {
  const positive = amounts.map((amount) => BigInt(Math.max(0, assertCents(amount))));
  const total = positive.reduce((sum, amount) => sum + amount, BigInt(0));
  if (total === BigInt(0)) return amounts.map(() => 0);
  const scaled = positive.map((amount) => amount * BigInt(BPS_TOTAL));
  const shares = scaled.map((value) => Number(value / total));
  let left = BPS_TOTAL - shares.reduce((sum, share) => sum + share, 0);
  const byRemainder = scaled
    .map((value, index) => ({ index, remainder: value % total }))
    .sort((a, b) => (a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1));
  for (const { index } of byRemainder) {
    if (left === 0) break;
    shares[index] = shares[index]! + 1;
    left -= 1;
  }
  return shares;
}

const laterDate = (a: CivilDate | null, b: CivilDate | null) => (a === null ? b : b === null ? a : a > b ? a : b);

/**
 * El «¿Para quién?» de un proveedor en un periodo: un destino por clave (si llegan dos filas del
 * mismo, se suman), los que no tienen gastos en el periodo fuera, su parte del coste y el orden
 * (del que más cuesta al que menos; a igualdad, la empresa, los clientes por nombre y las webs).
 */
export function summarizeAllocations(rows: readonly AllocationCostRow[], period: CostPeriod = "total"): AllocationSummary {
  const merged = new Map<string, Omit<AllocationBucket, "shareBps">>();
  for (const row of rows) {
    const key = allocationKey(row.allocation, row.clientId);
    const count = period === "year" ? row.yearExpensesCount : row.expensesCount;
    const amount = assertCents(period === "year" ? row.yearCostCents : row.costCents);
    const current = merged.get(key);
    if (current) {
      current.count += count;
      current.amountCents += amount;
      current.pendingCents += assertCents(row.pendingCents);
      current.lastExpenseOn = laterDate(current.lastExpenseOn, row.lastExpenseOn);
      current.clientName ??= row.clientName;
    } else {
      merged.set(key, {
        key,
        allocation: row.allocation,
        clientId: row.allocation === "client" ? row.clientId : null,
        clientName: row.allocation === "client" ? row.clientName : null,
        count,
        amountCents: amount,
        pendingCents: assertCents(row.pendingCents),
        lastExpenseOn: row.lastExpenseOn,
      });
    }
  }

  const sorted = [...merged.values()]
    .filter((bucket) => bucket.count > 0)
    .sort(
      (a, b) =>
        b.amountCents - a.amountCents ||
        KIND_ORDER[a.allocation] - KIND_ORDER[b.allocation] ||
        (a.clientName ?? "").localeCompare(b.clientName ?? "", "es") ||
        a.key.localeCompare(b.key),
    );
  const shares = sharesBps(sorted.map((bucket) => bucket.amountCents));
  const buckets = sorted.map((bucket, index) => ({ ...bucket, shareBps: shares[index]! }));
  const clients = buckets.filter((bucket) => bucket.allocation === "client");

  return {
    period,
    buckets,
    count: buckets.reduce((sum, bucket) => sum + bucket.count, 0),
    amountCents: buckets.reduce((sum, bucket) => sum + bucket.amountCents, 0),
    // Lo pendiente no depende del periodo: es lo que se le debe hoy.
    pendingCents: [...merged.values()].reduce((sum, bucket) => sum + bucket.pendingCents, 0),
    clientsCount: clients.length,
    clientShareBps: clients.reduce((sum, bucket) => sum + bucket.shareBps, 0),
  };
}

/** Los `limit` clientes que más cuestan del resumen y lo que suman los demás. */
export function topClientBuckets(
  summary: AllocationSummary,
  limit: number,
): { top: AllocationBucket[]; rest: { clients: number; amountCents: Cents; shareBps: Bps } } {
  const clients = summary.buckets.filter((bucket) => bucket.allocation === "client");
  const top = clients.slice(0, Math.max(0, limit));
  const others = clients.slice(top.length);
  return {
    top,
    rest: {
      clients: others.length,
      amountCents: others.reduce((sum, bucket) => sum + bucket.amountCents, 0),
      shareBps: others.reduce((sum, bucket) => sum + bucket.shareBps, 0),
    },
  };
}

/** Lo que ha costado un proveedor para un cliente (la tarjeta de la ficha del cliente). */
export type ClientVendorCostInput = {
  vendorId: string;
  name: string;
  expensesCount: number;
  costCents: Cents;
  yearCostCents: Cents;
  lastExpenseOn: CivilDate | null;
};

/**
 * Los proveedores que han trabajado para un cliente (un proveedor por fila; si llega repetido, se
 * suma), del que más ha costado este año al que menos, y luego por lo de siempre y por nombre. Con
 * los totales.
 */
export function clientVendorCosts<T extends ClientVendorCostInput>(
  rows: readonly T[],
): { vendors: T[]; totals: { expensesCount: number; costCents: Cents; yearCostCents: Cents } } {
  const byVendor = new Map<string, T>();
  for (const row of rows) {
    const current = byVendor.get(row.vendorId);
    byVendor.set(
      row.vendorId,
      current
        ? {
            ...current,
            expensesCount: current.expensesCount + row.expensesCount,
            costCents: current.costCents + assertCents(row.costCents),
            yearCostCents: current.yearCostCents + assertCents(row.yearCostCents),
            lastExpenseOn: laterDate(current.lastExpenseOn, row.lastExpenseOn),
          }
        : row,
    );
  }
  const vendors = [...byVendor.values()].sort(
    (a, b) => b.yearCostCents - a.yearCostCents || b.costCents - a.costCents || a.name.localeCompare(b.name, "es"),
  );
  return {
    vendors,
    totals: {
      expensesCount: vendors.reduce((sum, v) => sum + v.expensesCount, 0),
      costCents: vendors.reduce((sum, v) => sum + v.costCents, 0),
      yearCostCents: vendors.reduce((sum, v) => sum + v.yearCostCents, 0),
    },
  };
}
