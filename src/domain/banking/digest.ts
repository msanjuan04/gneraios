// Cifras del banco (derivadas de los movimientos, nunca guardadas): lo que falta por conciliar y
// desde cuándo, lo conciliado del mes y lo que el banco ha movido sin explicación en GNERAI OS. Las
// usan la pestaña Banco, la tarjeta «Por hacer» del dashboard y el agente CFO del Consejo.

import { daysBetween, type CivilDate } from "../dates/civil-date";
import { assertCents, type Cents } from "../money";
import { isPending, type ReconciliationStatus } from "./status";

export type DigestMovement = {
  bookedOn: CivilDate;
  /** Con signo. */
  amountCents: Cents;
  /** Lo que falta por explicar, en valor absoluto. */
  remainingCents: Cents;
  status: ReconciliationStatus;
};

export const AGE_BUCKETS = ["0-7", "8-30", "31-90", "90+"] as const;
export type AgeBucket = (typeof AGE_BUCKETS)[number];

export function ageBucket(bookedOn: CivilDate, today: CivilDate): AgeBucket {
  const days = daysBetween(bookedOn, today);
  if (days <= 7) return "0-7";
  if (days <= 30) return "8-30";
  if (days <= 90) return "31-90";
  return "90+";
}

export type PendingTotals = {
  count: number;
  /** Lo que ha entrado y falta por explicar (positivo). */
  creditsCents: Cents;
  /** Lo que ha salido y falta por explicar (positivo). */
  debitsCents: Cents;
  /** Efecto neto en el saldo de lo que falta por explicar (entradas − salidas). */
  netCents: Cents;
};

function emptyTotals(): PendingTotals {
  return { count: 0, creditsCents: 0, debitsCents: 0, netCents: 0 };
}

function addPending(totals: PendingTotals, m: DigestMovement) {
  totals.count += 1;
  if (m.amountCents > 0) {
    totals.creditsCents = assertCents(totals.creditsCents + m.remainingCents);
    totals.netCents = assertCents(totals.netCents + m.remainingCents);
  } else {
    totals.debitsCents = assertCents(totals.debitsCents + m.remainingCents);
    totals.netCents = assertCents(totals.netCents - m.remainingCents);
  }
}

export type BankingDigest = {
  pending: PendingTotals;
  byAge: { bucket: AgeBucket; totals: PendingTotals }[];
  oldestPendingOn: CivilDate | null;
};

/** Lo pendiente (sin conciliar o parcial) por antigüedad del movimiento. */
export function bankingDigest(movements: readonly DigestMovement[], today: CivilDate): BankingDigest {
  const pending = emptyTotals();
  const buckets = new Map<AgeBucket, PendingTotals>(AGE_BUCKETS.map((b) => [b, emptyTotals()]));
  let oldest: CivilDate | null = null;
  for (const m of movements) {
    if (!isPending(m.status) || m.remainingCents <= 0) continue;
    addPending(pending, m);
    addPending(buckets.get(ageBucket(m.bookedOn, today))!, m);
    if (!oldest || m.bookedOn < oldest) oldest = m.bookedOn;
  }
  return { pending, byAge: AGE_BUCKETS.map((bucket) => ({ bucket, totals: buckets.get(bucket)! })), oldestPendingOn: oldest };
}

export type MonthProgress = {
  /** Movimientos del mes (por fecha de operación). */
  total: number;
  /** Conciliados o ignorados con motivo: explicados. */
  explained: number;
  reconciled: number;
  ignored: number;
};

/** Cuántos movimientos del mes (YYYY-MM) están explicados. */
export function monthProgress(movements: readonly DigestMovement[], month: string): MonthProgress {
  const progress: MonthProgress = { total: 0, explained: 0, reconciled: 0, ignored: 0 };
  for (const m of movements) {
    if (!m.bookedOn.startsWith(month)) continue;
    progress.total += 1;
    if (m.status === "reconciled") progress.reconciled += 1;
    if (m.status === "ignored") progress.ignored += 1;
  }
  progress.explained = progress.reconciled + progress.ignored;
  return progress;
}
