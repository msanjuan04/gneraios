// Previsión de facturación (base sin IVA) de los próximos meses con el MISMO calendario que
// factura (periodsDue): no es una estimación, es lo que el cron va a facturar si nada cambia.
// Recurrente (mensual + anual, con prorrateos, pausas y bajas ya programadas) y puntual (hitos
// con fecha aún sin facturar), siempre por separado. El uso no se puede prever: se deja fuera.

import { addMonthsClamped, compareCivil, type CivilDate } from "../dates/civil-date";
import { lineBaseCents } from "../metrics/mrr";
import { splitByMilestones, validateMilestones } from "./milestones";
import { periodAmountCents, periodsDue, type Pause } from "./schedule";

export type ForecastLine = {
  id: string;
  billingType: "one_off" | "monthly" | "yearly" | "usage";
  quantity: string | number;
  unitPriceCents: number;
  discountBps: number;
  startsOn: CivilDate | null;
  endsOn: CivilDate | null;
  billingDay: number | null;
  prorateFirst: boolean;
  pauses: Pause[];
};

export type ForecastContract = {
  id: string;
  signedOn: CivilDate | null;
  lines: ForecastLine[];
  milestones: { id: string; position: number; percentBps: number; plannedOn: CivilDate | null }[];
  /** Hitos ya facturados (o en borrador): no se vuelven a prever. */
  billedMilestoneIds: ReadonlySet<string>;
  /** Periodos recurrentes ya facturados, por línea: tampoco. */
  billedStarts: ReadonlyMap<string, ReadonlySet<CivilDate>>;
};

export type ForecastMonth = { month: CivilDate; recurringCents: number; oneOffCents: number };

const monthKey = (date: CivilDate) => `${date.slice(0, 7)}-01`;

/**
 * Facturación prevista para `months` meses desde el mes de `from` (incluido). Solo contratos
 * firmados. Lo ya facturado no cuenta; lo vencido y aún no facturado cae en el primer mes.
 */
export function forecastBilling(contracts: readonly ForecastContract[], from: CivilDate, months: number): ForecastMonth[] {
  const first = monthKey(from);
  const buckets = new Map<string, ForecastMonth>();
  for (let i = 0; i < months; i++) {
    const month = addMonthsClamped(first, i);
    buckets.set(month, { month, recurringCents: 0, oneOffCents: 0 });
  }
  const lastDay = addMonthsClamped(first, months);
  const bucketFor = (date: CivilDate) => buckets.get(compareCivil(date, first) < 0 ? first : monthKey(date));

  for (const contract of contracts) {
    if (!contract.signedOn) continue;
    for (const line of contract.lines) {
      if ((line.billingType !== "monthly" && line.billingType !== "yearly") || !line.startsOn) continue;
      const periods = periodsDue(
        { billingType: line.billingType, startsOn: line.startsOn, endsOn: line.endsOn, billingDay: line.billingDay ?? 1, prorateFirst: line.prorateFirst },
        line.pauses,
        contract.billedStarts.get(line.id) ?? new Set(),
        lastDay,
      );
      for (const period of periods) {
        if (compareCivil(period.billableOn, lastDay) >= 0) continue;
        const unit = period.activeDays === period.cycleDays ? line.unitPriceCents : periodAmountCents(line.unitPriceCents, period);
        const bucket = bucketFor(period.billableOn);
        if (bucket) bucket.recurringCents += lineBaseCents({ quantity: line.quantity, unitPriceCents: unit, discountBps: line.discountBps });
      }
    }

    const oneOff = contract.lines.filter((l) => l.billingType === "one_off");
    const milestones = [...contract.milestones].sort((a, b) => a.position - b.position);
    if (oneOff.length === 0 || milestones.length === 0 || validateMilestones(milestones.map((m) => m.percentBps)) !== null) continue;
    const shares = splitByMilestones(
      oneOff.map((l) => ({ id: l.id, baseCents: lineBaseCents(l) })),
      milestones.map((m) => ({ id: m.id, percentBps: m.percentBps })),
    );
    for (const milestone of milestones) {
      if (contract.billedMilestoneIds.has(milestone.id) || !milestone.plannedOn) continue;
      if (compareCivil(milestone.plannedOn, lastDay) >= 0) continue;
      const bucket = bucketFor(milestone.plannedOn);
      if (!bucket) continue;
      bucket.oneOffCents += Object.values(shares[milestone.id] ?? {}).reduce((sum, cents) => sum + cents, 0);
    }
  }
  return [...buckets.values()];
}
