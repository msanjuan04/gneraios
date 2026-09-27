import "server-only";
import type {
  BankAccountOption,
  BankFilters,
  BankKpis,
  BankMatchItem,
  BankPageData,
  BankRuleItem,
  BankStatementItem,
  BankTargetOption,
  BankTransactionItem,
  IgnoreReason,
} from "@/components/banking/types";
import { bankingDigest, monthProgress } from "@/domain/banking/digest";
import { type BankTx, type Suggestion, suggestAll } from "@/domain/banking/matcher";
import { isPending, type ReconciliationStatus } from "@/domain/banking/status";
import { normalizeText } from "@/domain/banking/text";
import { addDays, daysBetween, type CivilDate } from "@/domain/dates/civil-date";
import { parseMoneyInput } from "@/domain/money";
import { createClient } from "@/lib/supabase/server";
import { fetchAll, must } from "@/server/billing/context";
import { loadMatchContext, loadPendingTransactions, TX_COLUMNS, windowOf } from "./sources";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Filas que se pintan; si hay más, se pide afinar el filtro. */
const LIST_LIMIT = 300;
const MATCH_CHUNK = 100;
const SEARCH_LIMIT = 30;

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Filtros de la URL (?account=&status=&month=&q=), saneados. */
export function readBankFilters(params: Record<string, string | string[] | undefined>): BankFilters {
  const one = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : "");
  const status = one("status");
  const month = one("month");
  const account = one("account");
  return {
    account: GUID.test(account) ? account : "",
    status: status === "reconciled" || status === "ignored" || status === "all" ? status : "pending",
    month: MONTH.test(month) ? month : "",
    q: one("q").trim().slice(0, 80),
  };
}

/** Texto de búsqueda seguro para un filtro `or` de PostgREST (sin comas, paréntesis ni comodines). */
function sanitize(q: string): string {
  return q.replace(/[,()*%\\]/g, " ").trim().slice(0, 80);
}

function monthEnd(month: string): CivilDate {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return addDays(next, -1);
}

type OverviewRow = {
  id: string | null;
  account_id: string | null;
  booked_on: string | null;
  value_on: string | null;
  amount_cents: number | null;
  concept: string | null;
  counterparty: string | null;
  reference: string | null;
  bank_code: string | null;
  balance_after_cents: number | null;
  status: ReconciliationStatus | null;
  matched_cents: number | null;
  remaining_cents: number | null;
  ignored_reason: IgnoreReason | null;
  ignored_note: string | null;
};

function toItem(row: OverviewRow, matches: BankMatchItem[], suggestions: Suggestion[]): BankTransactionItem | null {
  if (!row.id || !row.booked_on || row.amount_cents === null || !row.status) return null;
  return {
    id: row.id,
    bookedOn: row.booked_on,
    valueOn: row.value_on,
    amountCents: row.amount_cents,
    concept: row.concept ?? "",
    counterparty: row.counterparty,
    reference: row.reference,
    bankCode: row.bank_code,
    balanceAfterCents: row.balance_after_cents,
    status: row.status,
    matchedCents: row.matched_cents ?? 0,
    remainingCents: row.remaining_cents ?? Math.abs(row.amount_cents),
    ignoredReason: row.ignored_reason,
    ignoredNote: row.ignored_note,
    matches,
    suggestions: isPending(row.status) ? suggestions : [],
  };
}

async function loadMatches(supabase: Supabase, transactionIds: readonly string[]): Promise<Map<string, BankMatchItem[]>> {
  const byTx = new Map<string, BankMatchItem[]>();
  for (let i = 0; i < transactionIds.length; i += MATCH_CHUNK) {
    const rows = must(
      await supabase
        .from("bank_matches_overview")
        .select(
          "id, transaction_id, amount_cents, target_kind, invoice_id, invoice_number, client_id, client_name, expense_id, expense_description, vendor_name, category_name, remittance_id, remittance_collection_on, created_payment, created_expense, marked_paid, settled_remittance, created_at, created_by_name",
        )
        .in("transaction_id", transactionIds.slice(i, i + MATCH_CHUNK))
        .order("created_at"),
      "banking.matches",
    );
    for (const m of rows) {
      if (!m.id || !m.transaction_id || !m.target_kind) continue;
      const list = byTx.get(m.transaction_id) ?? [];
      list.push({
        id: m.id,
        amountCents: m.amount_cents ?? 0,
        kind: m.target_kind as BankMatchItem["kind"],
        invoiceId: m.invoice_id,
        invoiceNumber: m.invoice_number,
        clientId: m.client_id,
        clientName: m.client_name,
        expenseId: m.expense_id,
        expenseDescription: m.expense_description,
        vendorName: m.vendor_name,
        categoryName: m.category_name,
        remittanceId: m.remittance_id,
        remittanceCollectionOn: m.remittance_collection_on,
        createdPayment: m.created_payment ?? false,
        createdExpense: m.created_expense ?? false,
        markedPaid: m.marked_paid ?? false,
        settledRemittance: m.settled_remittance ?? false,
        createdAt: m.created_at ?? "",
        createdByName: m.created_by_name,
      });
      byTx.set(m.transaction_id, list);
    }
  }
  return byTx;
}

async function loadAccounts(supabase: Supabase, orgId: string): Promise<BankAccountOption[]> {
  const [accounts, pending, statements] = await Promise.all([
    supabase.from("cash_position").select("account_id, issuer_id, issuer_name, name, iban, is_active, balance_on, balance_cents").eq("org_id", orgId),
    fetchAll(
      (a, b) =>
        supabase.from("bank_transactions_overview").select("account_id").eq("org_id", orgId).in("status", ["unmatched", "partial"]).order("id").range(a, b),
      "banking.accounts.pending",
    ),
    supabase.from("bank_statements").select("account_id, period_end").eq("org_id", orgId).order("period_end", { ascending: false }),
  ]);
  const pendingBy = new Map<string, number>();
  for (const row of pending) if (row.account_id) pendingBy.set(row.account_id, (pendingBy.get(row.account_id) ?? 0) + 1);
  const lastBy = new Map<string, string>();
  for (const s of must(statements, "banking.accounts.statements")) if (!lastBy.has(s.account_id)) lastBy.set(s.account_id, s.period_end);
  return must(accounts, "banking.accounts")
    .flatMap((a) =>
      a.account_id && a.issuer_id && a.is_active
        ? [
            {
              id: a.account_id,
              name: a.name ?? "",
              iban: a.iban,
              issuerId: a.issuer_id,
              issuerName: a.issuer_name ?? "",
              balanceCents: a.balance_cents,
              balanceOn: a.balance_on,
              pendingCount: pendingBy.get(a.account_id) ?? 0,
              lastStatementEnd: lastBy.get(a.account_id) ?? null,
            },
          ]
        : [],
    )
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

async function loadRules(supabase: Supabase, orgId: string): Promise<BankRuleItem[]> {
  const rules = must(
    await supabase.from("bank_rules").select("id, direction, field, pattern, vendor_id, category_id, client_id").eq("org_id", orgId).order("pattern"),
    "banking.rules",
  );
  if (rules.length === 0) return [];
  const ids = (key: "vendor_id" | "category_id" | "client_id") => [...new Set(rules.flatMap((r) => (r[key] ? [r[key]!] : [])))];
  const [vendors, categories, clients] = await Promise.all([
    ids("vendor_id").length ? supabase.from("vendors").select("id, name").in("id", ids("vendor_id")) : Promise.resolve({ data: [], error: null }),
    ids("category_id").length ? supabase.from("expense_categories").select("id, name").in("id", ids("category_id")) : Promise.resolve({ data: [], error: null }),
    ids("client_id").length ? supabase.from("clients").select("id, display_name").in("id", ids("client_id")) : Promise.resolve({ data: [], error: null }),
  ]);
  const vendorName = new Map(must(vendors, "banking.rules.vendors").map((v) => [v.id, v.name]));
  const categoryName = new Map(must(categories, "banking.rules.categories").map((c) => [c.id, c.name]));
  const clientName = new Map(must(clients, "banking.rules.clients").map((c) => [c.id, c.display_name]));
  return rules.map((r) => ({
    id: r.id,
    direction: r.direction,
    field: r.field,
    pattern: r.pattern,
    vendorName: r.vendor_id ? (vendorName.get(r.vendor_id) ?? null) : null,
    categoryName: r.category_id ? (categoryName.get(r.category_id) ?? null) : null,
    clientName: r.client_id ? (clientName.get(r.client_id) ?? null) : null,
  }));
}

/** Todo lo de la pestaña Banco para una cuenta: movimientos (con sus enlaces y propuestas), extractos y cifras. */
export async function loadBankPage(supabase: Supabase, orgId: string, filters: BankFilters, today: CivilDate): Promise<BankPageData> {
  const currentMonth = today.slice(0, 7);
  const [accounts, rules] = await Promise.all([loadAccounts(supabase, orgId), loadRules(supabase, orgId)]);
  const account =
    accounts.find((a) => a.id === filters.account) ?? accounts.find((a) => a.pendingCount > 0) ?? accounts.find((a) => a.lastStatementEnd) ?? accounts[0] ?? null;
  const emptyKpis: BankKpis = {
    pending: { count: 0, creditsCents: 0, debitsCents: 0, netCents: 0 },
    month: { month: currentMonth, total: 0, explained: 0, reconciled: 0, ignored: 0 },
    unexplainedNetCents: 0,
    highCount: 0,
  };
  if (!account) return { accounts, account: null, transactions: [], truncated: false, statements: [], kpis: emptyKpis, rules, months: [] };

  let list = supabase.from("bank_transactions_overview").select(TX_COLUMNS).eq("account_id", account.id);
  if (filters.status === "pending") list = list.in("status", ["unmatched", "partial"]);
  else if (filters.status !== "all") list = list.eq("status", filters.status);
  if (filters.month) list = list.gte("booked_on", `${filters.month}-01`).lte("booked_on", monthEnd(filters.month));
  const q = sanitize(filters.q);
  if (q) {
    const cents = parseMoneyInput(q.replace(/^[+-]/, ""));
    const clauses = [`concept.ilike.*${q}*`, `counterparty.ilike.*${q}*`, `reference.ilike.*${q}*`];
    if (cents !== null && cents > 0) clauses.push(`amount_cents.eq.${cents}`, `amount_cents.eq.${-cents}`);
    list = list.or(clauses.join(","));
  }

  const [listed, pending, monthRows, statements, dates] = await Promise.all([
    list.order("booked_on", { ascending: false }).order("position", { ascending: false }).order("id").limit(LIST_LIMIT + 1),
    loadPendingTransactions(supabase, orgId, { accountId: account.id }),
    fetchAll(
      (a, b) =>
        supabase
          .from("bank_transactions_overview")
          .select("booked_on, amount_cents, remaining_cents, status")
          .eq("account_id", account.id)
          .gte("booked_on", `${currentMonth}-01`)
          .order("id")
          .range(a, b),
      "banking.month",
    ),
    supabase
      .from("bank_statements_overview")
      .select(
        "id, file_name, format, period_start, period_end, movements_in_file, new_count, imported_at, imported_by_name, opening_balance_cents, closing_balance_cents, balance_gap_cents",
      )
      .eq("account_id", account.id)
      .order("period_end", { ascending: false })
      .order("imported_at", { ascending: false }),
    fetchAll(
      (a, b) => supabase.from("bank_transactions").select("booked_on").eq("account_id", account.id).order("booked_on", { ascending: false }).order("id").range(a, b),
      "banking.months",
    ),
  ]);
  const rows = must(listed, "banking.list");

  // Propuestas: con todos los pendientes de la cuenta a la vez (así se ve cuáles compiten).
  const window = windowOf(pending);
  const suggestions = window ? suggestAll(pending, await loadMatchContext(supabase, orgId, window)) : new Map<string, Suggestion[]>();
  const matched = rows.flatMap((r) => (r.id && (r.matched_cents ?? 0) > 0 ? [r.id] : []));
  const matches = await loadMatches(supabase, matched);

  const truncated = rows.length > LIST_LIMIT;
  const transactions = rows.slice(0, LIST_LIMIT).flatMap((row) => {
    const item = toItem(row as OverviewRow, row.id ? (matches.get(row.id) ?? []) : [], row.id ? (suggestions.get(row.id) ?? []) : []);
    return item ? [item] : [];
  });

  const digest = bankingDigest(
    pending.map((tx) => ({ bookedOn: tx.bookedOn, amountCents: tx.amountCents, remainingCents: tx.remainingCents, status: "unmatched" as const })),
    today,
  );
  const progress = monthProgress(
    monthRows.flatMap((r) =>
      r.booked_on && r.amount_cents !== null && r.status
        ? [{ bookedOn: r.booked_on, amountCents: r.amount_cents, remainingCents: r.remaining_cents ?? 0, status: r.status }]
        : [],
    ),
    currentMonth,
  );
  const highCount = pending.filter((tx) => {
    const best = suggestions.get(tx.id)?.[0];
    return best && best.confidence === "alta" && best.kind !== "new_expense";
  }).length;

  return {
    accounts,
    account,
    transactions,
    truncated,
    statements: must(statements, "banking.statements").flatMap((s): BankStatementItem[] =>
      s.id && s.file_name && s.format && s.period_start && s.period_end && s.imported_at
        ? [
            {
              id: s.id,
              fileName: s.file_name,
              format: s.format,
              periodStart: s.period_start,
              periodEnd: s.period_end,
              movementsInFile: s.movements_in_file ?? 0,
              newCount: s.new_count ?? 0,
              importedAt: s.imported_at,
              importedByName: s.imported_by_name,
              openingBalanceCents: s.opening_balance_cents,
              closingBalanceCents: s.closing_balance_cents,
              balanceGapCents: s.balance_gap_cents,
            },
          ]
        : [],
    ),
    kpis: { pending: digest.pending, month: { month: currentMonth, ...progress }, unexplainedNetCents: digest.pending.netCents, highCount },
    rules,
    months: [...new Set(dates.map((d) => d.booked_on.slice(0, 7)))],
  };
}

/**
 * Búsqueda manual de lo que explica un movimiento: facturas con pendiente, cobros y gastos aún sin
 * enlazar y remesas. Primero lo del importe exacto; después, lo más cercano en fecha.
 */
export async function searchBankTargets(supabase: Supabase, orgId: string, tx: BankTx, query: string): Promise<BankTargetOption[]> {
  const context = await loadMatchContext(supabase, orgId, { from: addDays(tx.bookedOn, -90), to: addDays(tx.bookedOn, 90) });
  const clients = new Map(context.clients.map((c) => [c.id, c.name]));
  const vendors = new Map(context.vendors.map((v) => [v.id, v.name]));
  const credit = tx.amountCents > 0;
  const options: { option: BankTargetOption; date: string; text: string }[] = [];
  if (credit) {
    for (const i of context.invoices) {
      const clientName = clients.get(i.clientId) ?? "";
      options.push({
        option: { kind: "invoice", id: i.id, number: i.number, clientName, issuedOn: i.issuedOn, dueOn: i.dueOn, availableCents: i.outstandingCents },
        date: i.dueOn ?? i.issuedOn,
        text: `${i.number ?? ""} ${clientName}`,
      });
    }
    for (const r of context.remittances) {
      options.push({
        option: { kind: "remittance", id: r.id, collectionOn: r.collectionOn, status: r.status, itemsCount: r.itemsCount, availableCents: r.availableCents },
        date: r.collectionOn,
        text: "remesa sepa",
      });
    }
  }
  for (const p of context.payments) {
    if (Math.sign(p.amountCents) !== Math.sign(tx.amountCents)) continue;
    const clientName = clients.get(p.clientId) ?? "";
    options.push({
      option: { kind: "payment", id: p.id, invoiceNumber: p.invoiceNumber, clientName, paidOn: p.paidOn, availableCents: p.availableCents },
      date: p.paidOn,
      text: `${p.invoiceNumber ?? ""} ${clientName}`,
    });
  }
  for (const e of context.expenses) {
    if (e.totalCents === 0 || Math.sign(e.totalCents) === Math.sign(tx.amountCents)) continue;
    const vendorName = e.vendorId ? (vendors.get(e.vendorId) ?? null) : null;
    options.push({
      option: { kind: "expense", id: e.id, vendorName, description: e.description, issuedOn: e.issuedOn, paidOn: e.paidOn, availableCents: e.availableCents },
      date: e.paidOn ?? e.payableOn,
      text: `${vendorName ?? ""} ${e.description} ${e.vendorInvoiceNumber ?? ""}`,
    });
  }
  const needle = normalizeText(query);
  const cents = parseMoneyInput(query.trim().replace(/^[+-]/, ""));
  const filtered = needle
    ? options.filter((o) => normalizeText(o.text).includes(needle) || (cents !== null && cents > 0 && o.option.availableCents === cents))
    : options;
  return filtered
    .sort(
      (a, b) =>
        Number(b.option.availableCents === tx.remainingCents) - Number(a.option.availableCents === tx.remainingCents) ||
        Math.abs(daysBetween(a.date, tx.bookedOn)) - Math.abs(daysBetween(b.date, tx.bookedOn)),
    )
    .slice(0, SEARCH_LIMIT)
    .map((o) => o.option);
}
