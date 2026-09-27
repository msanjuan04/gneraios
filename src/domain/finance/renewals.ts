// Renovaciones de las suscripciones de gasto (dominios, servidores, licencias…): cuándo es el
// próximo cargo, cuántos días faltan y de cuáles se avisa. Nada se guarda: se deriva de la
// suscripción (starts_on, billing_interval, billing_day, ends_on) con el mismo calendario que
// genera sus gastos (subscriptions.ts, que usa el de la facturación recurrente).
//
// Avisos (bandeja y push, los crea el cron diario con src/server/finance/renewals.ts):
// - De las suscripciones activas cuyo próximo cargo cae dentro de los días de aviso de la org
//   (orgs.settings.finance.renewal_warning_days; hoy incluido).
// - Las anuales siempre; las mensuales solo desde un importe por cargo
//   (orgs.settings.finance.monthly_renewal_min_cents), para no llenar la bandeja cada mes.
// - El primer cargo no es una renovación (se acaba de dar de alta) y la nómina y la retribución de
//   los socios se pagan, no se renuevan: de eso no se avisa.
// - Uno por cargo: la clave es la suscripción y la fecha del cargo, así que repetir el cron no
//   duplica nada y el año (o el mes) siguiente se vuelve a avisar.

import { nextBillingOn, type RecurringLine } from "../billing/schedule";
import { addDays, compareCivil, daysBetween, parseCivilDate, type CivilDate } from "../dates/civil-date";
import type { Cents } from "../money";
import type { ExpenseGroup } from "./expense";
import type { ExpenseSubscription } from "./subscriptions";

/** Lo que hace falta de una suscripción para saber cuándo se cobra. */
export type RenewalSchedule = Pick<ExpenseSubscription, "interval" | "startsOn" | "endsOn" | "billingDay" | "isActive">;

/** Los umbrales de los avisos (orgs.settings.finance, con sus valores por defecto). */
export type RenewalSettings = {
  /** Cuántos días antes se avisa (y se resalta en Finanzas → Infraestructura). */
  warningDays: number;
  /** Las mensuales avisan solo si cada cargo es de al menos este importe. */
  monthlyMinCents: Cents;
};

/** Grupos de gasto que se pagan pero no se renuevan: de ellos no se avisa. */
export const NON_RENEWAL_GROUPS = ["payroll", "partner_compensation"] as const satisfies readonly ExpenseGroup[];

/** La suscripción como una línea recurrente (el mismo calendario que sus gastos). */
function scheduleOf(sub: RenewalSchedule): RecurringLine {
  const billingDay = sub.billingDay ?? parseCivilDate(sub.startsOn).day;
  return { billingType: sub.interval, startsOn: sub.startsOn, endsOn: sub.endsOn, billingDay, prorateFirst: false };
}

/**
 * El próximo cargo desde hoy, incluido (si toca hoy, se renueva hoy); null si está apagada o ya no
 * habrá más (terminó o termina antes). Antes de empezar, su primer cargo.
 */
export function nextRenewalOn(sub: RenewalSchedule, today: CivilDate): CivilDate | null {
  if (!sub.isActive) return null;
  return nextBillingOn(scheduleOf(sub), [], addDays(today, -1));
}

/** ¿Está en marcha hoy? Encendida y sin terminar (una que aún no ha empezado, también). */
export function isRunning(sub: Pick<RenewalSchedule, "isActive" | "endsOn">, today: CivilDate): boolean {
  return sub.isActive && (sub.endsOn === null || compareCivil(sub.endsOn, today) >= 0);
}

/** Días que faltan para una fecha (0 = hoy, negativo si ya pasó). */
export function daysUntil(on: CivilDate, today: CivilDate): number {
  return daysBetween(today, on);
}

/** ¿Cae entre hoy y dentro de `warningDays` días (los dos incluidos)? */
export function isWithinWarning(on: CivilDate | null, today: CivilDate, warningDays: number): boolean {
  if (on === null) return false;
  const days = daysUntil(on, today);
  return days >= 0 && days <= warningDays;
}

/** ¿Se avisa de sus renovaciones? Las anuales siempre; las mensuales, desde el importe mínimo. Nóminas y socios, nunca. */
export function isRenewalWatched(
  sub: { interval: RenewalSchedule["interval"]; chargeTotalCents: Cents; expenseGroup: ExpenseGroup },
  settings: RenewalSettings,
): boolean {
  if ((NON_RENEWAL_GROUPS as readonly ExpenseGroup[]).includes(sub.expenseGroup)) return false;
  return sub.interval === "yearly" || sub.chargeTotalCents >= settings.monthlyMinCents;
}

export type RenewalCandidate = RenewalSchedule & {
  id: string;
  /** Lo que se enseña en el aviso (la descripción de la suscripción). */
  name: string;
  /** Lo que se cobrará en cada cargo: base + IVA − IRPF. */
  chargeTotalCents: Cents;
  expenseGroup: ExpenseGroup;
};

export type RenewalAlert = {
  subscriptionId: string;
  /** Base de notifications.dedupe_key: el servidor le añade el destinatario. */
  key: string;
  renewalOn: CivilDate;
  /** Los de inbox.kinds.subscription_renewal. */
  params: { name: string; date: CivilDate; days: number; amount_cents: Cents };
};

/** La clave de un aviso: una por suscripción y cargo. */
export function renewalAlertKey(subscriptionId: string, renewalOn: CivilDate): string {
  return `subscription_renewal:${subscriptionId}:${renewalOn}`;
}

/** Los avisos que tocan hoy, del cargo más cercano al más lejano. */
export function planRenewalAlerts(subscriptions: readonly RenewalCandidate[], today: CivilDate, settings: RenewalSettings): RenewalAlert[] {
  parseCivilDate(today);
  const alerts: RenewalAlert[] = [];
  for (const sub of subscriptions) {
    if (!isRenewalWatched(sub, settings)) continue;
    const renewalOn = nextRenewalOn(sub, today);
    // El primer cargo no es una renovación.
    if (renewalOn === null || renewalOn === sub.startsOn || !isWithinWarning(renewalOn, today, settings.warningDays)) continue;
    alerts.push({
      subscriptionId: sub.id,
      key: renewalAlertKey(sub.id, renewalOn),
      renewalOn,
      params: { name: sub.name.trim(), date: renewalOn, days: daysUntil(renewalOn, today), amount_cents: sub.chargeTotalCents },
    });
  }
  return alerts.sort((a, b) => compareCivil(a.renewalOn, b.renewalOn) || (a.subscriptionId < b.subscriptionId ? -1 : a.subscriptionId > b.subscriptionId ? 1 : 0));
}
