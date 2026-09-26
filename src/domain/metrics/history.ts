// Histórico mensual del dashboard: las fotos congeladas cuando existen y, para los meses sin
// foto, la reconstrucción con las líneas de hoy (marcada como estimada). El mes en curso es
// siempre el valor de hoy.

import type { CivilDate } from "../dates/civil-date";
import type { Cents } from "../money";
import { addMonths, monthCutoff, monthEnd, type Month } from "./months";
import { mrrMovements, orgMrrCents, type MetricsLine, type MrrMovements } from "./movements";
import type { MonthSnapshot } from "./snapshot";

export type SnapshotLike = Pick<
  MonthSnapshot,
  "month" | "mrrCents" | "newMrrCents" | "expansionMrrCents" | "contractionMrrCents" | "churnMrrCents" | "isEstimated"
>;

/**
 * - snapshot: la foto del cierre (estimada si la foto lo está);
 * - rebuilt: sin foto, reconstruido con las líneas de hoy (siempre estimado);
 * - current: el mes en curso, a fecha de hoy.
 */
export type HistorySource = "snapshot" | "rebuilt" | "current";

export type MrrPoint = { month: Month; mrrCents: Cents; source: HistorySource; estimated: boolean };

export type MonthMovements = MrrMovements & {
  month: Month;
  source: HistorySource;
  estimated: boolean;
  /**
   * Lo que el MRR cambió respecto al mes anterior y los movimientos no explican: solo aparece
   * al encadenar fotos tomadas con datos distintos (p. ej. una baja registrada con efecto atrasado).
   */
  adjustmentCents: Cents;
};

/** MRR al cierre de un mes (el mes en curso, a hoy). Un mes futuro lanza. */
function pointFor(
  month: Month,
  snapshots: ReadonlyMap<Month, SnapshotLike>,
  lines: readonly MetricsLine[],
  today: CivilDate,
): MrrPoint {
  const { asOf, closed } = monthCutoff(month, today);
  const snapshot = closed ? snapshots.get(month) : undefined;
  if (snapshot) return { month, mrrCents: snapshot.mrrCents, source: "snapshot", estimated: snapshot.isEstimated };
  return { month, mrrCents: orgMrrCents(lines, asOf), source: closed ? "rebuilt" : "current", estimated: closed };
}

/** MRR al cierre de cada mes. */
export function mrrHistory(
  months: readonly Month[],
  snapshots: ReadonlyMap<Month, SnapshotLike>,
  lines: readonly MetricsLine[],
  today: CivilDate,
): MrrPoint[] {
  return months.map((month) => pointFor(month, snapshots, lines, today));
}

/**
 * Movimientos de cada mes de `months` (consecutivos), empezando en el cierre del mes anterior
 * al primero. El inicio y el final de cada mes son los del histórico de MRR, así que todo
 * encadena: inicio + movimientos + ajuste = final, mes a mes.
 */
export function movementsHistory(
  months: readonly Month[],
  snapshots: ReadonlyMap<Month, SnapshotLike>,
  lines: readonly MetricsLine[],
  today: CivilDate,
): MonthMovements[] {
  const first = months[0];
  if (first === undefined) return [];
  let previous = pointFor(addMonths(first, -1), snapshots, lines, today);
  const result: MonthMovements[] = [];
  for (const month of months) {
    const point = pointFor(month, snapshots, lines, today);
    const snapshot = point.source === "snapshot" ? snapshots.get(month) : undefined;
    const parts = snapshot
      ? {
          newCents: snapshot.newMrrCents,
          expansionCents: snapshot.expansionMrrCents,
          contractionCents: snapshot.contractionMrrCents,
          churnCents: snapshot.churnMrrCents,
        }
      : mrrMovements(lines, monthEnd(addMonths(month, -1)), monthCutoff(month, today).asOf);
    const net = parts.newCents + parts.expansionCents - parts.contractionCents - parts.churnCents;
    result.push({
      month,
      source: point.source,
      estimated: point.estimated,
      startCents: previous.mrrCents,
      newCents: parts.newCents,
      expansionCents: parts.expansionCents,
      contractionCents: parts.contractionCents,
      churnCents: parts.churnCents,
      endCents: point.mrrCents,
      adjustmentCents: point.mrrCents - previous.mrrCents - net,
    });
    previous = point;
  }
  return result;
}

export type MrrBridge = MrrMovements & {
  adjustmentCents: Cents;
  /** Meses que cubre el puente. */
  months: number;
  /** Algún mes del puente es una reconstrucción. */
  estimated: boolean;
};

/**
 * El puente de MRR de los últimos `count` meses del histórico: MRR inicial, cada tipo de
 * movimiento sumado, ajustes y MRR final. inicio + nuevo + expansión − contracción − churn +
 * ajustes = final, siempre.
 */
export function mrrBridge(history: readonly MonthMovements[], count: number): MrrBridge {
  const slice = history.slice(-count);
  const sum = (pick: (m: MonthMovements) => Cents) => slice.reduce((total, m) => total + pick(m), 0);
  return {
    months: slice.length,
    startCents: slice[0]?.startCents ?? 0,
    newCents: sum((m) => m.newCents),
    expansionCents: sum((m) => m.expansionCents),
    contractionCents: sum((m) => m.contractionCents),
    churnCents: sum((m) => m.churnCents),
    adjustmentCents: sum((m) => m.adjustmentCents),
    endCents: slice.at(-1)?.endCents ?? 0,
    estimated: slice.some((m) => m.estimated),
  };
}
