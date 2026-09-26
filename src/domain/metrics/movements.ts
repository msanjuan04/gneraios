// MRR de la org y sus movimientos (ARCHITECTURE.md §7.8, definiciones v1 en definitions.ts).
// Todo se calcula en doceavos de céntimo (exacto) y se redondea una sola vez por cifra.

import { compareCivil, type CivilDate } from "../dates/civil-date";
import type { Cents } from "../money";
import { mrrTwelfths, twelfthsToCents, type MrrLine } from "./mrr";

/** Línea de contrato tal como la ven las métricas de la org. */
export type MetricsLine = MrrLine & {
  clientId: string;
  /** Firma del contrato: sus líneas cuentan desde ese día. */
  signedOn: CivilDate;
  /** Día (en la zona de la org) en que se archivó el contrato; desde ese día no cuenta. */
  archivedOn: CivilDate | null;
};

export type MrrMovements = {
  /** MRR al empezar el periodo (cierre del mes anterior). */
  startCents: Cents;
  newCents: Cents;
  expansionCents: Cents;
  contractionCents: Cents;
  churnCents: Cents;
  /** MRR al final: start + new + expansion − contraction − churn, al céntimo. */
  endCents: Cents;
};

const ZERO = BigInt(0);

/** Las líneas de contratos firmados y no archivados en `date`. */
export function linesInForce<T extends MetricsLine>(lines: readonly T[], date: CivilDate): T[] {
  return lines.filter(
    (line) =>
      compareCivil(line.signedOn, date) <= 0 && (line.archivedOn === null || compareCivil(date, line.archivedOn) < 0),
  );
}

/** MRR de la org en una fecha (definición v1). */
export function orgMrrCents(lines: readonly MetricsLine[], date: CivilDate): Cents {
  return twelfthsToCents(mrrTwelfths(linesInForce(lines, date), date));
}

type ClientState = { twelfths: bigint; paused: boolean };

const isRecurring = (line: MetricsLine) => line.billingType === "monthly" || line.billingType === "yearly";

/** Dentro de su vigencia pero en una pausa en `date`. */
function pausedOn(line: MetricsLine, date: CivilDate): boolean {
  if (!isRecurring(line) || line.startsOn === null) return false;
  if (compareCivil(date, line.startsOn) < 0) return false;
  if (line.endsOn !== null && compareCivil(date, line.endsOn) > 0) return false;
  return line.pauses.some(
    (p) => compareCivil(p.startsOn, date) <= 0 && (p.endsOn === null || compareCivil(date, p.endsOn) <= 0),
  );
}

/** MRR exacto y "tiene algo en pausa" de cada cliente en una fecha. */
function clientStates(lines: readonly MetricsLine[], date: CivilDate): Map<string, ClientState> {
  const byClient = new Map<string, MetricsLine[]>();
  for (const line of linesInForce(lines, date)) {
    if (!isRecurring(line)) continue;
    const list = byClient.get(line.clientId) ?? [];
    list.push(line);
    byClient.set(line.clientId, list);
  }
  const states = new Map<string, ClientState>();
  for (const [clientId, clientLines] of byClient) {
    states.set(clientId, {
      twelfths: mrrTwelfths(clientLines, date),
      paused: clientLines.some((line) => pausedOn(line, date)),
    });
  }
  return states;
}

/**
 * Redondeo acumulado: cada cifra es la diferencia entre los redondeos de dos totales
 * consecutivos (inicio → +nuevo → +expansión → −contracción → −churn). Así el puente cuadra
 * al céntimo con los dos MRR redondeados y ninguna cifra cambia de signo ni se aleja más de
 * un céntimo de su valor exacto.
 */
function roundBridge(start: bigint, newT: bigint, expansion: bigint, contraction: bigint, churn: bigint): MrrMovements {
  const p1 = start + newT;
  const p2 = p1 + expansion;
  const p3 = p2 - contraction;
  const p4 = p3 - churn;
  const [r0, r1, r2, r3, r4] = [start, p1, p2, p3, p4].map(twelfthsToCents) as [Cents, Cents, Cents, Cents, Cents];
  return {
    startCents: r0,
    newCents: r1 - r0,
    expansionCents: r2 - r1,
    contractionCents: r2 - r3,
    churnCents: r3 - r4,
    endCents: r4,
  };
}

/**
 * Movimientos de MRR entre dos fechas (normalmente el cierre de un mes y el del siguiente),
 * cliente a cliente (ver definitions.ts).
 */
export function mrrMovements(lines: readonly MetricsLine[], from: CivilDate, to: CivilDate): MrrMovements {
  if (compareCivil(from, to) > 0) throw new Error(`Periodo no válido: ${from} → ${to}`);
  const before = clientStates(lines, from);
  const after = clientStates(lines, to);
  let start = ZERO;
  let newT = ZERO;
  let expansion = ZERO;
  let contraction = ZERO;
  let churn = ZERO;

  for (const clientId of new Set([...before.keys(), ...after.keys()])) {
    const prev = before.get(clientId) ?? { twelfths: ZERO, paused: false };
    const cur = after.get(clientId) ?? { twelfths: ZERO, paused: false };
    start += prev.twelfths;
    if (prev.twelfths === ZERO && cur.twelfths > ZERO) {
      if (prev.paused) expansion += cur.twelfths;
      else newT += cur.twelfths;
    } else if (prev.twelfths > ZERO && cur.twelfths === ZERO) {
      if (cur.paused) contraction += prev.twelfths;
      else churn += prev.twelfths;
    } else if (cur.twelfths > prev.twelfths) {
      expansion += cur.twelfths - prev.twelfths;
    } else if (cur.twelfths < prev.twelfths) {
      contraction += prev.twelfths - cur.twelfths;
    }
  }
  return roundBridge(start, newT, expansion, contraction, churn);
}
