import type { CatalogBillingType } from "./types";

/**
 * Tipo de precio y periodicidad. Se derivan del tipo de facturación (`billing_type`), que es lo
 * único que se guarda: una recurrente es mensual o anual; una puntual o una de uso no tienen ciclo.
 */
export type PricingKind = "one_off" | "recurring" | "usage";
export type BillingInterval = "monthly" | "yearly";

export const PRICING_KINDS = ["one_off", "recurring", "usage"] as const satisfies readonly PricingKind[];
export const BILLING_INTERVALS = ["monthly", "yearly"] as const satisfies readonly BillingInterval[];

export function pricingKind(type: CatalogBillingType): PricingKind {
  return type === "monthly" || type === "yearly" ? "recurring" : type;
}

/** Cada cuánto se cobra una recurrente; null si no lo es. */
export function billingInterval(type: CatalogBillingType): BillingInterval | null {
  return type === "monthly" || type === "yearly" ? type : null;
}

/** Tipo de facturación de un precio: la periodicidad solo cuenta en las recurrentes. */
export function billingTypeOf(kind: PricingKind, interval: BillingInterval): CatalogBillingType {
  return kind === "recurring" ? interval : kind;
}
