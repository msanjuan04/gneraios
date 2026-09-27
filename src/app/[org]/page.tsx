import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { UpcomingWeekCard } from "@/components/calendar/upcoming-week-card";
import { ActionQueueCard } from "@/components/dashboard/action-queue-card";
import { Dashboard } from "@/components/dashboard/dashboard";
import { GoalsCard } from "@/components/dashboard/goals-card";
import { MyTasksCard } from "@/components/projects/my-tasks-card";
import { DashboardHome } from "@/components/dashboard/dashboard-home";
import { mrrGoalProgress, readGoals, revenueGoalProgress } from "@/domain/metrics/goals";
import { nowInZone } from "@/lib/clock";
import { createClient } from "@/lib/supabase/server";
import { getBillingForecast } from "@/server/billing/forecast";
import { loadUpcomingWeek } from "@/server/calendar/upcoming";
import { loadActionQueue } from "@/server/metrics/action-queue";
import { getMyTasksCard } from "@/server/projects/cards";
import { loadDashboard, orgHasBusinessData } from "@/server/metrics/dashboard";
import { getOrgContext, hasRole, type OrgContext } from "@/server/session";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("dashboard"))("title") };
}

/** Primeros pasos: lo que ve una org que aún no tiene contratos ni facturas. */
async function Onboarding({ ctx }: { ctx: OrgContext }) {
  const { org, member } = ctx;
  const supabase = await createClient();
  const [issuers, members, invites, clients, catalog, google] = await Promise.all([
    supabase
      .from("issuers")
      .select("kind, legal_name, tax_id, is_primary, verifactu_from, fiscal_provider")
      .eq("org_id", org.id)
      .is("archived_at", null),
    supabase.from("members").select("id", { count: "exact", head: true }).eq("org_id", org.id).eq("is_active", true),
    supabase
      .from("member_invitations")
      .select("id", { count: "exact", head: true })
      .eq("org_id", org.id)
      .is("accepted_at", null),
    supabase.from("clients").select("id", { count: "exact", head: true }).eq("org_id", org.id).is("archived_at", null),
    supabase.from("catalog_items").select("id", { count: "exact", head: true }).eq("org_id", org.id).eq("is_active", true),
    supabase.from("integrations").select("id", { count: "exact", head: true }).eq("org_id", org.id).eq("status", "connected"),
  ]);
  const clock = nowInZone(org.timezone);

  return (
    <DashboardHome
      data={{
        firstName: member.fullName.split(" ")[0] ?? member.fullName,
        basePath: `/${org.slug}`,
        today: clock.date,
        hour: clock.hour,
        issuers: (issuers.data ?? []).map((i) => ({
          kind: i.kind,
          legalName: i.legal_name,
          hasTaxId: Boolean(i.tax_id),
          isPrimary: i.is_primary,
          verifactuFrom: i.verifactu_from,
          provider: i.fiscal_provider,
        })),
        memberCount: members.count ?? 1,
        pendingInvites: invites.count ?? 0,
        clientCount: clients.count ?? 0,
        catalogCount: catalog.count ?? 0,
        googleConnected: (google.count ?? 0) > 0,
        goalsSet: (() => {
          const goals = readGoals(org.settings);
          return goals.mrr !== null || goals.revenueYear !== null;
        })(),
      }}
    />
  );
}

export default async function DashboardPage({ params }: PageProps<"/[org]">) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  // Mientras no hay contratos ni facturas no hay nada que medir: primeros pasos.
  if (!(await orgHasBusinessData(ctx.org.id))) return <Onboarding ctx={ctx} />;
  const supabase = await createClient();
  const today = nowInZone(ctx.org.timezone).date;
  const [view, forecast, upcoming, queue, myTasks] = await Promise.all([
    loadDashboard(ctx),
    getBillingForecast(supabase, ctx.org.id, today, 13),
    loadUpcomingWeek(supabase, ctx),
    loadActionQueue(supabase, ctx.org),
    getMyTasksCard(ctx.org.id, ctx.member.id, today),
  ]);
  // El mes en curso solo cuenta si aún le queda algo por facturar (se factura por adelantado, el día 1).
  const current = forecast[0];
  const months = current && current.recurringCents + current.oneOffCents === 0 ? forecast.slice(1) : forecast.slice(0, 12);
  const goals = readGoals(ctx.org.settings);
  // Lo operativo, justo debajo de las cifras: los objetivos, la semana y lo que espera a alguien.
  const week = (
    <>
      <GoalsCard
        mrr={goals.mrr ? mrrGoalProgress(goals.mrr, view.mrr.cents, view.mrr.sparkline, view.today) : null}
        revenue={goals.revenueYear ? revenueGoalProgress(goals.revenueYear, view.history, forecast, view.today) : null}
        money={view.money}
        settingsHref={`/${ctx.org.slug}/settings#goals`}
        canEdit={hasRole(ctx.member.role, "owner")}
      />
      {/* grid-cols-1 (minmax(0, 1fr)): sin él, la tarjeta más ancha estira la columna en el móvil. */}
      <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <UpcomingWeekCard data={upcoming} className="xl:col-span-2 xl:row-span-2" />
        <ActionQueueCard items={queue} money={view.money} />
        <MyTasksCard slug={ctx.org.slug} basePath={`/${ctx.org.slug}`} data={myTasks} canEdit={hasRole(ctx.member.role, "partner")} />
      </section>
    </>
  );
  return <Dashboard view={view} forecast={months} week={week} />;
}
