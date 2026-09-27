// Foto financiera de una org en un día (definición v1): caja, margen por mes, burn, costes fijos,
// runway, IVA y retenciones estimados y previsión de caja. Es lo que pinta /finance y lo que
// leerán las herramientas del agente CFO: una sola implementación, pura. El servidor
// (src/server/finance/snapshot.ts) carga los datos y llama aquí.

import { addDays, compareCivil, maxCivil, type CivilDate } from "../dates/civil-date";
import type { Month } from "../metrics/months";
import type { RevenueRow } from "../metrics/revenue";
import { assertCents, type Bps, type Cents } from "../money";
import type { BillingCashEvent } from "./billing-cash";
import { estimateCashToday, type CashAccountBalance, type CashMovement, type CashToday } from "./cash";
import { deductibleVatCents } from "./expense";
import { cashForecast, type CashForecast, type FlowInput } from "./forecast";
import { monthlyPnl, type ExpenseMonthRow, type MonthPnl } from "./pnl";
import { burn, FINANCE_DEFINITION_VERSION, fixedCosts, runwayMonths, type Burn, type FixedCosts } from "./runway";
import { subscriptionMonthlyCostCents, upcomingSubscriptionCharges, type ExpenseSubscription } from "./subscriptions";
import {
  estimateVatQuarter,
  estimateWithholdingsQuarter,
  nextDueQuarter,
  quarterKey,
  quarterOf,
  quartersDueBetween,
  type Quarter,
  type TaxAmountRow,
  type VatQuarterEstimate,
  type WithholdingsQuarterEstimate,
} from "./tax";

export const DEFAULT_FORECAST_DAYS = 90;

export type SnapshotAccount = CashAccountBalance & { name: string };

export type SnapshotReceivable = {
  invoiceId: string;
  issuerId: string;
  number: string | null;
  clientName: string;
  dueOn: CivilDate | null;
  /** Con IVA y neto de IRPF: lo que falta por cobrar. */
  outstandingCents: Cents;
};

export type SnapshotPendingExpense = {
  id: string;
  issuerId: string;
  label: string;
  payableOn: CivilDate;
  totalCents: Cents;
};

export type SnapshotShareholding = { memberId: string; percentBps: Bps };

export type FinanceSnapshotInput = {
  today: CivilDate;
  /** Meses del histórico, en orden (el último suele ser el mes en curso). */
  months: Month[];
  revenueRows: RevenueRow[];
  expenseRows: ExpenseMonthRow[];
  /** IVA repercutido de las facturas emitidas, por emisor y mes (invoice_taxes_by_month). */
  outputVat: TaxAmountRow[];
  /** IVA soportado deducible de los gastos, por emisor y mes (expenses_by_month). */
  inputVat: TaxAmountRow[];
  /** Retenciones practicadas en los gastos, por emisor y mes (expenses_by_month). */
  withholdings: TaxAmountRow[];
  accounts: SnapshotAccount[];
  /** Cobros (+) y pagos de gastos (−) con fecha, para llevar el saldo registrado a hoy. */
  movements: CashMovement[];
  subscriptions: ExpenseSubscription[];
  /** Periodos ya generados de cada suscripción. */
  generatedStarts: ReadonlyMap<string, ReadonlySet<CivilDate>>;
  /** Categorías fijas: sus suscripciones son los costes fijos cuando aún no hay historia. */
  fixedCategoryIds: ReadonlySet<string>;
  pendingExpenses: SnapshotPendingExpense[];
  receivables: SnapshotReceivable[];
  /** Lo que se va a facturar (billingCashEvents + pendingItemEvents), con IVA. */
  billing: BillingCashEvent[];
  /** Reparto vigente de la SL (el de la fecha más reciente que no supere hoy). */
  shareholdings: { validFrom: CivilDate | null; rows: SnapshotShareholding[] };
  forecastDays?: number;
  /** Nombre de cada cliente por contrato, para las etiquetas de la previsión. */
  contractLabels?: ReadonlyMap<string, string>;
  /** Etiqueta de cada suscripción. */
  subscriptionLabels?: ReadonlyMap<string, string>;
};

export type TaxQuarterView = {
  quarter: Quarter;
  key: string;
  dueOn: CivilDate;
  /** El trimestre ya ha terminado (solo falta pagarlo). */
  closed: boolean;
  vat: VatQuarterEstimate;
  withholdings: WithholdingsQuarterEstimate;
};

export type FinanceSnapshot = {
  definitionVersion: number;
  today: CivilDate;
  cash: CashToday & { accounts: SnapshotAccount[] };
  months: MonthPnl[];
  burn: Burn | null;
  fixedCosts: FixedCosts;
  /** Meses de costes fijos que cubre la caja estimada de hoy. */
  runwayMonths: number | null;
  taxes: {
    /** Siempre estimaciones: validar con la gestoría. */
    isEstimate: true;
    /** El que toca pagar ahora y los que vencen dentro de la previsión, más el trimestre en curso. */
    quarters: TaxQuarterView[];
  };
  forecast: CashForecast;
  shareholdings: { validFrom: CivilDate | null; rows: SnapshotShareholding[] };
};

function taxQuarters(input: FinanceSnapshotInput, until: CivilDate, rows: { output: TaxAmountRow[]; input: TaxAmountRow[]; withholdings: TaxAmountRow[] }) {
  const quarters = new Map<string, Quarter>();
  for (const q of [nextDueQuarter(input.today), ...quartersDueBetween(input.today, until), quarterOf(input.today)]) {
    quarters.set(quarterKey(q), q);
  }
  return [...quarters.values()]
    .sort((a, b) => a.year - b.year || a.quarter - b.quarter)
    .map((q): TaxQuarterView => {
      const vat = estimateVatQuarter(q, rows.output, rows.input);
      return {
        quarter: q,
        key: quarterKey(q),
        dueOn: vat.dueOn,
        closed: compareCivil(vat.to, input.today) < 0,
        vat,
        withholdings: estimateWithholdingsQuarter(q, rows.withholdings),
      };
    });
}

export function buildFinanceSnapshot(input: FinanceSnapshotInput): FinanceSnapshot {
  const { today } = input;
  const days = input.forecastDays ?? DEFAULT_FORECAST_DAYS;
  const until = addDays(today, days);

  // Caja de hoy y margen por mes.
  const cash = estimateCashToday(input.accounts, input.movements, today);
  const months = monthlyPnl(input.revenueRows, input.expenseRows, input.months);
  const history = burn(months, today);
  const subscriptionsFixed = input.subscriptions
    .filter((s) => input.fixedCategoryIds.has(s.categoryId))
    .reduce((sum, s) => assertCents(sum + subscriptionMonthlyCostCents(s, today)), 0);
  const fixed = fixedCosts(history, subscriptionsFixed);

  // Lo que las suscripciones aún no han generado (hasta el final del horizonte y del trimestre en curso).
  const lastBillable = input.billing.reduce((max, e) => maxCivil(max, e.invoicedOn), until);
  const charges = upcomingSubscriptionCharges(input.subscriptions, input.generatedStarts, lastBillable);
  const subscriptionById = new Map(input.subscriptions.map((s) => [s.id, s]));

  // IVA y retenciones: lo emitido y registrado, más lo previsto (facturación y cargos pendientes).
  const output: TaxAmountRow[] = [
    ...input.outputVat,
    ...input.billing.flatMap((e) =>
      e.issuerId && e.vatCents !== 0 ? [{ issuerId: e.issuerId, on: e.invoicedOn, cents: e.vatCents, forecast: true }] : [],
    ),
  ];
  const deductible: TaxAmountRow[] = [
    ...input.inputVat,
    ...charges.flatMap((c) => {
      const sub = subscriptionById.get(c.subscriptionId)!;
      const vat = deductibleVatCents({ vatCents: c.amounts.vatCents, vatDeductible: sub.vatDeductible });
      return vat !== 0 ? [{ issuerId: sub.issuerId, on: maxCivil(c.chargedOn, today), cents: vat, forecast: true }] : [];
    }),
  ];
  const withheld: TaxAmountRow[] = [
    ...input.withholdings,
    ...charges.flatMap((c) => {
      const sub = subscriptionById.get(c.subscriptionId)!;
      return c.amounts.irpfCents !== 0
        ? [{ issuerId: sub.issuerId, on: maxCivil(c.chargedOn, today), cents: c.amounts.irpfCents, forecast: true }]
        : [];
    }),
  ];
  const quarters = taxQuarters(input, until, { output, input: deductible, withholdings: withheld });

  // Flujos de la previsión.
  const flows: FlowInput[] = [
    ...input.receivables.map(
      (r): FlowInput => ({
        on: r.dueOn ?? today,
        kind: "receivable",
        cents: r.outstandingCents,
        label: r.number ? `${r.number} · ${r.clientName}` : r.clientName,
        refId: r.invoiceId,
        issuerId: r.issuerId,
      }),
    ),
    ...input.billing.map(
      (e): FlowInput => ({
        on: e.collectedOn,
        kind: "billing",
        cents: e.totalCents,
        label: input.contractLabels?.get(e.contractId) ?? "",
        refId: e.contractId,
        issuerId: e.issuerId,
      }),
    ),
    ...input.pendingExpenses.map(
      (x): FlowInput => ({ on: x.payableOn, kind: "expense", cents: -x.totalCents, label: x.label, refId: x.id, issuerId: x.issuerId }),
    ),
    ...charges.map((c): FlowInput => {
      const sub = subscriptionById.get(c.subscriptionId)!;
      return {
        on: c.chargedOn,
        kind: "subscription",
        cents: -c.amounts.totalCents,
        label: input.subscriptionLabels?.get(sub.id) ?? sub.description,
        refId: sub.id,
        issuerId: sub.issuerId,
      };
    }),
    ...quarters.flatMap((q) =>
      compareCivil(q.dueOn, today) < 0
        ? []
        : [
            ...q.vat.issuers
              .filter((i) => i.payableCents > 0)
              .map(
                (i): FlowInput => ({ on: q.dueOn, kind: "vat", cents: -i.payableCents, label: q.key, refId: q.key, issuerId: i.issuerId }),
              ),
            ...q.withholdings.issuers
              .filter((i) => i.withheldCents > 0)
              .map(
                (i): FlowInput => ({
                  on: q.dueOn,
                  kind: "withholding",
                  cents: -i.withheldCents,
                  label: q.key,
                  refId: q.key,
                  issuerId: i.issuerId,
                }),
              ),
          ],
    ),
  ];
  const forecast = cashForecast({ today, days, startCents: cash.estimatedCents, flows });

  return {
    definitionVersion: FINANCE_DEFINITION_VERSION,
    today,
    cash: { ...cash, accounts: input.accounts },
    months,
    burn: history,
    fixedCosts: fixed,
    runwayMonths: runwayMonths(cash.estimatedCents, fixed.monthlyCents),
    taxes: { isEstimate: true, quarters },
    forecast,
    shareholdings: input.shareholdings,
  };
}
