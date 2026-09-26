// Emisor de un contrato en cada fecha (ARCHITECTURE.md §7.7). El traspaso a la SL inserta
// una asignación nueva con su fecha; nunca se copia el contrato. Cada periodo lo factura el
// emisor vigente en su fecha de inicio (devengo), no el del día en que se emite la factura.
// Gemela SQL: private.contract_issuer_on (misma regla).

import { compareCivil, parseCivilDate, type CivilDate } from "../dates/civil-date";

export type IssuerAssignment = { issuerId: string; validFrom: CivilDate };

/**
 * El emisor con el mayor `validFrom` que no supere `date`. Si la fecha es anterior a todas las
 * asignaciones, la primera: así el emisor con el que nace el contrato cubre también su pasado.
 */
export function issuerOn(assignments: readonly IssuerAssignment[], date: CivilDate): string | null {
  parseCivilDate(date);
  if (assignments.length === 0) return null;
  const sorted = [...assignments].sort((a, b) => compareCivil(a.validFrom, b.validFrom));
  let current = sorted[0]!;
  for (const assignment of sorted) {
    if (compareCivil(assignment.validFrom, date) <= 0) current = assignment;
  }
  return current.issuerId;
}
