// Un extracto del banco ya leído (de un fichero Norma 43 o de un CSV), en el mismo formato para los
// dos: los movimientos en orden cronológico, el periodo, los saldos si el fichero los trae y los
// avisos de lo que no cuadra. Aquí también se comprueba que cuadra y se calcula la huella.

import { addDays, compareCivil, type CivilDate } from "../dates/civil-date";
import { assertCents, type Cents } from "../money";

export type StatementFormat = "n43" | "csv";

export type StatementMovement = {
  /** Fecha de operación (la que manda). */
  bookedOn: CivilDate;
  valueOn: CivilDate | null;
  /** Con signo: positivo es un abono y negativo, un cargo. */
  amountCents: Cents;
  concept: string;
  counterparty: string | null;
  counterpartyIban: string | null;
  reference: string | null;
  /** Norma 43: concepto común y propio ("04", "12-105"). */
  bankCode: string | null;
  /** Saldo después del movimiento, si el fichero lo trae. */
  balanceAfterCents: Cents | null;
};

/** Avisos sobre el fichero: cada uno es una clave de i18n (banking.issues.<code>). */
export const STATEMENT_ISSUE_CODES = [
  // Norma 43
  "totalsMismatch",
  "balanceMismatch",
  "missingFooter",
  "missingEnd",
  "recordCount",
  "zeroAmount",
  // Los dos formatos
  "movementsBeforePeriod",
  "movementsAfterPeriod",
  // CSV
  "rowAmount",
  "rowDate",
  "balanceChain",
] as const;
export type StatementIssueCode = (typeof STATEMENT_ISSUE_CODES)[number];

export type StatementIssue = { code: StatementIssueCode; line?: number; params?: Record<string, string | number> };

export type StatementAccountRef = {
  /** Norma 43: entidad (4), oficina (4) y número de cuenta (10). */
  bank: string | null;
  branch: string | null;
  number: string | null;
  /** CSV: el IBAN que traiga la cabecera del fichero, si lo trae. */
  iban: string | null;
};

export type ParsedStatement = {
  format: StatementFormat;
  account: StatementAccountRef;
  holder: string | null;
  periodStart: CivilDate;
  periodEnd: CivilDate;
  /** Saldo al empezar el primer día (el del cierre del día anterior). */
  openingBalanceCents: Cents | null;
  /** Saldo al acabar el último día. */
  closingBalanceCents: Cents | null;
  movements: StatementMovement[];
  issues: StatementIssue[];
};

export type BalanceCheck =
  | { status: "ok"; openingCents: Cents; closingCents: Cents; movementsCents: Cents }
  | { status: "mismatch"; openingCents: Cents; closingCents: Cents; movementsCents: Cents; differenceCents: Cents }
  | { status: "unknown"; movementsCents: Cents };

/** Saldo inicial + movimientos = saldo final (si el fichero trae los dos saldos). */
export function checkBalances(statement: Pick<ParsedStatement, "openingBalanceCents" | "closingBalanceCents" | "movements">): BalanceCheck {
  const movementsCents = statement.movements.reduce((sum, m) => assertCents(sum + m.amountCents), 0);
  const { openingBalanceCents: opening, closingBalanceCents: closing } = statement;
  if (opening === null || closing === null) return { status: "unknown", movementsCents };
  const differenceCents = assertCents(closing - opening - movementsCents);
  if (differenceCents === 0) return { status: "ok", openingCents: opening, closingCents: closing, movementsCents };
  return { status: "mismatch", openingCents: opening, closingCents: closing, movementsCents, differenceCents };
}

/**
 * Huella de cada movimiento: fecha de operación, importe y nº de orden entre los movimientos con esa
 * misma fecha e importe ("2026-09-12|-999|1", "2026-09-12|-999|2"). Única por cuenta (la base de
 * datos lo garantiza), así que:
 * - un extracto que se solapa con otro ya importado no duplica ningún movimiento;
 * - dos movimientos idénticos del mismo día (dos cafés de 9,99 €) entran los dos;
 * - no depende del texto del concepto ni del orden dentro del día, que cambian entre el N43 y el CSV
 *   del mismo banco: el mismo día exportado dos veces da las mismas huellas.
 */
export function fingerprints(movements: readonly Pick<StatementMovement, "bookedOn" | "amountCents">[]): string[] {
  const seen = new Map<string, number>();
  return movements.map((m) => {
    const key = `${m.bookedOn}|${m.amountCents}`;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return `${key}|${n}`;
  });
}

/** El periodo que cubre un fichero: el declarado, ampliado si algún movimiento cae fuera (con aviso). */
export function coverPeriod(
  declared: { start: CivilDate | null; end: CivilDate | null },
  movements: readonly Pick<StatementMovement, "bookedOn">[],
  issues: StatementIssue[],
): { start: CivilDate; end: CivilDate } | null {
  const dates = movements.map((m) => m.bookedOn).sort(compareCivil);
  let start = declared.start ?? dates[0] ?? null;
  let end = declared.end ?? dates.at(-1) ?? null;
  if (!start || !end) return null;
  if (compareCivil(end, start) < 0) [start, end] = [end, start];
  const first = dates[0];
  const last = dates.at(-1);
  if (first && compareCivil(first, start) < 0) {
    issues.push({ code: "movementsBeforePeriod", params: { date: first } });
    start = first;
  }
  if (last && compareCivil(last, end) > 0) {
    issues.push({ code: "movementsAfterPeriod", params: { date: last } });
    end = last;
  }
  return { start, end };
}

/** El día cuyo cierre es el saldo inicial del extracto. */
export function openingBalanceDate(periodStart: CivilDate): CivilDate {
  return addDays(periodStart, -1);
}

export type StatementSummary = {
  movements: number;
  credits: { count: number; cents: Cents };
  debits: { count: number; cents: Cents };
};

export function summarizeMovements(movements: readonly Pick<StatementMovement, "amountCents">[]): StatementSummary {
  const summary: StatementSummary = { movements: movements.length, credits: { count: 0, cents: 0 }, debits: { count: 0, cents: 0 } };
  for (const m of movements) {
    const side = m.amountCents > 0 ? summary.credits : summary.debits;
    side.count += 1;
    side.cents = assertCents(side.cents + Math.abs(m.amountCents));
  }
  return summary;
}
