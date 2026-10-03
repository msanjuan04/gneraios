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
  /** Texto de la línea del contrato, para enseñar qué se cobra. */
  description?: string;
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
  /** Para enseñar de quién es el cobro; la previsión por meses no lo necesita. */
  clientId?: string;
  title?: string;
  signedOn: CivilDate | null;
  lines: ForecastLine[];
  milestones: { id: string; position: number; percentBps: number; plannedOn: CivilDate | null }[];
  /** Hitos ya facturados (o en borrador): no se vuelven a prever. */
  billedMilestoneIds: ReadonlySet<string>;
  /** Periodos recurrentes ya facturados, por línea: tampoco. */
  billedStarts: ReadonlyMap<string, ReadonlySet<CivilDate>>;
};

export type ForecastMonth = { month: CivilDate; recurringCents: number; oneOffCents: number };

/** Un cobro concreto: qué se cobra, cuándo toca y cuánto (base sin IVA). */
export type ForecastItem = {
  contractId: string;
  clientId: string | null;
  contractTitle: string | null;
  /** Mensualidad, anualidad o hito de un pago único. */
  kind: "monthly" | "yearly" | "milestone";
  /** Línea (recurrentes) o hito (pagos únicos). */
  refId: string;
  description: string | null;
  /** El día en que toca facturarlo (se factura por adelantado, el primer día del periodo). */
  date: CivilDate;
  /** Con fecha anterior a la de partida y sin facturar: toca facturarlo ya. */
  overdue: boolean;
  cents: number;
};

const monthKey = (date: CivilDate) => `${date.slice(0, 7)}-01`;

/**
 * Cada cobro previsto en los `months` meses desde el mes de `from` (incluido), uno por uno y por
 * fecha. Es el MISMO calendario que factura (periodsDue): lo ya facturado no sale y lo vencido sin
 * facturar sale marcado `overdue`. Solo contratos firmados. El uso no se puede prever.
 */
export function forecastItems(contracts: readonly ForecastContract[], from: CivilDate, months: number): ForecastItem[] {
  const first = monthKey(from);
  const lastDay = addMonthsClamped(first, months);
  const items: ForecastItem[] = [];
  const base = (contract: ForecastContract) => ({ contractId: contract.id, clientId: contract.clientId ?? null, contractTitle: contract.title ?? null });

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
        items.push({
          ...base(contract),
          kind: line.billingType,
          refId: line.id,
          description: line.description ?? null,
          date: period.billableOn,
          overdue: compareCivil(period.billableOn, from) < 0,
          cents: lineBaseCents({ quantity: line.quantity, unitPriceCents: unit, discountBps: line.discountBps }),
        });
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
      items.push({
        ...base(contract),
        kind: "milestone",
        refId: milestone.id,
        description: null,
        date: milestone.plannedOn,
        overdue: compareCivil(milestone.plannedOn, from) < 0,
        cents: Object.values(shares[milestone.id] ?? {}).reduce((sum, cents) => sum + cents, 0),
      });
    }
  }
  return items.sort((a, b) => compareCivil(a.date, b.date) || a.contractId.localeCompare(b.contractId));
}

/**
 * Facturación prevista para `months` meses desde el mes de `from` (incluido), sumada por mes.
 * Lo ya facturado no cuenta; lo vencido y aún no facturado cae en el primer mes.
 */
export function forecastBilling(contracts: readonly ForecastContract[], from: CivilDate, months: number): ForecastMonth[] {
  const first = monthKey(from);
  const buckets = new Map<string, ForecastMonth>();
  for (let i = 0; i < months; i++) {
    const month = addMonthsClamped(first, i);
    buckets.set(month, { month, recurringCents: 0, oneOffCents: 0 });
  }
  for (const item of forecastItems(contracts, from, months)) {
    const bucket = buckets.get(compareCivil(item.date, first) < 0 ? first : monthKey(item.date));
    if (!bucket) continue;
    if (item.kind === "milestone") bucket.oneOffCents += item.cents;
    else bucket.recurringCents += item.cents;
  }
  return [...buckets.values()];
}
