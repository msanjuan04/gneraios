import "server-only";
import type {
  ConcentrationView,
  DashboardView,
  HistoryPoint,
  OverdueRow,
  RenewalRow,
  StageRow,
  VerifactuRow,
} from "@/components/dashboard/types";
import { addDays, daysBetween } from "@/domain/dates/civil-date";
import { verifactuCountdown } from "@/domain/fiscal/verifactu";
import {
  arrCents,
  collectionStats,
  concentration,
  countActiveClients,
  cronHealth,
  linesInForce,
  monthEnd,
  monthOf,
  monthsEndingAt,
  movementsHistory,
  mrrHistory,
  pipelineByStage,
  receivables,
  revenueByMonth,
  upcomingRenewals,
  weightedPipeline,
  type ClientBilling,
  type Month,
  type SnapshotLike,
} from "@/domain/metrics";
import { nowInZone } from "@/lib/clock";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/server/billing/context";
import { BILLING_JOB } from "@/server/billing/engine";
import { getCrmConfig } from "@/server/crm/config";
import type { OrgContext } from "@/server/session";
import { loadClientBilling, loadClientStatusesOn, loadMetricsLines, loadRevenueRows, metricsSettings } from "./sources";

const HISTORY_MONTHS = 24;
const LIST_LIMIT = 6;

/** ¿Hay algo que medir? Sin contratos ni facturas emitidas, el dashboard es el de primeros pasos. */
export async function orgHasBusinessData(orgId: string): Promise<boolean> {
  const supabase = await createClient();
  const [contracts, invoices] = await Promise.all([
    supabase.from("contracts").select("id", { count: "exact", head: true }).eq("org_id", orgId),
    supabase.from("invoices").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("lifecycle", "issued"),
  ]);
  if (contracts.error) throw contracts.error;
  if (invoices.error) throw invoices.error;
  return (contracts.count ?? 0) + (invoices.count ?? 0) > 0;
}

function concentrationView(rows: readonly ClientBilling[], names: Map<string, string>, thresholdBps: number): ConcentrationView {
  const result = concentration(rows, { thresholdBps });
  return {
    rows: result.clients.slice(0, LIST_LIMIT).map((c) => ({ ...c, name: names.get(c.clientId) ?? "—" })),
    totalCents: result.totalCents,
    top1ShareBps: result.top1ShareBps,
    top3ShareBps: result.top3ShareBps,
    alert: result.alert,
    clientsCount: result.clients.length,
  };
}

/**
 * Todo lo que pinta el dashboard, con la sesión del usuario (RLS). Los meses cerrados salen de
 * sus fotos (metrics_snapshots) y, si no las tienen, se reconstruyen con las líneas de hoy
 * (marcados como estimados); el mes en curso es siempre el valor de hoy.
 */
export async function loadDashboard(ctx: OrgContext): Promise<DashboardView> {
  const { org, member } = ctx;
  const supabase = await createClient();
  const checkedAt = Date.now();
  const clock = nowInZone(org.timezone, new Date(checkedAt));
  const today = clock.date;
  const current = monthOf(today);
  const months = monthsEndingAt(current, HISTORY_MONTHS);
  const first = months[0]!;
  const settings = metricsSettings(org.settings);

  const [
    snapshots,
    revenueRows,
    lastYearBilling,
    clients,
    lines,
    openInvoices,
    paidInvoices,
    deals,
    crm,
    jobRuns,
    issuers,
    drafts,
    reminders,
  ] = await Promise.all([
    supabase
      .from("metrics_snapshots")
      .select("month, mrr_cents, new_mrr_cents, expansion_mrr_cents, contraction_mrr_cents, churn_mrr_cents, active_clients, is_estimated")
      .eq("org_id", org.id)
      .gte("month", monthOf(addDays(first, -1)))
      .order("month"),
    loadRevenueRows(supabase, org.id, first, current),
    loadClientBilling(supabase, org.id, months[HISTORY_MONTHS - 12]!, current),
    fetchAll(
      (from, to) =>
        supabase
          .from("clients_overview")
          .select("id, display_name, status, billed_net_cents")
          .eq("org_id", org.id)
          .order("id")
          .range(from, to),
      "dashboard.clients",
    ),
    loadMetricsLines(supabase, org.id, org.timezone),
    fetchAll(
      (from, to) =>
        supabase
          .from("invoices_overview")
          .select("id, number, kind, status, client_name, due_on, outstanding_cents")
          .eq("org_id", org.id)
          .in("status", ["issued", "overdue"])
          .order("due_on")
          .order("id")
          .range(from, to),
      "dashboard.openInvoices",
    ),
    fetchAll(
      (from, to) =>
        supabase
          .from("invoices_overview")
          .select("issued_on, due_on, last_paid_on")
          .eq("org_id", org.id)
          .eq("status", "paid")
          .eq("kind", "ordinary")
          .gte("last_paid_on", addDays(today, -365))
          .order("id")
          .range(from, to),
      "dashboard.paidInvoices",
    ),
    fetchAll(
      (from, to) =>
        supabase
          .from("deals_board")
          .select("id, stage_id, stage_kind, est_one_off_cents, est_mrr_cents, probability_bps")
          .eq("org_id", org.id)
          .eq("stage_kind", "open")
          .order("id")
          .range(from, to),
      "dashboard.deals",
    ),
    getCrmConfig(org.id),
    supabase
      .from("job_runs")
      .select("status, started_at, finished_at, error")
      .eq("org_id", org.id)
      .eq("job", BILLING_JOB)
      .order("started_at", { ascending: false })
      .limit(10),
    supabase
      .from("issuers")
      .select("id, legal_name, trade_name, verifactu_from, fiscal_provider")
      .eq("org_id", org.id)
      .is("archived_at", null),
    supabase.from("invoices").select("id", { count: "exact", head: true }).eq("org_id", org.id).eq("lifecycle", "draft"),
    supabase
      .from("outbound_emails")
      .select("id", { count: "exact", head: true })
      .eq("org_id", org.id)
      .eq("status", "pending_approval"),
  ]);
  for (const result of [snapshots, jobRuns, issuers, drafts, reminders]) if (result.error) throw result.error;

  // Histórico: 24 meses de ingresos (desde las facturas) y de MRR (fotos o reconstrucción).
  const snapshotRows = snapshots.data ?? [];
  const byMonth = new Map<Month, SnapshotLike>(
    snapshotRows.map((s) => [
      s.month,
      {
        month: s.month,
        mrrCents: s.mrr_cents,
        newMrrCents: s.new_mrr_cents,
        expansionMrrCents: s.expansion_mrr_cents,
        contractionMrrCents: s.contraction_mrr_cents,
        churnMrrCents: s.churn_mrr_cents,
        isEstimated: s.is_estimated,
      },
    ]),
  );
  const revenue = revenueByMonth(revenueRows, months);
  const mrrPoints = mrrHistory(months, byMonth, lines, today);
  const history: HistoryPoint[] = months.map((month, i) => ({
    ...revenue[i]!,
    mrrCents: mrrPoints[i]!.mrrCents,
    mrrSource: mrrPoints[i]!.source,
    mrrEstimated: mrrPoints[i]!.estimated,
  }));
  const movements = movementsHistory(months, byMonth, lines, today);
  const now = mrrPoints.at(-1)!;
  const previous = mrrPoints.at(-2)!;
  const yearAgo = mrrPoints.at(-13)!;

  // Clientes: estado de hoy (clients_overview) y activos al cierre del mes anterior.
  const names = new Map(clients.map((c) => [c.id!, c.display_name ?? "—"]));
  const statusCount = (status: string) => clients.filter((c) => c.status === status).length;
  const previousMonth = months.at(-2)!;
  const previousSnapshot = snapshotRows.find((s) => s.month === previousMonth);
  const activePrevious = previousSnapshot
    ? previousSnapshot.active_clients
    : countActiveClients(await loadClientStatusesOn(supabase, org.id, monthEnd(previousMonth)));

  // Cobros.
  const receivableRows = openInvoices.map((i) => ({
    kind: i.kind ?? "ordinary",
    status: i.status ?? "issued",
    outstandingCents: i.outstanding_cents ?? 0,
  }));
  const overdueRows: OverdueRow[] = openInvoices
    .filter((i) => i.status === "overdue" && i.kind === "ordinary" && i.id && i.due_on)
    .map((i) => ({
      invoiceId: i.id!,
      number: i.number ?? "—",
      clientName: i.client_name ?? "—",
      dueOn: i.due_on!,
      daysOverdue: daysBetween(i.due_on!, today),
      outstandingCents: i.outstanding_cents ?? 0,
    }))
    .sort((a, b) => b.daysOverdue - a.daysOverdue || b.outstandingCents - a.outstandingCents);

  // Pipeline.
  const pipelineDeals = deals.flatMap((d) =>
    d.stage_id && d.stage_kind
      ? [
          {
            stageId: d.stage_id,
            stageKind: d.stage_kind,
            estOneOffCents: d.est_one_off_cents ?? 0,
            estMrrCents: d.est_mrr_cents ?? 0,
            probabilityBps: d.probability_bps ?? 0,
          },
        ]
      : [],
  );
  const stageNames = new Map(crm.stages.map((s) => [s.id, s.name]));
  const stages: StageRow[] = pipelineByStage(pipelineDeals, crm.stages).map((s) => ({
    stageId: s.stageId,
    name: stageNames.get(s.stageId) ?? "—",
    deals: s.deals,
    oneOffCents: s.oneOffCents,
    mrrCents: s.mrrCents,
    weightedOneOffCents: s.weighted.oneOffCents,
    weightedMrrCents: s.weighted.mrrCents,
  }));

  // Renovaciones anuales dentro de la ventana de la org.
  const renewals: RenewalRow[] = upcomingRenewals(linesInForce(lines, today), today, settings.renewalWindowDays).map((r) => ({
    lineId: r.line.id,
    contractId: r.line.contractId,
    clientName: names.get(r.line.clientId) ?? "—",
    description: r.line.description,
    renewsOn: r.renewsOn,
    daysLeft: r.daysLeft,
    amountCents: r.amountCents,
  }));

  // Salud: el cron diario y la cuenta atrás de Verifactu de cada emisor con el proveedor interno.
  const verifactu: VerifactuRow[] = (issuers.data ?? [])
    .filter((i) => i.fiscal_provider === "internal")
    .map((i) => ({
      issuerId: i.id,
      name: i.trade_name || i.legal_name,
      verifactuFrom: i.verifactu_from,
      countdown: verifactuCountdown(i.verifactu_from, today),
    }))
    .sort((a, b) => a.verifactuFrom.localeCompare(b.verifactuFrom));

  return {
    basePath: `/${org.slug}`,
    firstName: member.fullName.split(" ")[0] ?? member.fullName,
    today,
    hour: clock.hour,
    money: { locale: org.locale, currency: org.currency },
    mrr: {
      cents: now.mrrCents,
      previousCents: previous.mrrCents,
      previousEstimated: previous.estimated,
      sparkline: mrrPoints.slice(-12).map((p) => ({ month: p.month, cents: p.mrrCents, estimated: p.estimated })),
    },
    arr: { cents: arrCents(now.mrrCents), yearAgoCents: yearAgo.mrrCents > 0 ? arrCents(yearAgo.mrrCents) : null },
    revenue: { current: revenue.at(-1)!, previous: revenue.at(-2)!, lastYear: revenue.at(-13)! },
    receivables: receivables(receivableRows),
    collection: collectionStats(
      paidInvoices.flatMap((i) =>
        i.issued_on && i.last_paid_on ? [{ issuedOn: i.issued_on, dueOn: i.due_on, paidOn: i.last_paid_on }] : [],
      ),
    ),
    pipeline: weightedPipeline(pipelineDeals),
    clients: {
      active: statusCount("active"),
      paused: statusCount("paused"),
      former: statusCount("former"),
      leads: statusCount("lead"),
      activePrevious,
    },
    history,
    movements,
    topClients: {
      lastYear: concentrationView(lastYearBilling, names, settings.concentrationAlertBps),
      allTime: concentrationView(
        clients.map((c) => ({ clientId: c.id!, cents: c.billed_net_cents ?? 0 })),
        names,
        settings.concentrationAlertBps,
      ),
      thresholdBps: settings.concentrationAlertBps,
    },
    renewals,
    renewalWindowDays: settings.renewalWindowDays,
    overdue: { rows: overdueRows.slice(0, LIST_LIMIT), count: overdueRows.length },
    stages,
    health: {
      checkedAt: new Date(checkedAt).toISOString(),
      cron: cronHealth(
        (jobRuns.data ?? []).map((r) => ({ status: r.status, startedAt: r.started_at, finishedAt: r.finished_at, error: r.error })),
        checkedAt,
      ),
      verifactu,
      drafts: drafts.count ?? 0,
      remindersToApprove: reminders.count ?? 0,
    },
  };
}
