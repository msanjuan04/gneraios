// Foto mensual de métricas (ARCHITECTURE.md §6.3, §7.8): todas las cifras de un mes en su fecha
// de corte, con las definiciones de definitions.ts. Puro: el servidor carga las filas y llama aquí.

import { daysBetween, type CivilDate } from "../dates/civil-date";
import type { Cents } from "../money";
import { METRICS_DEFINITION_VERSION, SNAPSHOT_GRACE_DAYS } from "./definitions";
import { addMonths, monthEnd, type Month } from "./months";
import { mrrMovements, type MetricsLine } from "./movements";
import { arrCents } from "./mrr";
import { weightedPipeline, type PipelineDeal } from "./pipeline";
import { receivables, type ReceivableRow } from "./receivables";
import { revenueByMonth, type RevenueRow } from "./revenue";

export type ClientStatus = "lead" | "active" | "paused" | "former";

export type MonthSnapshot = {
  month: Month;
  mrrCents: Cents;
  arrCents: Cents;
  newMrrCents: Cents;
  expansionMrrCents: Cents;
  contractionMrrCents: Cents;
  churnMrrCents: Cents;
  activeClients: number;
  revenueRecurringCents: Cents;
  revenueUsageCents: Cents;
  revenueOneOffCents: Cents;
  outstandingCents: Cents;
  overdueCents: Cents;
  weightedPipelineOneOffCents: Cents;
  weightedPipelineMrrCents: Cents;
  definitionVersion: number;
  isEstimated: boolean;
};

export type SnapshotSources = {
  month: Month;
  /** Fecha de corte: el último día del mes, o hoy si está en curso (monthCutoff). */
  asOf: CivilDate;
  lines: readonly MetricsLine[];
  /** Filas de ingresos (al menos las del mes). */
  revenue: readonly RevenueRow[];
  /** Estado de cada cliente en la fecha de corte. */
  clientStatuses: readonly { status: ClientStatus }[];
  /** Facturas con su estado en la fecha de corte. */
  invoices: readonly ReceivableRow[];
  /** Deals con su etapa y probabilidad en la fecha de corte. */
  deals: readonly PipelineDeal[];
  isEstimated: boolean;
};

/** Clientes en estado activo (§6.4). */
export function countActiveClients(rows: readonly { status: ClientStatus }[]): number {
  return rows.filter((row) => row.status === "active").length;
}

/**
 * ¿La foto de `month` tomada hoy es una reconstrucción? Sí si se toma más de
 * SNAPSHOT_GRACE_DAYS días después del día de cierre (el día 1 del mes siguiente).
 */
export function isLateSnapshot(month: Month, today: CivilDate): boolean {
  return daysBetween(monthEnd(month), today) > 1 + SNAPSHOT_GRACE_DAYS;
}

export function buildMonthSnapshot(sources: SnapshotSources): MonthSnapshot {
  const movements = mrrMovements(sources.lines, monthEnd(addMonths(sources.month, -1)), sources.asOf);
  const [revenue] = revenueByMonth(sources.revenue, [sources.month]);
  const money = receivables(sources.invoices);
  const pipeline = weightedPipeline(sources.deals);
  return {
    month: sources.month,
    mrrCents: movements.endCents,
    arrCents: arrCents(movements.endCents),
    newMrrCents: movements.newCents,
    expansionMrrCents: movements.expansionCents,
    contractionMrrCents: movements.contractionCents,
    churnMrrCents: movements.churnCents,
    activeClients: countActiveClients(sources.clientStatuses),
    revenueRecurringCents: revenue!.recurringCents,
    revenueUsageCents: revenue!.usageCents,
    revenueOneOffCents: revenue!.oneOffCents,
    outstandingCents: money.outstandingCents,
    overdueCents: money.overdueCents,
    weightedPipelineOneOffCents: pipeline.oneOffCents,
    weightedPipelineMrrCents: pipeline.mrrCents,
    definitionVersion: METRICS_DEFINITION_VERSION,
    isEstimated: sources.isEstimated,
  };
}
