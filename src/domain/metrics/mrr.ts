// MRR (ARCHITECTURE.md §7.8, definición v1): Σ líneas mensuales activas + Σ líneas anuales
// activas / 12, netas de descuento y sin IVA. Se suma de forma exacta y se redondea una sola
// vez. Excluye uso, one-off y líneas en pausa. Es la única definición: la usan las fichas, el
// dashboard y las fotos mensuales.

import { isLineActiveOn, type Pause } from "../billing/schedule";
import type { CivilDate } from "../dates/civil-date";
import { divRoundHalfAwayFromZero, type Cents } from "../money";
import { computeLine } from "../tax/totals";

export const MRR_DEFINITION_VERSION = 1;

export type MrrLine = {
  billingType: "one_off" | "monthly" | "yearly" | "usage";
  quantity: string | number;
  unitPriceCents: Cents;
  discountBps: number;
  startsOn: CivilDate | null;
  endsOn: CivilDate | null;
  pauses: readonly Pause[];
};

/** Base imponible de un ciclo completo de la línea (cantidad × precio − descuento). */
export function lineBaseCents(line: Pick<MrrLine, "quantity" | "unitPriceCents" | "discountBps">): Cents {
  return computeLine({
    quantity: line.quantity,
    unitPriceCents: line.unitPriceCents,
    discountBps: line.discountBps,
    vatBps: 0,
    irpfBps: 0,
    irpfApplies: false,
  }).baseCents;
}

/** Aportación exacta de una línea al MRR, en doceavos de céntimo (para sumar sin redondear). */
function twelfths(line: MrrLine, date: CivilDate): bigint {
  if (line.billingType !== "monthly" && line.billingType !== "yearly") return BigInt(0);
  if (line.startsOn === null || !isLineActiveOn({ startsOn: line.startsOn, endsOn: line.endsOn }, line.pauses, date)) {
    return BigInt(0);
  }
  const base = BigInt(lineBaseCents(line));
  return line.billingType === "monthly" ? base * BigInt(12) : base;
}

/**
 * MRR exacto en una fecha, en doceavos de céntimo (sin redondear). Sirve para sumar y restar
 * MRR (por cliente, movimientos) y redondear una sola vez al final.
 */
export function mrrTwelfths(lines: readonly MrrLine[], date: CivilDate): bigint {
  return lines.reduce((sum, line) => sum + twelfths(line, date), BigInt(0));
}

/** Doceavos de céntimo → céntimos, redondeando half away from zero. */
export function twelfthsToCents(value: bigint): Cents {
  return Number(divRoundHalfAwayFromZero(value, BigInt(12)));
}

/** MRR en una fecha: exacto y redondeado una sola vez (half away from zero). */
export function mrrCents(lines: readonly MrrLine[], date: CivilDate): Cents {
  return twelfthsToCents(mrrTwelfths(lines, date));
}

/** ARR = MRR × 12 (§7.8): se deriva del MRR ya redondeado, nunca se suma aparte. */
export function arrCents(mrr: Cents): Cents {
  return mrr * 12;
}

/** Aportación de una sola línea (para mostrarla en la ficha del contrato). */
export function lineMrrCents(line: MrrLine, date: CivilDate): Cents {
  return mrrCents([line], date);
}
