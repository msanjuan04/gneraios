import "server-only";
import { type ForecastContract, type ForecastItem, type ForecastMonth, forecastBilling, forecastItems } from "@/domain/billing/forecast";
import type { CivilDate } from "@/domain/dates/civil-date";
import { type Db, fetchAll, must } from "./context";

async function loadForecastContracts(db: Db, orgId: string): Promise<ForecastContract[]> {
  const contracts = must(
    await db
      .from("contracts")
      .select(
        "id, client_id, title, signed_on, contract_lines(id, description, billing_type, quantity, unit_price_cents, discount_bps, starts_on, ends_on, billing_day, prorate_first, contract_line_pauses(starts_on, ends_on)), contract_milestones(id, position, percent_bps, planned_on)",
      )
      .eq("org_id", orgId)
      .is("archived_at", null)
      .not("signed_on", "is", null),
    "forecast.contracts",
  );
  const items = await fetchAll(
    (a, b) =>
      db
        .from("billable_items")
        .select("contract_line_id, source, period_start, milestone_id, invoice_line_id, waived_at")
        .eq("org_id", orgId)
        .or("invoice_line_id.not.is.null,waived_at.not.is.null")
        .order("id")
        .range(a, b),
    "forecast.items",
  );
  const billedStarts = new Map<string, Set<string>>();
  const billedMilestones = new Set<string>();
  for (const item of items) {
    if (item.source === "recurring" && item.period_start) {
      const set = billedStarts.get(item.contract_line_id) ?? new Set<string>();
      set.add(item.period_start);
      billedStarts.set(item.contract_line_id, set);
    }
    if (item.milestone_id) billedMilestones.add(item.milestone_id);
  }

  return contracts.map((c) => ({
    id: c.id,
    clientId: c.client_id,
    title: c.title,
    signedOn: c.signed_on,
    lines: c.contract_lines.map((l) => ({
      id: l.id,
      description: l.description,
      billingType: l.billing_type,
      quantity: String(l.quantity),
      unitPriceCents: l.unit_price_cents,
      discountBps: l.discount_bps,
      startsOn: l.starts_on,
      endsOn: l.ends_on,
      billingDay: l.billing_day,
      prorateFirst: l.prorate_first,
      pauses: l.contract_line_pauses.map((p) => ({ startsOn: p.starts_on, endsOn: p.ends_on })),
    })),
    milestones: c.contract_milestones.map((m) => ({ id: m.id, position: m.position, percentBps: m.percent_bps, plannedOn: m.planned_on })),
    billedMilestoneIds: billedMilestones,
    billedStarts,
  }));
}

/**
 * Facturación prevista (base sin IVA) de los próximos `months` meses: lo que el cron va a
 * facturar con los contratos firmados, si nada cambia. Con el cliente del usuario (RLS).
 */
export async function getBillingForecast(db: Db, orgId: string, from: CivilDate, months = 12): Promise<ForecastMonth[]> {
  return forecastBilling(await loadForecastContracts(db, orgId), from, months);
}

/** Cada cobro previsto, uno por uno y por fecha, con su cliente: lo que se enseña en «Próximos cobros». */
export async function getUpcomingCharges(db: Db, orgId: string, from: CivilDate, months = 12): Promise<(ForecastItem & { clientName: string })[]> {
  const items = forecastItems(await loadForecastContracts(db, orgId), from, months);
  const clientIds = [...new Set(items.flatMap((item) => (item.clientId ? [item.clientId] : [])))];
  const names = new Map<string, string>();
  if (clientIds.length > 0) {
    const clients = must(await db.from("clients").select("id, display_name").eq("org_id", orgId).in("id", clientIds), "forecast.clients");
    for (const client of clients) names.set(client.id, client.display_name);
  }
  return items.map((item) => ({ ...item, clientName: (item.clientId && names.get(item.clientId)) || "—" }));
}
