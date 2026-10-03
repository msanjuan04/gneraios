import "server-only";
import { readOrgModules } from "@/domain/org";
import { addDays, type CivilDate } from "@/domain/dates/civil-date";
import {
  type MonthRevenue,
  monthOf,
  monthsEndingAt,
  mrrGoalProgress,
  type MrrGoalProgress,
  mrrHistory,
  readGoals,
  revenueByMonth,
  revenueGoalProgress,
  type RevenueGoalProgress,
  type SnapshotLike,
} from "@/domain/metrics";
import type { Tables } from "@/lib/supabase/database.types";
import { type Db, fetchAll, must } from "@/server/billing/context";
import { getBillingForecast } from "@/server/billing/forecast";
import { loadUpcomingWeek, type UpcomingWeek } from "@/server/calendar/upcoming";
import { type ActionQueueItem, loadActionQueue } from "@/server/metrics/action-queue";
import { loadMetricsLines, loadRevenueRows } from "@/server/metrics/sources";
import { mondayOf } from "./monday";

// Lo que cuenta el resumen semanal de una org, con el cliente que se le pase: el del cron (clave
// secreta, así que todo filtra por org_id a mano) o el de un socio (vista previa, con RLS).

export type DigestOrg = Pick<Tables<"orgs">, "id" | "slug" | "name" | "timezone" | "settings" | "locale" | "currency">;

export type DigestOrgData = {
  /** Lunes de la semana que empieza y domingo de la que acaba de terminar. */
  weekStart: CivilDate;
  lastWeek: { from: CivilDate; to: CivilDate; collectedCents: number; invoicedNetCents: number; invoicesIssued: number; newDeals: number };
  mrrCents: number;
  receivables: { outstandingCents: number; overdueCents: number; overdueCount: number };
  goals: { mrr: MrrGoalProgress | null; revenue: RevenueGoalProgress | null };
  queue: ActionQueueItem[];
  /** Recomendaciones nuevas del consejo, las más urgentes primero (como mucho 3). */
  council: { id: string; title: string; agent: string; urgency: "hoy" | "esta_semana" | "este_mes" }[];
  money: { locale: string; currency: string };
};

export async function loadDigestOrgData(db: Db, org: DigestOrg, today: CivilDate): Promise<DigestOrgData> {
  const weekStart = mondayOf(today);
  const lastFrom = addDays(weekStart, -7);
  const lastTo = addDays(weekStart, -1);
  const current = monthOf(today);
  const months = monthsEndingAt(current, 13);
  const goals = readGoals(org.settings);
  const yearStart = goals.revenueYear ? `${goals.revenueYear.year}-01-01` : months[0]!;

  const [payments, issued, open, newDeals, snapshots, lines, revenueRows, forecast, queue, council] = await Promise.all([
    fetchAll(
      (from, to) =>
        db.from("payments").select("amount_cents").eq("org_id", org.id).gte("paid_on", lastFrom).lte("paid_on", lastTo).order("id").range(from, to),
      "digest.payments",
    ),
    fetchAll(
      (from, to) =>
        db
          .from("invoices_overview")
          .select("net_total_cents")
          .eq("org_id", org.id)
          .gte("issued_on", lastFrom)
          .lte("issued_on", lastTo)
          .in("status", ["issued", "overdue", "paid"])
          .order("id")
          .range(from, to),
      "digest.issued",
    ),
    fetchAll(
      (from, to) =>
        db.from("invoices_overview").select("status, outstanding_cents").eq("org_id", org.id).in("status", ["issued", "overdue"]).order("id").range(from, to),
      "digest.open",
    ),
    db
      .from("deals")
      .select("id", { count: "exact", head: true })
      .eq("org_id", org.id)
      .gte("created_at", `${lastFrom}T00:00:00Z`)
      .lt("created_at", `${weekStart}T00:00:00Z`),
    db
      .from("metrics_snapshots")
      .select("month, mrr_cents, new_mrr_cents, expansion_mrr_cents, contraction_mrr_cents, churn_mrr_cents, is_estimated")
      .eq("org_id", org.id)
      .gte("month", months[0]!),
    loadMetricsLines(db, org.id, org.timezone),
    loadRevenueRows(db, org.id, monthOf(yearStart), current),
    getBillingForecast(db, org.id, today, 13),
    loadActionQueue(db, org),
    // Con el consejo apagado, el resumen no pregunta por sus recomendaciones ni lleva su bloque.
    readOrgModules(org.settings).council
      ? db
          .from("recommendations")
          .select("id, title, agent, urgency, created_at")
          .eq("org_id", org.id)
          .eq("status", "nueva")
          .order("created_at", { ascending: false })
          .limit(20)
      : { data: [] },
  ]);
  const URGENCY_RANK = { hoy: 0, esta_semana: 1, este_mes: 2 } as const;
  const councilRows = (council.data ?? [])
    .sort((a, b) => URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency])
    .slice(0, 3)
    .map((r) => ({ id: r.id, title: r.title, agent: r.agent, urgency: r.urgency }));

  const byMonth = new Map<string, SnapshotLike>(
    must(snapshots, "digest.snapshots").map((s) => [
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
  const mrrPoints = mrrHistory(months, byMonth, lines, today);
  const mrrCents = mrrPoints[mrrPoints.length - 1]?.mrrCents ?? 0;
  const revenueMonths = goals.revenueYear ? monthsEndingAt(current, 12).filter((m) => m >= yearStart) : [];
  const revenue: MonthRevenue[] = revenueByMonth(revenueRows, revenueMonths);

  return {
    weekStart,
    lastWeek: {
      from: lastFrom,
      to: lastTo,
      collectedCents: payments.reduce((sum, p) => sum + p.amount_cents, 0),
      invoicedNetCents: issued.reduce((sum, i) => sum + (i.net_total_cents ?? 0), 0),
      invoicesIssued: issued.length,
      newDeals: newDeals.count ?? 0,
    },
    mrrCents,
    receivables: {
      outstandingCents: open.reduce((sum, i) => sum + (i.outstanding_cents ?? 0), 0),
      overdueCents: open.filter((i) => i.status === "overdue").reduce((sum, i) => sum + (i.outstanding_cents ?? 0), 0),
      overdueCount: open.filter((i) => i.status === "overdue").length,
    },
    goals: {
      mrr: goals.mrr ? mrrGoalProgress(goals.mrr, mrrCents, mrrPoints.slice(-12).map((p) => ({ cents: p.mrrCents })), today) : null,
      revenue: goals.revenueYear ? revenueGoalProgress(goals.revenueYear, revenue, forecast, today) : null,
    },
    queue,
    council: councilRows,
    money: { locale: org.locale, currency: org.currency },
  };
}

/** La semana del calendario para un socio: lo suyo y lo que es de todos. */
export function loadDigestWeek(db: Db, org: DigestOrg, memberId: string): Promise<UpcomingWeek> {
  return loadUpcomingWeek(db, { org, member: { id: memberId } }, { mine: true });
}
