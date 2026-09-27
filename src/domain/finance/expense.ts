// Gastos (Control 0, CONSEJO.md §3): los importes de una factura de proveedor con la única
// implementación del redondeo (src/domain/tax), su estado derivado y lo que cuestan de verdad.
//
// Un gasto es una línea: base, IVA soportado (redondeado sobre la base) y, si pagamos a un
// profesional o un alquiler, la retención que practicamos (redondeada sobre la base). Lo que se
// paga al proveedor es base + IVA − IRPF; la retención se ingresa después en Hacienda (111/115).

import type { PaymentMethod } from "../billing/plan";
import { compareCivil, parseCivilDate, type CivilDate } from "../dates/civil-date";
import { assertBps, assertCents, divRoundHalfAwayFromZero, type Bps, type Cents } from "../money";
import { computeLine } from "../tax/totals";

export type { PaymentMethod };

/** Para qué es un gasto. Mismos valores que el enum `expense_group`. */
export const EXPENSE_GROUPS = [
  "operating",
  "payroll",
  "partner_compensation",
  "cost_of_sales",
  "taxes",
  "financial",
  "other",
] as const;
export type ExpenseGroup = (typeof EXPENSE_GROUPS)[number];

/** Estado derivado (nunca se guarda). Mismos valores que el enum `expense_status`. */
export const EXPENSE_STATUSES = ["pending", "paid", "overdue"] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];

export type ExpenseAmountsInput = {
  /** Base imponible; negativa en un abono del proveedor. */
  baseCents: Cents;
  vatBps: Bps;
  /** Retención que practicamos (0 si no hay). */
  irpfBps: Bps;
};

export type ExpenseAmounts = {
  baseCents: Cents;
  vatCents: Cents;
  irpfCents: Cents;
  /** Lo que se paga al proveedor: base + IVA − IRPF. */
  totalCents: Cents;
};

/**
 * Importes de un gasto: una línea de cantidad 1 calculada con computeLine (IVA e IRPF
 * redondeados sobre la base, half away from zero). Es la misma regla que las facturas emitidas.
 */
export function computeExpenseAmounts(input: ExpenseAmountsInput): ExpenseAmounts {
  const line = computeLine({
    quantity: "1",
    unitPriceCents: assertCents(input.baseCents),
    discountBps: 0,
    vatBps: assertBps(input.vatBps),
    irpfBps: assertBps(input.irpfBps),
    irpfApplies: input.irpfBps > 0,
  });
  return { baseCents: line.baseCents, vatCents: line.vatCents, irpfCents: line.irpfCents, totalCents: line.totalCents };
}

/**
 * La base que da exactamente `totalCents` con esos tipos, para quien solo sabe lo que ha pagado
 * (121,00 € con IVA del 21 % → 100,00 €). null si ninguna base da ese total al céntimo (el
 * redondeo salta algún importe): entonces hay que escribir la base.
 */
export function baseFromTotal(totalCents: Cents, vatBps: Bps, irpfBps: Bps): Cents | null {
  assertCents(totalCents);
  const factor = 10_000 + assertBps(vatBps) - assertBps(irpfBps);
  if (factor <= 0) return null;
  const guess = Number(divRoundHalfAwayFromZero(BigInt(totalCents) * BigInt(10_000), BigInt(factor)));
  for (const candidate of [guess, guess - 1, guess + 1, guess - 2, guess + 2]) {
    if (computeExpenseAmounts({ baseCents: candidate, vatBps, irpfBps }).totalCents === totalCents) return candidate;
  }
  return null;
}

/** El IVA que resta en la liquidación: el del gasto si es deducible; si no, nada. */
export function deductibleVatCents(expense: { vatCents: Cents; vatDeductible: boolean }): Cents {
  return expense.vatDeductible ? expense.vatCents : 0;
}

/**
 * Lo que cuesta un gasto (margen, burn, costes fijos): la base y, si el IVA no se deduce, también
 * el IVA. La retención no reduce el coste: se paga igual, a Hacienda en lugar de al proveedor.
 * La vista `expenses_overview.cost_cents` aplica la misma regla.
 */
export function expenseCostCents(expense: { baseCents: Cents; vatCents: Cents; vatDeductible: boolean }): Cents {
  return assertCents(expense.baseCents + (expense.vatDeductible ? 0 : expense.vatCents));
}

/** Cuándo hay que pagarlo: su vencimiento o, si no tiene, el día de la factura. */
export function payableOn(expense: { dueOn: CivilDate | null; issuedOn: CivilDate }): CivilDate {
  parseCivilDate(expense.issuedOn);
  return expense.dueOn ?? expense.issuedOn;
}

/**
 * Estado en `today` (gemela de `expenses_overview.status`): pagado si tiene fecha de pago;
 * vencido si la fecha en que había que pagarlo ya pasó; pendiente en otro caso.
 */
export function expenseStatus(
  expense: { paidOn: CivilDate | null; dueOn: CivilDate | null; issuedOn: CivilDate },
  today: CivilDate,
): ExpenseStatus {
  if (expense.paidOn !== null) return "paid";
  return compareCivil(payableOn(expense), today) < 0 ? "overdue" : "pending";
}

/** Con tarjeta o domiciliación el cargo se hace solo: el gasto se da por pagado ese día. */
export function isAutoPaid(method: PaymentMethod): boolean {
  return method === "card" || method === "sepa_debit";
}
