// Sin "server-only": lo pueden leer el dashboard (con la sesión del usuario) y el agente CFO del
// Consejo (con el cliente del servidor), siempre filtrando por org. Solo lectura y todo derivado.
//
//   loadBankingQueueCount(db, orgId)          → movimientos que esperan a un socio (tarjeta «Por hacer»)
//   loadBankingDigest(db, orgId, today)       → lo pendiente por antigüedad y por cuenta, el último
//                                                extracto de cada cuenta y su descuadre (agente CFO)

import { AGE_BUCKETS, type AgeBucket, bankingDigest, type PendingTotals } from "@/domain/banking/digest";
import { PENDING_STATUSES } from "@/domain/banking/status";
import type { CivilDate } from "@/domain/dates/civil-date";
import { type Db, DbError, fetchAll, must } from "@/server/billing/context";

/** Movimientos del banco sin conciliar o conciliados en parte, de las cuentas activas. */
export async function loadBankingQueueCount(db: Db, orgId: string): Promise<number> {
  const { count, error } = await db
    .from("bank_transactions_overview")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("account_is_active", true)
    .in("status", [...PENDING_STATUSES]);
  if (error) throw new DbError(error, "banking.queueCount");
  return count ?? 0;
}

export type BankingAccountDigest = {
  accountId: string;
  name: string;
  issuerName: string;
  /** Último saldo de caja de la cuenta (el del último extracto o el apuntado a mano). */
  balanceCents: number | null;
  balanceOn: CivilDate | null;
  /** Hasta qué día llega el último extracto importado (null: nunca se ha importado ninguno). */
  lastStatementEnd: CivilDate | null;
  /** Saldo final − inicial − movimientos del último extracto (0 = cuadra; null = sin saldos). */
  lastStatementGapCents: number | null;
  pending: PendingTotals;
};

export type BankingCfoDigest = {
  today: CivilDate;
  /** Todo lo pendiente de la org (entradas y salidas sin explicar y su efecto neto en caja). */
  pending: PendingTotals;
  byAge: { bucket: AgeBucket; totals: PendingTotals }[];
  oldestPendingOn: CivilDate | null;
  accounts: BankingAccountDigest[];
};

/**
 * Lo que puede leer el agente CFO: cuánto dinero ha entrado o salido del banco sin explicación en
 * GNERAI OS, desde cuándo (0-7, 8-30, 31-90 y más de 90 días), por cuenta, y si los extractos
 * están al día y cuadran.
 */
export async function loadBankingDigest(db: Db, orgId: string, today: CivilDate): Promise<BankingCfoDigest> {
  const [pending, accounts, statements] = await Promise.all([
    fetchAll(
      (a, b) =>
        db
          .from("bank_transactions_overview")
          .select("account_id, booked_on, amount_cents, remaining_cents, status")
          .eq("org_id", orgId)
          .eq("account_is_active", true)
          .in("status", [...PENDING_STATUSES])
          .order("id")
          .range(a, b),
      "banking.digest.pending",
    ),
    db.from("cash_position").select("account_id, name, issuer_name, is_active, balance_cents, balance_on").eq("org_id", orgId),
    db.from("bank_statements_overview").select("account_id, period_end, balance_gap_cents, imported_at").eq("org_id", orgId).order("period_end", { ascending: false }),
  ]);
  const movements = pending.flatMap((r) =>
    r.account_id && r.booked_on && r.amount_cents !== null && r.status
      ? [{ accountId: r.account_id, bookedOn: r.booked_on, amountCents: r.amount_cents, remainingCents: r.remaining_cents ?? 0, status: r.status }]
      : [],
  );
  const all = bankingDigest(movements, today);
  const lastStatement = new Map<string, { end: CivilDate; gap: number | null }>();
  for (const s of must(statements, "banking.digest.statements")) {
    if (s.account_id && s.period_end && !lastStatement.has(s.account_id)) lastStatement.set(s.account_id, { end: s.period_end, gap: s.balance_gap_cents });
  }
  return {
    today,
    pending: all.pending,
    byAge: all.byAge,
    oldestPendingOn: all.oldestPendingOn,
    accounts: must(accounts, "banking.digest.accounts").flatMap((a) =>
      a.account_id && a.is_active
        ? [
            {
              accountId: a.account_id,
              name: a.name ?? "",
              issuerName: a.issuer_name ?? "",
              balanceCents: a.balance_cents,
              balanceOn: a.balance_on,
              lastStatementEnd: lastStatement.get(a.account_id)?.end ?? null,
              lastStatementGapCents: lastStatement.get(a.account_id)?.gap ?? null,
              pending: bankingDigest(
                movements.filter((m) => m.accountId === a.account_id),
                today,
              ).pending,
            },
          ]
        : [],
    ),
  };
}

export { AGE_BUCKETS };
