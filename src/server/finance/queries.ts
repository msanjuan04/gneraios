import "server-only";
import { cache } from "react";
import type {
  CashAccountItem,
  ExpenseFilters,
  ExpenseListItem,
  ExpensesSummary,
  FinanceConfig,
  PartnersData,
  SubscriptionListItem,
} from "@/components/finance/types";
import { compareCivil, type CivilDate } from "@/domain/dates/civil-date";
import { nextChargeOn, subscriptionAmounts, subscriptionMonthlyCostCents } from "@/domain/finance/subscriptions";
import { monthOf, monthsEndingAt } from "@/domain/metrics/months";
import type { Database } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { fetchAll, must } from "@/server/billing/context";
import { loadGeneratedStarts, loadSubscriptions } from "./sources";

type Supabase = Awaited<ReturnType<typeof createClient>>;
type OverviewRow = Database["public"]["Views"]["expenses_overview"]["Row"];

/**
 * Emisores, categorías, proveedores, socios, clientes y tipos de la org, una vez por petición. Es
 * todo lo que necesitan los paneles de gasto y de suscripción, también fuera de Finanzas.
 */
export const getFinanceConfig = cache(async (orgId: string): Promise<FinanceConfig> => {
  const supabase = await createClient();
  const [issuers, categories, vendors, members, rates, clients] = await Promise.all([
    supabase.from("issuers").select("id, kind, legal_name, trade_name, is_primary, archived_at").eq("org_id", orgId),
    supabase
      .from("expense_categories")
      .select("id, name, expense_group, is_fixed, is_infrastructure, position, archived_at, created_at")
      .eq("org_id", orgId)
      .order("position")
      .order("created_at"),
    supabase
      .from("vendors")
      .select("id, name, tax_id, country_code, default_category_id, archived_at")
      .eq("org_id", orgId)
      .order("name"),
    supabase.from("members").select("id, full_name, initials").eq("org_id", orgId).eq("is_active", true).order("full_name"),
    supabase
      .from("tax_rates")
      .select("id, kind, name, rate_bps, regime, is_default, position, archived_at")
      .eq("org_id", orgId)
      .is("archived_at", null)
      .order("position"),
    fetchAll(
      (a, b) =>
        supabase.from("clients").select("id, display_name, archived_at").eq("org_id", orgId).order("display_name").order("id").range(a, b),
      "finance.config.clients",
    ),
  ]);
  const issuerRows = must(issuers, "finance.config.issuers");
  const rateRows = must(rates, "finance.config.rates");
  const vat = rateRows.filter((r) => r.kind === "vat" && (r.regime === "general" || r.rate_bps === 0));
  const unique = (rows: typeof rateRows) =>
    rows.filter((r, i) => rows.findIndex((x) => x.rate_bps === r.rate_bps) === i).map((r) => ({
      id: r.id,
      name: r.name,
      rateBps: r.rate_bps,
      isDefault: r.is_default,
    }));
  return {
    issuers: issuerRows
      .map((i) => ({ id: i.id, name: i.trade_name || i.legal_name, kind: i.kind, archived: i.archived_at !== null }))
      .sort((a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name, "es")),
    categories: must(categories, "finance.config.categories").map((c) => ({
      id: c.id,
      name: c.name,
      expenseGroup: c.expense_group,
      isFixed: c.is_fixed,
      isInfrastructure: c.is_infrastructure,
      archived: c.archived_at !== null,
    })),
    vendors: must(vendors, "finance.config.vendors").map((v) => ({
      id: v.id,
      name: v.name,
      taxId: v.tax_id,
      countryCode: v.country_code,
      defaultCategoryId: v.default_category_id,
      archived: v.archived_at !== null,
    })),
    members: must(members, "finance.config.members").map((m) => ({ id: m.id, fullName: m.full_name, initials: m.initials })),
    clients: clients.map((c) => ({ id: c.id, name: c.display_name, archived: c.archived_at !== null })),
    vatRates: unique(vat),
    irpfRates: unique(rateRows.filter((r) => r.kind === "irpf")),
    defaultIssuerId: issuerRows.find((i) => i.is_primary && !i.archived_at)?.id ?? issuerRows.find((i) => !i.archived_at)?.id ?? null,
    defaultVatBps: vat.find((r) => r.is_default)?.rate_bps ?? vat[0]?.rate_bps ?? 0,
  };
});

const EXPENSE_COLUMNS =
  "id, issuer_id, issuer_name, vendor_id, vendor_name, category_id, category_name, expense_group, is_fixed, description, vendor_invoice_number, issued_on, due_on, payable_on, base_cents, vat_bps, vat_cents, vat_deductible, irpf_bps, irpf_cents, total_cents, cost_cents, paid_on, payment_method, member_id, member_name, subscription_id, period_start, attachment_path, source, notes, status, allocation, client_id, client_name, rebill, rebill_markup_bps, rebill_state, rebill_invoice_id, rebill_invoice_number";

type Locking = Map<string, { isActive: boolean; startsOn: CivilDate; endsOn: CivilDate | null }>;

function toItem(row: Partial<OverviewRow>, subscriptions: Locking): ExpenseListItem | null {
  if (!row.id || !row.issuer_id || !row.category_id || !row.issued_on || !row.status || !row.expense_group || !row.source) return null;
  const sub = row.subscription_id ? subscriptions.get(row.subscription_id) : undefined;
  const locked = Boolean(
    sub &&
      row.period_start &&
      sub.isActive &&
      compareCivil(row.period_start, sub.startsOn) >= 0 &&
      (sub.endsOn === null || compareCivil(row.period_start, sub.endsOn) <= 0),
  );
  return {
    id: row.id,
    issuerId: row.issuer_id,
    issuerName: row.issuer_name ?? "",
    vendorId: row.vendor_id ?? null,
    vendorName: row.vendor_name ?? null,
    categoryId: row.category_id,
    categoryName: row.category_name ?? "",
    expenseGroup: row.expense_group,
    isFixed: row.is_fixed ?? false,
    description: row.description ?? "",
    vendorInvoiceNumber: row.vendor_invoice_number ?? null,
    issuedOn: row.issued_on,
    dueOn: row.due_on ?? null,
    payableOn: row.payable_on ?? row.issued_on,
    baseCents: row.base_cents ?? 0,
    vatBps: row.vat_bps ?? 0,
    vatCents: row.vat_cents ?? 0,
    vatDeductible: row.vat_deductible ?? true,
    irpfBps: row.irpf_bps ?? 0,
    irpfCents: row.irpf_cents ?? 0,
    totalCents: row.total_cents ?? 0,
    costCents: row.cost_cents ?? 0,
    paidOn: row.paid_on ?? null,
    paymentMethod: row.payment_method ?? null,
    memberId: row.member_id ?? null,
    memberName: row.member_name ?? null,
    subscriptionId: row.subscription_id ?? null,
    periodStart: row.period_start ?? null,
    hasAttachment: Boolean(row.attachment_path),
    source: row.source,
    notes: row.notes ?? null,
    status: row.status,
    locked,
    allocation: row.allocation ?? "company",
    clientId: row.client_id ?? null,
    clientName: row.client_name ?? null,
    rebill: row.rebill ?? false,
    rebillMarkupBps: row.rebill_markup_bps ?? 0,
    rebillState: row.rebill_state ?? null,
    rebillInvoiceId: row.rebill_invoice_id ?? null,
    rebillInvoiceNumber: row.rebill_invoice_number ?? null,
  };
}

/** Texto de búsqueda seguro para un filtro `or` de PostgREST (sin comas, paréntesis ni comodines). */
function sanitize(q: string): string {
  return q.replace(/[,()*%\\]/g, " ").trim().slice(0, 80);
}

async function subscriptionWindows(supabase: Supabase, orgId: string): Promise<Locking> {
  const rows = must(
    await supabase.from("expense_subscriptions").select("id, is_active, starts_on, ends_on").eq("org_id", orgId),
    "finance.subscriptionWindows",
  );
  return new Map(rows.map((s) => [s.id, { isActive: s.is_active, startsOn: s.starts_on, endsOn: s.ends_on }]));
}

/** Gastos del filtro, de lo más reciente a lo más antiguo, y sus cifras. */
export async function listExpenses(
  supabase: Supabase,
  orgId: string,
  filters: ExpenseFilters,
  limit: number,
): Promise<{ rows: ExpenseListItem[]; truncated: boolean; summary: ExpensesSummary }> {
  let query = supabase.from("expenses_overview").select(EXPENSE_COLUMNS).eq("org_id", orgId);
  if (filters.month) query = query.eq("month", `${filters.month}-01`);
  if (filters.category) query = query.eq("category_id", filters.category);
  if (filters.issuer) query = query.eq("issuer_id", filters.issuer);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.vendor) query = query.eq("vendor_id", filters.vendor);
  if (filters.client) query = query.eq("client_id", filters.client);
  if (filters.rebill === "pending") query = query.eq("rebill_state", "pending");
  const q = sanitize(filters.q);
  if (q) {
    query = query.or(
      [`description.ilike.*${q}*`, `vendor_name.ilike.*${q}*`, `vendor_invoice_number.ilike.*${q}*`, `notes.ilike.*${q}*`].join(","),
    );
  }
  const [result, windows] = await Promise.all([
    query.order("issued_on", { ascending: false }).order("created_at", { ascending: false }).limit(limit + 1),
    subscriptionWindows(supabase, orgId),
  ]);
  if (result.error) throw result.error;
  const all = (result.data ?? []).flatMap((row) => {
    const item = toItem(row, windows);
    return item ? [item] : [];
  });
  const rows = all.slice(0, limit);
  const summary = rows.reduce<ExpensesSummary>(
    (s, r) => ({
      count: s.count + 1,
      baseCents: s.baseCents + r.baseCents,
      vatCents: s.vatCents + r.vatCents,
      totalCents: s.totalCents + r.totalCents,
      costCents: s.costCents + r.costCents,
      pendingCents: s.pendingCents + (r.status === "paid" ? 0 : r.totalCents),
      pendingCount: s.pendingCount + (r.status === "paid" ? 0 : 1),
      overdueCents: s.overdueCents + (r.status === "overdue" ? r.totalCents : 0),
      overdueCount: s.overdueCount + (r.status === "overdue" ? 1 : 0),
    }),
    { count: 0, baseCents: 0, vatCents: 0, totalCents: 0, costCents: 0, pendingCents: 0, pendingCount: 0, overdueCents: 0, overdueCount: 0 },
  );
  return { rows, truncated: all.length > limit, summary };
}

/** Meses (YYYY-MM) con algún gasto, del más reciente al más antiguo: las opciones del filtro. */
export async function expenseMonths(supabase: Supabase, orgId: string): Promise<string[]> {
  const rows = await fetchAll(
    (a, b) => supabase.from("expenses_by_month").select("month").eq("org_id", orgId).order("month", { ascending: false }).range(a, b),
    "finance.expenseMonths",
  );
  return [...new Set(rows.flatMap((r) => (r.month ? [r.month.slice(0, 7)] : [])))];
}

/** Suscripciones con sus nombres, el próximo cargo, su coste mensual y lo ya generado. */
export async function listSubscriptions(supabase: Supabase, orgId: string, today: CivilDate, config: FinanceConfig): Promise<SubscriptionListItem[]> {
  const [subscriptions, generated, notes] = await Promise.all([
    loadSubscriptions(supabase, orgId),
    loadGeneratedStarts(supabase, orgId),
    supabase.from("expense_subscriptions").select("id, notes").eq("org_id", orgId),
  ]);
  const noteById = new Map(must(notes, "finance.subscriptions.notes").map((n) => [n.id, n.notes]));
  const name = <T extends { id: string }>(list: T[], id: string | null, pick: (item: T) => string) =>
    id ? (list.find((x) => x.id === id) ? pick(list.find((x) => x.id === id)!) : null) : null;
  return subscriptions
    .map((s): SubscriptionListItem => {
      const starts = [...(generated.get(s.id) ?? [])].sort();
      return {
        id: s.id,
        issuerId: s.issuerId,
        issuerName: name(config.issuers, s.issuerId, (i) => i.name) ?? "",
        vendorId: s.vendorId,
        vendorName: name(config.vendors, s.vendorId, (v) => v.name),
        categoryId: s.categoryId,
        categoryName: name(config.categories, s.categoryId, (c) => c.name) ?? "",
        memberId: s.memberId,
        memberName: name(config.members, s.memberId, (m) => m.fullName),
        description: s.description,
        baseCents: s.baseCents,
        vatBps: s.vatBps,
        vatDeductible: s.vatDeductible,
        irpfBps: s.irpfBps,
        chargeTotalCents: subscriptionAmounts(s).totalCents,
        interval: s.interval,
        startsOn: s.startsOn,
        endsOn: s.endsOn,
        billingDay: s.billingDay,
        paymentMethod: s.paymentMethod,
        isActive: s.isActive,
        notes: noteById.get(s.id) ?? null,
        nextChargeOn: nextChargeOn(s, today),
        monthlyCostCents: subscriptionMonthlyCostCents(s, today),
        generatedCount: starts.length,
        lastPeriodStart: starts.at(-1) ?? null,
        allocation: s.allocation,
        clientId: s.clientId,
        clientName: name(config.clients, s.clientId, (c) => c.name),
        rebill: s.rebill,
        rebillMarkupBps: s.rebillMarkupBps,
      };
    })
    .sort(
      (a, b) =>
        Number(b.isActive && b.monthlyCostCents > 0) - Number(a.isActive && a.monthlyCostCents > 0) ||
        b.monthlyCostCents - a.monthlyCostCents ||
        a.description.localeCompare(b.description, "es"),
    );
}

/** Cuentas con su último saldo y su histórico de saldos (del más reciente al más antiguo). */
export async function listCashAccounts(supabase: Supabase, orgId: string): Promise<CashAccountItem[]> {
  const [accounts, balances] = await Promise.all([
    supabase.from("cash_position").select("account_id, issuer_id, issuer_name, name, iban, is_active, balance_on, balance_cents").eq("org_id", orgId),
    fetchAll(
      (a, b) =>
        supabase
          .from("cash_balances")
          .select("id, account_id, balance_on, balance_cents, source, note")
          .eq("org_id", orgId)
          .order("balance_on", { ascending: false })
          .order("id")
          .range(a, b),
      "finance.cashBalances",
    ),
  ]);
  const byAccount = new Map<string, CashAccountItem["balances"]>();
  for (const b of balances) {
    const list = byAccount.get(b.account_id) ?? [];
    list.push({ id: b.id, balanceOn: b.balance_on, balanceCents: b.balance_cents, source: b.source, note: b.note });
    byAccount.set(b.account_id, list);
  }
  return must(accounts, "finance.cashAccounts")
    .flatMap((a) =>
      a.account_id && a.issuer_id
        ? [
            {
              id: a.account_id,
              issuerId: a.issuer_id,
              issuerName: a.issuer_name ?? "",
              name: a.name ?? "",
              iban: a.iban,
              isActive: a.is_active ?? false,
              balanceOn: a.balance_on,
              balanceCents: a.balance_cents,
              balances: byAccount.get(a.account_id) ?? [],
            },
          ]
        : [],
    )
    .sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.name.localeCompare(b.name, "es"));
}

/** Participaciones (todos los repartos) y retribución de los socios en los últimos `months` meses. */
export async function loadPartners(supabase: Supabase, orgId: string, today: CivilDate, months = 12): Promise<PartnersData> {
  const window = monthsEndingAt(monthOf(today), months);
  const [shares, compensation, movements, members] = await Promise.all([
    supabase.from("shareholdings").select("member_id, percent_bps, valid_from").eq("org_id", orgId).order("valid_from", { ascending: false }),
    fetchAll(
      (a, b) =>
        supabase
          .from("expenses_overview")
          .select("id, member_id, month, cost_cents")
          .eq("org_id", orgId)
          .eq("expense_group", "partner_compensation")
          .gte("month", window[0]!)
          .order("id")
          .range(a, b),
      "finance.partners.compensation",
    ),
    fetchAll(
      (a, b) => supabase.from("partner_movements").select("id, member_id, kind, status, amount_cents, effective_on, reference, notes").eq("org_id", orgId).order("effective_on", { ascending: false }).order("created_at", { ascending: false }).range(a, b),
      "finance.partners.movements",
    ),
    supabase.from("members").select("id, full_name, initials, is_active").eq("org_id", orgId).order("full_name"),
  ]);
  const sets = new Map<string, { memberId: string; percentBps: number }[]>();
  for (const s of must(shares, "finance.partners.shares")) {
    const list = sets.get(s.valid_from) ?? [];
    list.push({ memberId: s.member_id, percentBps: s.percent_bps });
    sets.set(s.valid_from, list);
  }
  const sorted = [...sets.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([validFrom, rows]) => ({ validFrom, rows: rows.sort((a, b) => b.percentBps - a.percentBps) }));
  const byKey = new Map<string, { memberId: string | null; month: string; costCents: number }>();
  for (const row of compensation) {
    if (!row.month) continue;
    const key = `${row.member_id ?? ""}:${row.month}`;
    const entry = byKey.get(key) ?? { memberId: row.member_id ?? null, month: row.month, costCents: 0 };
    entry.costCents += row.cost_cents ?? 0;
    byKey.set(key, entry);
  }
  const memberRows = must(members, "finance.partners.members");
  const involved = new Set([...sorted.flatMap((s) => s.rows.map((r) => r.memberId)), ...[...byKey.values()].flatMap((c) => (c.memberId ? [c.memberId] : []))]);
  const movementRows = movements;
  for (const movement of movementRows) involved.add(movement.member_id);
  return {
    members: memberRows
      .filter((m) => m.is_active || involved.has(m.id))
      .map((m) => ({ id: m.id, fullName: m.full_name, initials: m.initials })),
    sets: sorted,
    currentValidFrom: sorted.find((s) => s.validFrom <= today)?.validFrom ?? null,
    months: window,
    compensation: [...byKey.values()],
    movements: movementRows.map((movement) => ({ id: movement.id, memberId: movement.member_id, kind: movement.kind, status: movement.status, amountCents: movement.amount_cents, effectiveOn: movement.effective_on, reference: movement.reference, notes: movement.notes })),
  };
}
