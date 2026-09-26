import "server-only";
import { type ForecastContract, type ForecastMonth, forecastBilling } from "@/domain/billing/forecast";
import type { CivilDate } from "@/domain/dates/civil-date";
import { type Db, fetchAll, must } from "./context";

/**
 * Facturación prevista (base sin IVA) de los próximos `months` meses: lo que el cron va a
 * facturar con los contratos firmados, si nada cambia. Con el cliente del usuario (RLS).
 */
export async function getBillingForecast(db: Db, orgId: string, from: CivilDate, months = 12): Promise<ForecastMonth[]> {
  const contracts = must(
    await db
      .from("contracts")
      .select(
        "id, signed_on, contract_lines(id, billing_type, quantity, unit_price_cents, discount_bps, starts_on, ends_on, billing_day, prorate_first, contract_line_pauses(starts_on, ends_on)), contract_milestones(id, position, percent_bps, planned_on)",
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

  const input: ForecastContract[] = contracts.map((c) => ({
    id: c.id,
    signedOn: c.signed_on,
    lines: c.contract_lines.map((l) => ({
      id: l.id,
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
  return forecastBilling(input, from, months);
}
