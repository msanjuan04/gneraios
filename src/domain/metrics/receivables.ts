// Cobros (ARCHITECTURE.md §7.8). Se miden con IVA y netos de IRPF (lo que el cliente tiene que
// pagar), no en base imponible como los ingresos: las pantallas lo dicen siempre.
//
// El estado de cada factura (emitida, vencida, cobrada, anulada) sale de la base de datos
// (`invoices_overview` hoy, `open_invoices_on` en una fecha de corte); aquí solo se suma.

import { daysBetween, type CivilDate } from "../dates/civil-date";
import { assertCents, type Cents } from "../money";

export type InvoiceStatus = "draft" | "issuing" | "issued" | "overdue" | "paid" | "voided";

export type ReceivableRow = {
  /** Las rectificativas no se cobran: restan de su factura original. */
  kind: "ordinary" | "rectifying";
  status: InvoiceStatus;
  outstandingCents: Cents;
};

export type Receivables = {
  /** Pendiente de cobro: facturas emitidas no cobradas (con IVA, neto de IRPF). */
  outstandingCents: Cents;
  /** La parte vencida del pendiente. */
  overdueCents: Cents;
  openCount: number;
  overdueCount: number;
};

/**
 * Pendiente y vencido de un conjunto de facturas: solo las ordinarias emitidas o vencidas (las
 * cobradas, anuladas, en borrador y las rectificativas no suman).
 */
export function receivables(rows: readonly ReceivableRow[]): Receivables {
  let outstandingCents = 0;
  let overdueCents = 0;
  let openCount = 0;
  let overdueCount = 0;
  for (const row of rows) {
    if (row.kind !== "ordinary" || (row.status !== "issued" && row.status !== "overdue")) continue;
    outstandingCents = assertCents(outstandingCents + row.outstandingCents);
    openCount += 1;
    if (row.status === "overdue") {
      overdueCents = assertCents(overdueCents + row.outstandingCents);
      overdueCount += 1;
    }
  }
  return { outstandingCents, overdueCents, openCount, overdueCount };
}

export type PaidInvoice = {
  issuedOn: CivilDate;
  dueOn: CivilDate | null;
  /** Fecha del cobro que la dejó cobrada (el último). */
  paidOn: CivilDate;
};

export type CollectionStats = {
  paidCount: number;
  /** Días medios de la emisión al cobro completo, con un decimal; null sin facturas cobradas. */
  avgDaysToPay: number | null;
  /** Parte de las cobradas en plazo (cobro ≤ vencimiento), de 0 a 1; null sin vencimientos. */
  onTimeShare: number | null;
  /** Días medios de retraso de las que se cobraron tarde, con un decimal; null si ninguna. */
  avgDaysLate: number | null;
};

const oneDecimal = (value: number) => Math.round(value * 10) / 10;

/** Cómo se cobra: días hasta el cobro, puntualidad y retraso medio de las cobradas. */
export function collectionStats(rows: readonly PaidInvoice[]): CollectionStats {
  if (rows.length === 0) return { paidCount: 0, avgDaysToPay: null, onTimeShare: null, avgDaysLate: null };
  let totalDays = 0;
  let withDue = 0;
  let onTime = 0;
  let lateDays = 0;
  let lateCount = 0;
  for (const row of rows) {
    totalDays += Math.max(0, daysBetween(row.issuedOn, row.paidOn));
    if (row.dueOn === null) continue;
    withDue += 1;
    const late = daysBetween(row.dueOn, row.paidOn);
    if (late <= 0) onTime += 1;
    else {
      lateDays += late;
      lateCount += 1;
    }
  }
  return {
    paidCount: rows.length,
    avgDaysToPay: oneDecimal(totalDays / rows.length),
    onTimeShare: withDue > 0 ? onTime / withDue : null,
    avgDaysLate: lateCount > 0 ? oneDecimal(lateDays / lateCount) : null,
  };
}
