import { splitByMilestones, validateMilestones } from "@/domain/billing/milestones";
import { nextBillingOn, type Pause } from "@/domain/billing/schedule";
import { addDays, type CivilDate, compareCivil } from "@/domain/dates/civil-date";
import { lineBaseCents, type MrrLine, mrrCents } from "@/domain/metrics/mrr";
import { type BillingType, isRecurring } from "./schema";

/**
 * Cifras derivadas de las líneas de un contrato (ARCHITECTURE.md §6.4, §7.2, §7.8): MRR,
 * puntual, próxima facturación, fin de periodo recomendado para una baja… Nada de esto se
 * guarda: sale siempre de las líneas, sus pausas y la fecha de hoy en la zona de la org.
 * Puro (sin servidor ni React): lo usan las páginas y la vista previa del alta.
 */

export type SummaryLine = {
  billingType: BillingType;
  quantity: number | string;
  unitPriceCents: number;
  discountBps: number;
  startsOn: CivilDate | null;
  endsOn: CivilDate | null;
  billingDay: number | null;
  prorateFirst: boolean;
  pauses: readonly Pause[];
};

export type ContractSummary = {
  /** MRR de hoy (líneas recurrentes activas). */
  mrrCents: number;
  /** Si hoy es 0 pero hay líneas que empiezan más adelante: el MRR del día en que empiezan. */
  upcomingMrr: { cents: number; from: CivilDate } | null;
  /** Σ base de las líneas puntuales (sin IVA). */
  oneOffCents: number;
  /** Primer periodo que empieza después de hoy, entre todas las recurrentes. */
  nextBillingOn: CivilDate | null;
};

const minDate = (a: CivilDate | null, b: CivilDate | null) => (a === null ? b : b === null ? a : compareCivil(a, b) <= 0 ? a : b);

function toMrrLine(line: SummaryLine): MrrLine {
  return {
    billingType: line.billingType,
    quantity: line.quantity,
    unitPriceCents: line.unitPriceCents,
    discountBps: line.discountBps,
    startsOn: line.startsOn,
    endsOn: line.endsOn,
    pauses: line.pauses,
  };
}

function toRecurring(line: SummaryLine & { startsOn: CivilDate }) {
  return {
    billingType: line.billingType as "monthly" | "yearly",
    startsOn: line.startsOn,
    endsOn: line.endsOn,
    // Las anuales no usan el día: se facturan en el aniversario del inicio.
    billingDay: line.billingDay ?? 1,
    prorateFirst: line.prorateFirst,
  };
}

const withStart = (line: SummaryLine): line is SummaryLine & { startsOn: CivilDate } =>
  isRecurring(line.billingType) && line.startsOn !== null;

/** Base de un ciclo completo de la línea (cantidad × precio − descuento), sin IVA. */
export function lineBase(line: Pick<SummaryLine, "quantity" | "unitPriceCents" | "discountBps">): number {
  return lineBaseCents({ quantity: line.quantity, unitPriceCents: line.unitPriceCents, discountBps: line.discountBps });
}

/** Próxima facturación de una línea recurrente: el primer periodo que empieza después de `today`. */
export function lineNextBillingOn(line: SummaryLine, today: CivilDate): CivilDate | null {
  return withStart(line) ? nextBillingOn(toRecurring(line), line.pauses, today) : null;
}

export function contractSummary(lines: readonly SummaryLine[], today: CivilDate): ContractSummary {
  const mrrLines = lines.map(toMrrLine);
  const mrr = mrrCents(mrrLines, today);
  const oneOffCents = lines.filter((l) => l.billingType === "one_off").reduce((sum, l) => sum + lineBase(l), 0);
  const recurring = lines.filter(withStart);
  const next = recurring.reduce<CivilDate | null>((min, l) => minDate(min, lineNextBillingOn(l, today)), null);

  let upcomingMrr: ContractSummary["upcomingMrr"] = null;
  if (mrr === 0) {
    const from = recurring
      .map((l) => l.startsOn)
      .filter((d) => compareCivil(d, today) > 0)
      .reduce<CivilDate | null>(minDate, null);
    const cents = from ? mrrCents(mrrLines, from) : 0;
    if (from && cents > 0) upcomingMrr = { cents, from };
  }
  return { mrrCents: mrr, upcomingMrr, oneOffCents, nextBillingOn: next };
}

/**
 * MRR que aportarían unas líneas cuando estén activas, sin mirar fechas (vista previa del
 * alta). Usa la misma definición que el resto: la de src/domain/metrics.
 */
export function potentialMrrCents(lines: readonly Pick<SummaryLine, "billingType" | "quantity" | "unitPriceCents" | "discountBps">[]): number {
  const ref = "2000-01-01";
  return mrrCents(
    lines.map((l) => ({ ...l, startsOn: ref, endsOn: null, pauses: [] })),
    ref,
  );
}

/**
 * Fin recomendado para dar de baja una línea: el último día del periodo en curso (o del
 * primero, si aún no ha empezado), y nunca antes de lo ya facturado. Las líneas por uso,
 * hoy. Un one-off no se da de baja (null).
 */
export function recommendedEndOn(line: SummaryLine & { billedUntil: CivilDate | null }, today: CivilDate): CivilDate | null {
  if (line.billingType === "one_off") return null;
  const ref = line.startsOn && compareCivil(today, line.startsOn) < 0 ? line.startsOn : today;
  let end = ref;
  if (withStart(line)) {
    // Los ciclos no se mueven con las pausas: se calculan sin ellas.
    const next = nextBillingOn(toRecurring(line), [], ref);
    end = next ? addDays(next, -1) : (line.endsOn ?? ref);
  }
  if (line.billedUntil && compareCivil(line.billedUntil, end) > 0) end = line.billedUntil;
  if (line.endsOn && compareCivil(end, line.endsOn) > 0) end = line.endsOn;
  return end;
}

/**
 * Fecha por defecto de una versión nueva: el día siguiente a lo ya facturado (o hoy, si no
 * hay periodos facturados), y siempre después del inicio de la línea (new_line_version).
 */
export function defaultVersionFrom(line: { startsOn: CivilDate | null; billedUntil: CivilDate | null }, today: CivilDate): CivilDate {
  let from = line.billedUntil ? addDays(line.billedUntil, 1) : today;
  if (line.startsOn && compareCivil(from, line.startsOn) <= 0) from = addDays(line.startsOn, 1);
  return from;
}

/** La pausa que cubre `today`, si la hay. */
export function currentPause<P extends Pause>(pauses: readonly P[], today: CivilDate): P | null {
  return (
    pauses.find((p) => compareCivil(p.startsOn, today) <= 0 && (p.endsOn === null || compareCivil(today, p.endsOn) <= 0)) ??
    null
  );
}

/** La próxima pausa programada (empieza después de `today`). */
export function upcomingPause<P extends Pause>(pauses: readonly P[], today: CivilDate): P | null {
  return [...pauses].filter((p) => compareCivil(p.startsOn, today) > 0).sort((a, b) => compareCivil(a.startsOn, b.startsOn))[0] ?? null;
}

/**
 * Reanudar: la pausa termina ayer. Si empieza hoy o más adelante, nunca llegó a aplicarse y
 * se borra (una pausa no puede terminar antes de empezar).
 */
export function resumePlan(pause: Pause, today: CivilDate): { kind: "delete" } | { kind: "end"; endsOn: CivilDate } {
  return compareCivil(pause.startsOn, today) >= 0 ? { kind: "delete" } : { kind: "end", endsOn: addDays(today, -1) };
}

/**
 * Importe de cada hito: el reparto de src/domain/billing sobre las bases de las líneas
 * puntuales, sumado por hito (el último factura el resto). null si el plan no es válido.
 * Los hitos tienen que llegar en su orden.
 */
export function milestoneAmounts(
  oneOffLines: readonly { id: string; baseCents: number }[],
  milestones: readonly { id: string; percentBps: number }[],
): Record<string, number> | null {
  if (milestones.length === 0 || validateMilestones(milestones.map((m) => m.percentBps)) !== null) return null;
  const split = splitByMilestones(oneOffLines, milestones);
  return Object.fromEntries(
    milestones.map((m) => [m.id, Object.values(split[m.id] ?? {}).reduce((sum, cents) => sum + cents, 0)]),
  );
}
