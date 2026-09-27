// Suscripciones de gasto (software, alquiler, gestoría, retribución de socios…): qué cargos
// tocan y qué gastos hay que generar. Usan el MISMO calendario que la facturación recurrente
// (periodsDue, src/domain/billing/schedule.ts), sin prorrateos: cada cargo es un periodo entero.
//
// - Mensual: un cargo el `billingDay` de cada mes (el último día en los meses más cortos, sin
//   deriva). El primero es el día de alta (`startsOn`), aunque no coincida con el día de cargo.
// - Anual: un cargo en cada aniversario de `startsOn` (29 feb → 28 feb en los años no bisiestos).
// - Termina con `endsOn`: no hay cargos que empiecen después. Apagada (`isActive` false), no
//   genera nada; al encenderla de nuevo se generan los periodos que falten.
// - Idempotente: el servidor pasa los periodos ya generados (`expenses.period_start`) y recibe
//   solo lo que falta; (suscripción, periodo) es único en la base de datos.
// - Cada gasto generado hereda a quién sirve la suscripción (empresa, un cliente o las webs que
//   alojamos) y si se le repercute al cliente, con su margen. Cambiar la suscripción solo cambia
//   lo que se genere a partir de entonces.

import { nextBillingOn, periodsDue, type Period, type RecurringLine } from "../billing/schedule";
import { compareCivil, parseCivilDate, type CivilDate } from "../dates/civil-date";
import { divRoundHalfAwayFromZero, type Bps, type Cents } from "../money";
import { type CostAllocation, normalizeCostAssignment } from "./allocation";
import { computeExpenseAmounts, expenseCostCents, isAutoPaid, type ExpenseAmounts, type PaymentMethod } from "./expense";

export type SubscriptionInterval = "monthly" | "yearly";

export type ExpenseSubscription = {
  id: string;
  issuerId: string;
  vendorId: string | null;
  categoryId: string;
  memberId: string | null;
  description: string;
  baseCents: Cents;
  vatBps: Bps;
  vatDeductible: boolean;
  irpfBps: Bps;
  interval: SubscriptionInterval;
  startsOn: CivilDate;
  endsOn: CivilDate | null;
  /** Mensuales: día del cargo (1-31). Anuales: null (el aniversario de `startsOn`). */
  billingDay: number | null;
  paymentMethod: PaymentMethod;
  isActive: boolean;
  /** A quién sirve (pasa a cada gasto generado). */
  allocation: CostAllocation;
  /** El cliente, solo con allocation = 'client'. */
  clientId: string | null;
  /** Cada cargo se le repercute al cliente. */
  rebill: boolean;
  rebillMarkupBps: Bps;
};

export type SubscriptionCharge = {
  subscriptionId: string;
  /** Clave estable del periodo (no cambia aunque se edite el gasto). */
  periodStart: CivilDate;
  /** Día del cargo: el primero del periodo (se cobra por adelantado). */
  chargedOn: CivilDate;
  amounts: ExpenseAmounts;
};

/** Gasto a insertar para un cargo, con las columnas de `expenses` en camelCase. */
export type PlannedExpense = {
  subscriptionId: string;
  periodStart: CivilDate;
  issuerId: string;
  vendorId: string | null;
  categoryId: string;
  memberId: string | null;
  description: string;
  issuedOn: CivilDate;
  dueOn: CivilDate;
  /** Tarjeta o domiciliación: pagado el día del cargo. Si no, pendiente. */
  paidOn: CivilDate | null;
  paymentMethod: PaymentMethod;
  baseCents: Cents;
  vatBps: Bps;
  vatCents: Cents;
  vatDeductible: boolean;
  irpfBps: Bps;
  irpfCents: Cents;
  totalCents: Cents;
  allocation: CostAllocation;
  clientId: string | null;
  rebill: boolean;
  rebillMarkupBps: Bps;
};

/** La suscripción como una línea recurrente del motor de facturación. */
function scheduleLine(sub: ExpenseSubscription): RecurringLine {
  const billingDay = sub.billingDay ?? parseCivilDate(sub.startsOn).day;
  return { billingType: sub.interval, startsOn: sub.startsOn, endsOn: sub.endsOn, billingDay, prorateFirst: false };
}

/** Importes de un cargo completo. */
export function subscriptionAmounts(sub: Pick<ExpenseSubscription, "baseCents" | "vatBps" | "irpfBps">): ExpenseAmounts {
  return computeExpenseAmounts({ baseCents: sub.baseCents, vatBps: sub.vatBps, irpfBps: sub.irpfBps });
}

function toCharge(sub: ExpenseSubscription, period: Period, amounts: ExpenseAmounts): SubscriptionCharge {
  return { subscriptionId: sub.id, periodStart: period.start, chargedOn: period.billableOn, amounts };
}

/**
 * Cargos con fecha hasta `until` (incluido) que aún no se han generado, en orden. Incluye los de
 * días pasados que no se generaron (un cron caído se recupera al día siguiente). Apagada: ninguno.
 */
export function subscriptionChargesDue(
  sub: ExpenseSubscription,
  generatedStarts: ReadonlySet<CivilDate>,
  until: CivilDate,
): SubscriptionCharge[] {
  if (!sub.isActive) return [];
  const amounts = subscriptionAmounts(sub);
  return periodsDue(scheduleLine(sub), [], generatedStarts, until).map((period) => toCharge(sub, period, amounts));
}

/** Los gastos que hay que generar hoy: los cargos hasta `today` que faltan, de todas las suscripciones. */
export function planSubscriptionExpenses(
  subscriptions: readonly ExpenseSubscription[],
  generated: ReadonlyMap<string, ReadonlySet<CivilDate>>,
  today: CivilDate,
): PlannedExpense[] {
  parseCivilDate(today);
  const planned: PlannedExpense[] = [];
  for (const sub of subscriptions) {
    const assignment = normalizeCostAssignment(sub);
    for (const charge of subscriptionChargesDue(sub, generated.get(sub.id) ?? new Set(), today)) {
      planned.push({
        subscriptionId: sub.id,
        periodStart: charge.periodStart,
        issuerId: sub.issuerId,
        vendorId: sub.vendorId,
        categoryId: sub.categoryId,
        memberId: sub.memberId,
        description: sub.description.trim(),
        issuedOn: charge.chargedOn,
        dueOn: charge.chargedOn,
        paidOn: isAutoPaid(sub.paymentMethod) ? charge.chargedOn : null,
        paymentMethod: sub.paymentMethod,
        baseCents: charge.amounts.baseCents,
        vatBps: sub.vatBps,
        vatCents: charge.amounts.vatCents,
        vatDeductible: sub.vatDeductible,
        irpfBps: sub.irpfBps,
        irpfCents: charge.amounts.irpfCents,
        totalCents: charge.amounts.totalCents,
        allocation: assignment.allocation,
        clientId: assignment.clientId,
        rebill: assignment.rebill,
        rebillMarkupBps: assignment.rebillMarkupBps,
      });
    }
  }
  return planned.sort((a, b) => compareCivil(a.issuedOn, b.issuedOn) || a.subscriptionId.localeCompare(b.subscriptionId));
}

/**
 * Cargos que aún no se han generado con fecha hasta `until` (incluido), de todas las suscripciones:
 * los que caerán en una previsión. Incluye los ya vencidos que aún no se han generado (el cron los
 * generará hoy); quien prevé los pone en hoy.
 */
export function upcomingSubscriptionCharges(
  subscriptions: readonly ExpenseSubscription[],
  generated: ReadonlyMap<string, ReadonlySet<CivilDate>>,
  until: CivilDate,
): SubscriptionCharge[] {
  return subscriptions
    .flatMap((sub) => subscriptionChargesDue(sub, generated.get(sub.id) ?? new Set(), until))
    .sort((a, b) => compareCivil(a.chargedOn, b.chargedOn) || a.subscriptionId.localeCompare(b.subscriptionId));
}

/**
 * Coste mensual equivalente de una suscripción activa (coste = base + IVA no deducible): la
 * cuota si es mensual, la doceava parte (redondeada una vez) si es anual. 0 si está apagada o ya
 * terminó en `today`.
 */
export function subscriptionMonthlyCostCents(sub: ExpenseSubscription, today: CivilDate): Cents {
  if (!sub.isActive || (sub.endsOn !== null && compareCivil(sub.endsOn, today) < 0)) return 0;
  const amounts = subscriptionAmounts(sub);
  const cost = expenseCostCents({ baseCents: amounts.baseCents, vatCents: amounts.vatCents, vatDeductible: sub.vatDeductible });
  return sub.interval === "monthly" ? cost : Number(divRoundHalfAwayFromZero(BigInt(cost), BigInt(12)));
}

/** El próximo cargo después de `after` (para la lista de suscripciones), o null si ya no habrá más. */
export function nextChargeOn(sub: ExpenseSubscription, after: CivilDate): CivilDate | null {
  return sub.isActive ? nextBillingOn(scheduleLine(sub), [], after) : null;
}
