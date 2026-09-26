import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Dashboard } from "@/components/dashboard/dashboard";
import { DashboardHome } from "@/components/dashboard/dashboard-home";
import { nowInZone } from "@/lib/clock";
import { createClient } from "@/lib/supabase/server";
import { getBillingForecast } from "@/server/billing/forecast";
import { loadDashboard, orgHasBusinessData } from "@/server/metrics/dashboard";
import { getOrgContext, type OrgContext } from "@/server/session";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("dashboard"))("title") };
}

/** Primeros pasos: lo que ve una org que aún no tiene contratos ni facturas. */
async function Onboarding({ ctx }: { ctx: OrgContext }) {
  const { org, member } = ctx;
  const supabase = await createClient();
  const [issuers, members, invites, clients] = await Promise.all([
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
  const [view, forecast] = await Promise.all([
    loadDashboard(ctx),
    getBillingForecast(supabase, ctx.org.id, nowInZone(ctx.org.timezone).date, 13),
  ]);
  // El mes en curso solo cuenta si aún le queda algo por facturar (se factura por adelantado, el día 1).
  const current = forecast[0];
  const months = current && current.recurringCents + current.oneOffCents === 0 ? forecast.slice(1) : forecast.slice(0, 12);
  return <Dashboard view={view} forecast={months} />;
}
