// Sin "server-only", como sources.ts: no lee secretos (recibe el cliente de Supabase ya creado).
// Solo se importa desde código de servidor.
//
// Finanzas → Infraestructura: las suscripciones, las categorías, los proveedores, los gastos de los
// últimos 12 meses y las webs alojadas, para buildInfrastructure (src/domain/finance/infrastructure.ts).
// Con el cliente del usuario pasan por su RLS; todas filtran por la org de forma explícita.

import { addDays, addMonthsClamped, type CivilDate } from "@/domain/dates/civil-date";
import { expenseCostCents } from "@/domain/finance/expense";
import { buildInfrastructure, type InfrastructureReport } from "@/domain/finance/infrastructure";
import type { RenewalSettings } from "@/domain/finance/renewals";
import { siteName } from "@/domain/sites/url";
import { type Db, fetchAll, must } from "@/server/billing/context";
import { renewalSettings } from "./renewal-settings";

export type InfrastructureData = {
  report: InfrastructureReport;
  settings: RenewalSettings;
  /** Primer día de «los últimos 12 meses» (hasta hoy). */
  spentFrom: CivilDate;
};

export async function loadInfrastructure(db: Db, org: { id: string; settings: unknown }, today: CivilDate): Promise<InfrastructureData> {
  const settings = renewalSettings(org.settings);
  const spentFrom = addDays(addMonthsClamped(today, -12), 1);

  const [subscriptions, categories, vendors, sites] = await Promise.all([
    fetchAll(
      (from, to) =>
        db
          .from("expense_subscriptions")
          .select(
            "id, description, vendor_id, category_id, base_cents, vat_bps, vat_deductible, irpf_bps, billing_interval, starts_on, ends_on, billing_day, is_active, allocation, client_id",
          )
          .eq("org_id", org.id)
          .order("id")
          .range(from, to),
      "finance.infrastructure.subscriptions",
    ),
    fetchAll(
      (from, to) => db.from("expense_categories").select("id, name, expense_group, is_infrastructure").eq("org_id", org.id).order("id").range(from, to),
      "finance.infrastructure.categories",
    ),
    fetchAll((from, to) => db.from("vendors").select("id, name").eq("org_id", org.id).order("id").range(from, to), "finance.infrastructure.vendors"),
    fetchAll(
      (from, to) =>
        db
          .from("sites")
          .select("id, url, label, client_id")
          .eq("org_id", org.id)
          .eq("hosted_by_us", true)
          .eq("is_active", true)
          .order("id")
          .range(from, to),
      "finance.infrastructure.sites",
    ),
  ]);

  // Los gastos que pueden entrar: los de una categoría de infraestructura o los de las webs alojadas.
  const infraCategoryIds = categories.filter((c) => c.is_infrastructure).map((c) => c.id);
  const expenses = await fetchAll((from, to) => {
    const scope = infraCategoryIds.length > 0 ? `allocation.eq.hosted_sites,category_id.in.(${infraCategoryIds.join(",")})` : "allocation.eq.hosted_sites";
    return db
      .from("expenses")
      .select("id, category_id, allocation, base_cents, vat_cents, vat_deductible")
      .eq("org_id", org.id)
      .gte("issued_on", spentFrom)
      .lte("issued_on", today)
      .or(scope)
      .order("id")
      .range(from, to);
  }, "finance.infrastructure.expenses");

  const clientIds = [...new Set([...subscriptions.map((s) => s.client_id), ...sites.map((s) => s.client_id)].filter((id): id is string => id !== null))];
  const clients = clientIds.length
    ? must(await db.from("clients").select("id, display_name").eq("org_id", org.id).in("id", clientIds), "finance.infrastructure.clients")
    : [];

  const report = buildInfrastructure({
    today,
    settings,
    subscriptions: subscriptions.map((s) => ({
      id: s.id,
      description: s.description,
      vendorId: s.vendor_id,
      categoryId: s.category_id,
      baseCents: s.base_cents,
      vatBps: s.vat_bps,
      vatDeductible: s.vat_deductible,
      irpfBps: s.irpf_bps,
      interval: s.billing_interval,
      startsOn: s.starts_on,
      endsOn: s.ends_on,
      billingDay: s.billing_day,
      isActive: s.is_active,
      allocation: s.allocation,
      clientId: s.client_id,
    })),
    categories: categories.map((c) => ({ id: c.id, name: c.name, expenseGroup: c.expense_group, isInfrastructure: c.is_infrastructure })),
    vendors: vendors.map((v) => ({ id: v.id, name: v.name })),
    clients: clients.map((c) => ({ id: c.id, name: c.display_name })),
    expenses: expenses.map((e) => ({
      categoryId: e.category_id,
      allocation: e.allocation,
      costCents: expenseCostCents({ baseCents: e.base_cents, vatCents: e.vat_cents, vatDeductible: e.vat_deductible }),
    })),
    sites: sites.map((s) => ({ id: s.id, name: siteName({ label: s.label, url: s.url }), clientId: s.client_id })),
  });
  return { report, settings, spentFrom };
}
