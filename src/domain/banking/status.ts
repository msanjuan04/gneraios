// Estado de conciliación de un movimiento (gemela de bank_transactions_overview.status). Nunca se
// guarda: sale de lo enlazado y de si está ignorado.

import { assertCents, type Cents } from "../money";

/** Mismos valores que el enum `bank_reconciliation_status`. */
export const RECONCILIATION_STATUSES = ["unmatched", "partial", "reconciled", "ignored"] as const;
export type ReconciliationStatus = (typeof RECONCILIATION_STATUSES)[number];

/** Los que esperan a que un socio decida algo. */
export const PENDING_STATUSES: readonly ReconciliationStatus[] = ["unmatched", "partial"];

/**
 * Ignorado si tiene motivo; sin conciliar si no hay nada enlazado; parcial si lo enlazado no llega
 * al importe; conciliado si lo cubre (nunca lo supera: la base de datos lo impide).
 */
export function reconciliationStatus(tx: { amountCents: Cents; matchedCents: Cents; ignored: boolean }): ReconciliationStatus {
  if (tx.ignored) return "ignored";
  const matched = assertCents(tx.matchedCents);
  if (matched === 0) return "unmatched";
  return matched < Math.abs(assertCents(tx.amountCents)) ? "partial" : "reconciled";
}

/** Lo que falta por explicar de un movimiento, en valor absoluto. */
export function remainingCents(tx: { amountCents: Cents; matchedCents: Cents }): Cents {
  return Math.max(0, Math.abs(assertCents(tx.amountCents)) - assertCents(tx.matchedCents));
}

export function isPending(status: ReconciliationStatus): boolean {
  return PENDING_STATUSES.includes(status);
}
