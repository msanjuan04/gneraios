// Sin "server-only": lo llamarán las herramientas del agente CFO (get_cash_position,
// get_cash_forecast, get_runway, get_tax_provisions…) y lo usa la pantalla /finance.
//
//     const snapshot = await getFinanceSnapshot(db, orgId, today);
//
// `db` es el cliente de un miembro (RLS) o el de servidor; `today`, el día civil de la org. Todo
// el cálculo es de src/domain/finance (buildFinanceSnapshot): aquí solo se carga.

import { addDays, maxCivil, minCivil, type CivilDate } from "@/domain/dates/civil-date";
import {
  addQuarters,
  billingCashEvents,
  buildFinanceSnapshot,
  DEFAULT_FORECAST_DAYS,
  pendingItemEvents,
  quarterEnd,
  quarterOf,
  quarterStart,
  type FinanceSnapshot,
} from "@/domain/finance";
import { monthOf, monthsEndingAt } from "@/domain/metrics/months";
import type { Db } from "@/server/billing/context";
import { loadRevenueRows } from "@/server/metrics/sources";
import {
  loadCashAccounts,
  loadCashBilling,
  loadCashMovements,
  loadExpenseMonths,
  loadFixedCategoryIds,
  loadGeneratedStarts,
  loadOutputVat,
  loadPendingExpenses,
  loadReceivables,
  loadShareholdingsOn,
  loadSubscriptions,
} from "./sources";

export type FinanceSnapshotOptions = {
  /** Días de la previsión de caja (90 por defecto). */
  forecastDays?: number;
  /** Meses del histórico de margen, terminando en el mes en curso (12 por defecto). */
  months?: number;
};

export async function getFinanceSnapshot(
  db: Db,
  orgId: string,
  today: CivilDate,
  opts: FinanceSnapshotOptions = {},
): Promise<FinanceSnapshot> {
  const forecastDays = opts.forecastDays ?? DEFAULT_FORECAST_DAYS;
  const months = monthsEndingAt(monthOf(today), Math.max(1, opts.months ?? 12));
  const first = months[0]!;
  const current = months.at(-1)!;
  // El IVA se estima por trimestres: hace falta desde el anterior (puede estar aún por pagar).
  const taxFrom = minCivil(first, quarterStart(addQuarters(quarterOf(today), -1)));
  const until = addDays(today, forecastDays);
  const billingUntil = maxCivil(until, quarterEnd(quarterOf(today)));

  const [revenueRows, expenses, outputVat, accounts, subscriptions, generatedStarts, fixedCategoryIds, pendingExpenses, receivables, billing, shareholdings] =
    await Promise.all([
      loadRevenueRows(db, orgId, first, current),
      loadExpenseMonths(db, orgId, taxFrom, current),
      loadOutputVat(db, orgId, taxFrom, current),
      loadCashAccounts(db, orgId),
      loadSubscriptions(db, orgId),
      loadGeneratedStarts(db, orgId),
      loadFixedCategoryIds(db, orgId),
      loadPendingExpenses(db, orgId),
      loadReceivables(db, orgId),
      loadCashBilling(db, orgId),
      loadShareholdingsOn(db, orgId, today),
    ]);

  // Los movimientos desde el saldo más antiguo: el dominio aplica a cada emisor los suyos.
  const oldest = accounts
    .filter((a) => a.isActive && a.balanceOn)
    .reduce<CivilDate | null>((min, a) => (min === null ? a.balanceOn : minCivil(min, a.balanceOn!)), null);
  const movements = oldest ? await loadCashMovements(db, orgId, oldest, today) : [];

  const events = [
    ...billingCashEvents(billing.contracts, billing.issuerIrpfBps, today, billingUntil),
    ...pendingItemEvents(billing.pendingItems, billing.contracts, billing.issuerIrpfBps, today),
  ];

  return buildFinanceSnapshot({
    today,
    months,
    revenueRows,
    expenseRows: expenses.costs.filter((row) => row.month >= first),
    outputVat,
    inputVat: expenses.inputVat,
    withholdings: expenses.withholdings,
    accounts: accounts.map(({ accountId, issuerId, isActive, balanceOn, balanceCents, name }) => ({
      accountId,
      issuerId,
      isActive,
      balanceOn,
      balanceCents,
      name,
    })),
    movements,
    subscriptions,
    generatedStarts,
    fixedCategoryIds,
    pendingExpenses,
    receivables,
    billing: events,
    shareholdings,
    forecastDays,
    contractLabels: billing.contractLabels,
  });
}
