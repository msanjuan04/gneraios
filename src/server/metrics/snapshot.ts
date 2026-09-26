// Sin "server-only": el seed de la demo guarda las fotos de sus 18 meses con estas funciones.
//
// Fotos mensuales de métricas (ARCHITECTURE.md §6.3, §7.8). La foto de un mes se toma cuando
// el mes ha cerrado y describe su último día: MRR y movimientos desde las líneas de contrato
// (definición en TS), ingresos desde las facturas emitidas en el mes y el resto con el estado
// de facturas, clientes y deals de ese día (funciones "_on" de la base de datos). Así la foto
// sale igual se calcule el día 1 o, en el seed, simulando el pasado.
//
// Uso en el cron diario (una vez por org, con el "hoy" de la org):
//     await savePreviousMonthSnapshot(admin, orgId, { today });
// Es idempotente: si la foto ya existe no hace nada, así que llamarla cada día (no solo el
// día 1) recupera un día 1 fallido. En el seed, tras el cron del día 1 de cada mes simulado:
//     await saveMonthSnapshot(admin, orgId, previousMonth(month), { today: month });

import type { CivilDate } from "@/domain/dates/civil-date";
import {
  assertMonth,
  buildMonthSnapshot,
  isLateSnapshot,
  monthCutoff,
  previousMonth,
  type MonthSnapshot,
  type Month,
} from "@/domain/metrics";
import { nowInZone } from "@/lib/clock";
import type { Tables, TablesInsert } from "@/lib/supabase/database.types";
import { type Db, must } from "@/server/billing/context";
import { loadClientStatusesOn, loadMetricsLines, loadOpenDealsOn, loadOpenInvoicesOn, loadRevenueRows } from "./sources";

/** El mes pedido aún no ha cerrado: su foto no se puede congelar. */
export class MonthNotClosedError extends Error {
  constructor(readonly month: Month) {
    super(`month_not_closed:${month}`);
    this.name = "MonthNotClosedError";
  }
}

export type SaveSnapshotResult = { created: boolean; snapshot: MonthSnapshot };

async function orgTimeZone(db: Db, orgId: string): Promise<string> {
  return must(await db.from("orgs").select("timezone").eq("id", orgId).single(), "metrics.org").timezone;
}

async function computeAt(db: Db, orgId: string, month: Month, today: CivilDate, timeZone: string): Promise<MonthSnapshot> {
  const { asOf, closed } = monthCutoff(month, today);
  const [lines, revenue, clientStatuses, invoices, deals] = await Promise.all([
    loadMetricsLines(db, orgId, timeZone),
    loadRevenueRows(db, orgId, month, month),
    loadClientStatusesOn(db, orgId, asOf),
    loadOpenInvoicesOn(db, orgId, asOf),
    loadOpenDealsOn(db, orgId, asOf),
  ]);
  return buildMonthSnapshot({
    month,
    asOf,
    lines,
    revenue,
    clientStatuses,
    invoices,
    deals,
    // Un mes en curso no es una foto: es el valor de hoy.
    isEstimated: closed && isLateSnapshot(month, today),
  });
}

/**
 * Cifras de un mes en su fecha de corte: el último día si ya ha cerrado, o hoy (en la zona de
 * la org, o `opts.today`) si está en curso. No guarda nada. Funciona con el cliente de un
 * miembro (RLS) y con el de servidor.
 */
export async function computeMonthSnapshot(
  db: Db,
  orgId: string,
  month: Month,
  opts: { today?: CivilDate } = {},
): Promise<MonthSnapshot> {
  assertMonth(month);
  const timeZone = await orgTimeZone(db, orgId);
  return computeAt(db, orgId, month, opts.today ?? nowInZone(timeZone).date, timeZone);
}

function fromRow(row: Tables<"metrics_snapshots">): MonthSnapshot {
  return {
    month: row.month,
    mrrCents: row.mrr_cents,
    arrCents: row.arr_cents,
    newMrrCents: row.new_mrr_cents,
    expansionMrrCents: row.expansion_mrr_cents,
    contractionMrrCents: row.contraction_mrr_cents,
    churnMrrCents: row.churn_mrr_cents,
    activeClients: row.active_clients,
    revenueRecurringCents: row.revenue_recurring_cents,
    revenueUsageCents: row.revenue_usage_cents,
    revenueOneOffCents: row.revenue_one_off_cents,
    outstandingCents: row.outstanding_cents,
    overdueCents: row.overdue_cents,
    weightedPipelineOneOffCents: row.weighted_pipeline_one_off_cents,
    weightedPipelineMrrCents: row.weighted_pipeline_mrr_cents,
    definitionVersion: row.definition_version,
    isEstimated: row.is_estimated,
  };
}

function toRow(orgId: string, s: MonthSnapshot): TablesInsert<"metrics_snapshots"> {
  return {
    org_id: orgId,
    month: s.month,
    mrr_cents: s.mrrCents,
    arr_cents: s.arrCents,
    new_mrr_cents: s.newMrrCents,
    expansion_mrr_cents: s.expansionMrrCents,
    contraction_mrr_cents: s.contractionMrrCents,
    churn_mrr_cents: s.churnMrrCents,
    active_clients: s.activeClients,
    revenue_recurring_cents: s.revenueRecurringCents,
    revenue_usage_cents: s.revenueUsageCents,
    revenue_one_off_cents: s.revenueOneOffCents,
    outstanding_cents: s.outstandingCents,
    overdue_cents: s.overdueCents,
    weighted_pipeline_one_off_cents: s.weightedPipelineOneOffCents,
    weighted_pipeline_mrr_cents: s.weightedPipelineMrrCents,
    definition_version: s.definitionVersion,
    is_estimated: s.isEstimated,
  };
}

async function existing(admin: Db, orgId: string, month: Month): Promise<MonthSnapshot | null> {
  const { data, error } = await admin.from("metrics_snapshots").select("*").eq("org_id", orgId).eq("month", month).maybeSingle();
  if (error) throw error;
  return data ? fromRow(data) : null;
}

/**
 * Congela la foto de un mes cerrado (con el cliente de servidor: solo service_role escribe en
 * metrics_snapshots). Si ya existe no la toca y la devuelve con `created: false`: las fotos son
 * inmutables. Lanza MonthNotClosedError si el mes no ha cerrado en `opts.today` (por defecto,
 * hoy en la zona de la org). Si se toma más de SNAPSHOT_GRACE_DAYS días después del cierre, se
 * marca `is_estimated` (es una reconstrucción).
 */
export async function saveMonthSnapshot(
  admin: Db,
  orgId: string,
  month: Month,
  opts: { today?: CivilDate } = {},
): Promise<SaveSnapshotResult> {
  assertMonth(month);
  const timeZone = await orgTimeZone(admin, orgId);
  const today = opts.today ?? nowInZone(timeZone).date;
  if (!monthCutoff(month, today).closed) throw new MonthNotClosedError(month);

  const found = await existing(admin, orgId, month);
  if (found) return { created: false, snapshot: found };

  const snapshot = await computeAt(admin, orgId, month, today, timeZone);
  const { data, error } = await admin
    .from("metrics_snapshots")
    .upsert(toRow(orgId, snapshot), { onConflict: "org_id,month", ignoreDuplicates: true })
    .select("id");
  if (error) throw error;
  if (data.length > 0) return { created: true, snapshot };
  // Otra ejecución la ha guardado mientras se calculaba: manda la suya.
  const raced = await existing(admin, orgId, month);
  return { created: false, snapshot: raced ?? snapshot };
}

/**
 * La foto del mes anterior a hoy (en la zona de la org, o `opts.today`). Para el cron diario:
 * idempotente, así que se puede llamar cada día.
 */
export async function savePreviousMonthSnapshot(
  admin: Db,
  orgId: string,
  opts: { today?: CivilDate } = {},
): Promise<SaveSnapshotResult> {
  const today = opts.today ?? nowInZone(await orgTimeZone(admin, orgId)).date;
  return saveMonthSnapshot(admin, orgId, previousMonth(today), { today });
}
