// Sin "server-only", como sources.ts: lo llama el cron diario (/api/cron/daily) y no lee secretos
// (recibe el cliente de Supabase ya creado). Solo se importa desde código de servidor.
//
// Avisos de renovación de las suscripciones de gasto (bandeja y push). Cada día y por org, los
// cargos que caen dentro de los días de aviso (qué se avisa y cuándo: src/domain/finance/renewals.ts).
// Como los de Webs, uno por socio (partner u owner activo) y cargo: la clave del aviso es
// subscription_renewal:<suscripción>:<fecha del cargo> y cada socio le añade su id, así que repetir
// el cron (o recuperarlo al día siguiente) no duplica nada. Los reparte a los móviles el propio cron
// al terminar (dispatchPendingPushes).

import { isInfrastructureCost } from "@/domain/finance/infrastructure";
import { planRenewalAlerts, type RenewalAlert, type RenewalCandidate } from "@/domain/finance/renewals";
import { subscriptionAmounts } from "@/domain/finance/subscriptions";
import { nowInZone } from "@/lib/clock";
import type { Json, Tables, TablesInsert } from "@/lib/supabase/database.types";
import { type Db, DbError, fetchAll, must } from "@/server/billing/context";
import { renewalSettings } from "./renewal-settings";

export type RenewalOrg = Pick<Tables<"orgs">, "id" | "timezone" | "settings">;

export type RenewalRunSummary = {
  orgs: number;
  /** Cargos de los que tocaba avisar (antes de multiplicar por socios). */
  due: number;
  /** Avisos nuevos (los que ya existían no se repiten). */
  created: number;
  errors: string[];
};

const CHUNK = 500;

/** Los socios y owners activos: a quién se avisa. */
async function recipients(admin: Db, orgId: string): Promise<string[]> {
  const rows = must(
    await admin.from("members").select("id").eq("org_id", orgId).eq("is_active", true).in("role", ["partner", "owner"]).order("id"),
    "finance.renewals.recipients",
  );
  return rows.map((m) => m.id);
}

/** Las suscripciones encendidas de la org, listas para decidir de cuáles se avisa. */
async function loadCandidates(admin: Db, orgId: string): Promise<{ candidates: RenewalCandidate[]; infrastructure: Set<string> }> {
  const [subscriptions, categories] = await Promise.all([
    fetchAll(
      (from, to) =>
        admin
          .from("expense_subscriptions")
          .select("id, description, category_id, base_cents, vat_bps, irpf_bps, billing_interval, starts_on, ends_on, billing_day, is_active, allocation")
          .eq("org_id", orgId)
          .eq("is_active", true)
          .order("id")
          .range(from, to),
      "finance.renewals.subscriptions",
    ),
    fetchAll(
      (from, to) => admin.from("expense_categories").select("id, expense_group, is_infrastructure").eq("org_id", orgId).order("id").range(from, to),
      "finance.renewals.categories",
    ),
  ]);
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const infrastructure = new Set<string>();
  const candidates = subscriptions.map((s): RenewalCandidate => {
    const category = categoryById.get(s.category_id);
    if (isInfrastructureCost(s.allocation, category ? { isInfrastructure: category.is_infrastructure } : undefined)) infrastructure.add(s.id);
    return {
      id: s.id,
      name: s.description,
      chargeTotalCents: subscriptionAmounts({ baseCents: s.base_cents, vatBps: s.vat_bps, irpfBps: s.irpf_bps }).totalCents,
      expenseGroup: category?.expense_group ?? "operating",
      interval: s.billing_interval,
      startsOn: s.starts_on,
      endsOn: s.ends_on,
      billingDay: s.billing_day,
      isActive: s.is_active,
    };
  });
  return { candidates, infrastructure };
}

export type PlannedRenewalAlert = RenewalAlert & { href: string };

/** Los avisos que tocan hoy en una org (sin escribir nada), con la pantalla a la que llevan. */
export async function planOrgRenewalAlerts(admin: Db, org: RenewalOrg, now = new Date()): Promise<PlannedRenewalAlert[]> {
  const today = nowInZone(org.timezone, now).date;
  const { candidates, infrastructure } = await loadCandidates(admin, org.id);
  return planRenewalAlerts(candidates, today, renewalSettings(org.settings)).map((alert) => ({
    ...alert,
    // Lo de infraestructura se ve en su pestaña; el resto, en Suscripciones.
    href: infrastructure.has(alert.subscriptionId) ? "/finance/infrastructure" : "/finance/subscriptions",
  }));
}

/** Crea los avisos de renovación que tocan hoy en una org. Devuelve cuántos cargos tocaban y cuántos avisos son nuevos. */
export async function createRenewalAlerts(admin: Db, org: RenewalOrg, now = new Date()): Promise<{ due: number; created: number }> {
  const alerts = await planOrgRenewalAlerts(admin, org, now);
  if (alerts.length === 0) return { due: 0, created: 0 };

  const members = await recipients(admin, org.id);
  const rows: TablesInsert<"notifications">[] = alerts.flatMap((alert) =>
    members.map((memberId) => ({
      org_id: org.id,
      member_id: memberId,
      kind: "subscription_renewal" as const,
      params: alert.params as Json,
      href: alert.href,
      due_on: alert.renewalOn,
      dedupe_key: `${alert.key}:${memberId}`,
    })),
  );
  let created = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { data, error } = await admin
      .from("notifications")
      .upsert(rows.slice(i, i + CHUNK), { onConflict: "org_id,dedupe_key", ignoreDuplicates: true })
      .select("id");
    if (error) throw new DbError(error, "finance.renewals.notifications");
    created += data?.length ?? 0;
  }
  return { due: alerts.length, created };
}

/**
 * Los avisos de renovación de todas las orgs (o de una), con el «hoy» de cada una. Un fallo en una
 * org no para las demás: queda en `errors`.
 */
export async function runSubscriptionRenewalAlerts(admin: Db, opts: { orgId?: string; now?: Date } = {}): Promise<RenewalRunSummary> {
  const summary: RenewalRunSummary = { orgs: 0, due: 0, created: 0, errors: [] };
  let query = admin.from("orgs").select("id, timezone, settings");
  if (opts.orgId) query = query.eq("id", opts.orgId);
  const orgs = must(await query.order("id"), "finance.renewals.orgs");
  for (const org of orgs) {
    try {
      const result = await createRenewalAlerts(admin, org, opts.now);
      summary.orgs += 1;
      summary.due += result.due;
      summary.created += result.created;
    } catch (error) {
      console.error("[renewals] org", org.id, error);
      summary.errors.push(`${org.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return summary;
}
