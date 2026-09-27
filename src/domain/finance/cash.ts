// Caja de hoy a partir de los saldos con fecha (manuales o importados) y de lo que se ha cobrado y
// pagado después.
//
// - Saldo registrado: la suma del último saldo de cada cuenta activa (la vista `cash_position`).
//   Un saldo es el del cierre de su día: lo que se mueve ese día ya está dentro.
// - Caja estimada hoy = saldo registrado + cobros − pagos posteriores al saldo, emisor por emisor
//   (los cobros de sus facturas y los gastos que paga). Con varias cuentas de un emisor manda la
//   fecha del saldo más reciente. Los movimientos de emisores sin cuenta no se suman: de ellos no
//   se sabe la caja.

import { compareCivil, maxCivil, minCivil, type CivilDate } from "../dates/civil-date";
import { assertCents, type Cents } from "../money";

export type CashAccountBalance = {
  accountId: string;
  issuerId: string;
  isActive: boolean;
  /** Último saldo apuntado (null si la cuenta aún no tiene ninguno). */
  balanceOn: CivilDate | null;
  balanceCents: Cents | null;
};

/** Un cobro (positivo) o un pago (negativo) con su fecha y el emisor al que pertenece. */
export type CashMovement = { issuerId: string; on: CivilDate; cents: Cents };

export type CashIssuerToday = {
  issuerId: string;
  recordedCents: Cents;
  /** Fecha del saldo del que se parte (el más reciente de sus cuentas activas). */
  asOf: CivilDate | null;
  movementsCents: Cents;
  estimatedCents: Cents;
};

export type CashToday = {
  recordedCents: Cents;
  /** El saldo más antiguo y el más reciente de las cuentas activas: cuánto de vieja es la foto. */
  oldestOn: CivilDate | null;
  latestOn: CivilDate | null;
  movementsCents: Cents;
  estimatedCents: Cents;
  issuers: CashIssuerToday[];
  activeAccounts: number;
  /** Cuentas activas sin ningún saldo apuntado. */
  accountsWithoutBalance: number;
};

export function estimateCashToday(
  accounts: readonly CashAccountBalance[],
  movements: readonly CashMovement[],
  today: CivilDate,
): CashToday {
  const active = accounts.filter((a) => a.isActive);
  const byIssuer = new Map<string, { recorded: Cents; asOf: CivilDate | null }>();
  let oldestOn: CivilDate | null = null;
  let latestOn: CivilDate | null = null;
  for (const account of active) {
    const entry = byIssuer.get(account.issuerId) ?? { recorded: 0, asOf: null };
    if (account.balanceOn !== null && account.balanceCents !== null) {
      entry.recorded = assertCents(entry.recorded + assertCents(account.balanceCents));
      entry.asOf = entry.asOf === null ? account.balanceOn : maxCivil(entry.asOf, account.balanceOn);
      oldestOn = oldestOn === null ? account.balanceOn : minCivil(oldestOn, account.balanceOn);
      latestOn = latestOn === null ? account.balanceOn : maxCivil(latestOn, account.balanceOn);
    }
    byIssuer.set(account.issuerId, entry);
  }

  const issuers = [...byIssuer.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([issuerId, entry]): CashIssuerToday => {
      const movementsCents =
        entry.asOf === null
          ? 0
          : movements
              .filter((m) => m.issuerId === issuerId && compareCivil(m.on, entry.asOf!) > 0 && compareCivil(m.on, today) <= 0)
              .reduce((sum, m) => assertCents(sum + assertCents(m.cents)), 0);
      return {
        issuerId,
        recordedCents: entry.recorded,
        asOf: entry.asOf,
        movementsCents,
        estimatedCents: assertCents(entry.recorded + movementsCents),
      };
    });

  const recordedCents = issuers.reduce((sum, i) => assertCents(sum + i.recordedCents), 0);
  const movementsCents = issuers.reduce((sum, i) => assertCents(sum + i.movementsCents), 0);
  return {
    recordedCents,
    oldestOn,
    latestOn,
    movementsCents,
    estimatedCents: assertCents(recordedCents + movementsCents),
    issuers,
    activeAccounts: active.length,
    accountsWithoutBalance: active.filter((a) => a.balanceOn === null).length,
  };
}
