// Renovaciones próximas (ARCHITECTURE.md §7.8, §7.10): líneas anuales cuya próxima facturación
// cae dentro de la ventana (la mayor de las alertas de renovación de la org, 60 días por
// defecto). Misma regla que los avisos del cron (src/domain/billing/plan.ts): la primera
// facturación de una línea no es una renovación y lo que se factura hoy ya no está "por venir".

import { nextBillingOn, type Pause } from "../billing/schedule";
import { addDays, daysBetween, type CivilDate } from "../dates/civil-date";
import type { Cents } from "../money";
import { lineBaseCents } from "./mrr";

export type RenewalLine = {
  billingType: "one_off" | "monthly" | "yearly" | "usage";
  startsOn: CivilDate | null;
  endsOn: CivilDate | null;
  pauses: readonly Pause[];
  quantity: string | number;
  unitPriceCents: Cents;
  discountBps: number;
};

export type Renewal<T extends RenewalLine> = {
  line: T;
  renewsOn: CivilDate;
  daysLeft: number;
  /** Base anual sin IVA (lo que se volverá a facturar). */
  amountCents: Cents;
};

export function upcomingRenewals<T extends RenewalLine>(
  lines: readonly T[],
  today: CivilDate,
  windowDays: number,
): Renewal<T>[] {
  const renewals: Renewal<T>[] = [];
  for (const line of lines) {
    if (line.billingType !== "yearly" || line.startsOn === null) continue;
    const recurring = { billingType: "yearly" as const, startsOn: line.startsOn, endsOn: line.endsOn, billingDay: 1, prorateFirst: false };
    const next = nextBillingOn(recurring, line.pauses, addDays(today, -1));
    if (next === null || next === line.startsOn) continue;
    const daysLeft = daysBetween(today, next);
    if (daysLeft <= 0 || daysLeft > windowDays) continue;
    renewals.push({ line, renewsOn: next, daysLeft, amountCents: lineBaseCents(line) });
  }
  return renewals.sort((a, b) => a.daysLeft - b.daysLeft);
}
