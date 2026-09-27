// Propuesta de reparto del cierre mensual (CONSEJO.md §4 y §8): impuestos → colchón →
// reinversión → socios. Pura y exacta al céntimo: los cuatro importes suman siempre lo disponible.
//
// Definiciones:
// - Disponible: el beneficio del mes antes del Impuesto de Sociedades (ingresos − gastos, base sin
//   IVA). Un mes con pérdidas no reparte nada.
// - Impuestos: la provisión del Impuesto de Sociedades de la política sobre lo disponible.
// - Colchón, medido con la caja: la caja libre es la caja al cierre menos lo ya comprometido (IVA a
//   ingresar, impuestos pendientes), menos los impuestos del mes y menos el colchón objetivo
//   (meses de gastos fijos). De lo que queda tras impuestos solo sale de la empresa lo que la caja
//   libre cubre; el resto se queda como colchón. Así nunca se propone repartir dinero que no está
//   en el banco o que rompería el colchón.
// - Reinversión y socios: lo que sale se reparte con los porcentajes de la política. El redondeo
//   va a la reinversión y los socios se llevan la diferencia exacta; entre socios, por sus
//   participaciones (mayor resto, para cuadrar al céntimo).

import { applyBps, assertCents, type Cents } from "@/domain/money";
import type { FinancialPolicy } from "./schema";

export type Shareholding = { name: string; memberId: string | null; shareBps: number };

export type DistributionInput = {
  /** Beneficio del mes antes del Impuesto de Sociedades (base sin IVA). */
  profitCents: Cents;
  /** Caja al cierre del mes. */
  cashCents: Cents;
  /** Caja ya comprometida: IVA a ingresar e impuestos pendientes de pago. */
  reservedCents: Cents;
  /** Gastos fijos de un mes (lo que tiene que cubrir el colchón). */
  monthlyFixedCostsCents: Cents;
  shareholdings: readonly Shareholding[];
  policy: FinancialPolicy;
};

export const DISTRIBUTION_BUCKETS = ["taxes", "cushion", "reinvestment", "partners"] as const;
export type DistributionBucket = (typeof DISTRIBUTION_BUCKETS)[number];

export type Distribution = {
  availableCents: Cents;
  buckets: Record<DistributionBucket, Cents>;
  cushionTargetCents: Cents;
  /** Caja libre (puede ser negativa): la caja que sobra por encima de lo comprometido, los impuestos y el colchón. */
  freeCashCents: Cents;
  /** La caja libre no cubre lo que quedaba tras impuestos: parte se queda como colchón. */
  cashLimited: boolean;
  /** Mes sin beneficio. */
  loss: boolean;
  /** Reparto del importe de los socios por participaciones (vacío si no hay participaciones). */
  partners: (Shareholding & { cents: Cents })[];
};

/** Reparte `total` según los pesos en puntos básicos, cuadrando al céntimo por el mayor resto. */
export function splitByShares<T extends { shareBps: number }>(total: Cents, holders: readonly T[]): (T & { cents: Cents })[] {
  assertCents(total);
  const weights = holders.map((h) => Math.max(0, h.shareBps));
  const sum = weights.reduce((a, b) => a + b, 0);
  if (holders.length === 0 || sum === 0) return [];
  const exact = weights.map((w) => (BigInt(total) * BigInt(w)) / BigInt(sum));
  const remainders = weights.map((w, i) => BigInt(total) * BigInt(w) - exact[i]! * BigInt(sum));
  let left = BigInt(total) - exact.reduce((a, b) => a + b, BigInt(0));
  const order = remainders.map((r, i) => ({ r, i })).sort((a, b) => (b.r > a.r ? 1 : b.r < a.r ? -1 : a.i - b.i));
  const cents = exact.map((e) => e);
  for (const { i } of order) {
    if (left <= BigInt(0)) break;
    cents[i] = cents[i]! + BigInt(1);
    left -= BigInt(1);
  }
  return holders.map((h, i) => ({ ...h, cents: Number(cents[i]) }));
}

export function proposeDistribution(input: DistributionInput): Distribution {
  const { policy } = input;
  const profit = assertCents(input.profitCents);
  const available = Math.max(0, profit);
  const taxes = applyBps(available, policy.corporate_tax_provision_bps);
  const afterTax = available - taxes;
  const cushionTarget = assertCents(input.monthlyFixedCostsCents) * policy.cushion_months;
  const freeCash = assertCents(input.cashCents) - assertCents(input.reservedCents) - taxes - cushionTarget;
  const outgoing = Math.min(afterTax, Math.max(0, freeCash));
  const cushion = afterTax - outgoing;
  const reinvestment = applyBps(outgoing, policy.distribution.reinvestment_bps);
  const partners = outgoing - reinvestment;
  return {
    availableCents: available,
    buckets: { taxes, cushion, reinvestment, partners },
    cushionTargetCents: cushionTarget,
    freeCashCents: freeCash,
    cashLimited: outgoing < afterTax,
    loss: profit <= 0,
    partners: splitByShares(partners, input.shareholdings),
  };
}
