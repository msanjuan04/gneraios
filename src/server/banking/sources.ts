// Sin "server-only": lo usa también el seed de la demo. Solo se importa desde código de servidor.
//
// Lo que necesita el matcher, leído con la sesión de quien consulta (RLS): los movimientos
// pendientes y todo lo que los puede explicar (facturas con pendiente, cobros y gastos aún sin
// enlazar del todo, remesas, clientes con sus mandatos, proveedores, reglas, las cuentas propias y
// los socios). Las propuestas se calculan cada vez: no se guardan.

import type { PostgrestError } from "@supabase/supabase-js";
import type {
  BankRule,
  BankTx,
  CategoryRef,
  ClientIdentity,
  ExpenseTemplate,
  MatchContext,
  OpenExpense,
  OpenInvoice,
  OpenRemittance,
  PendingMovement,
  RegisteredPayment,
  VendorIdentity,
} from "@/domain/banking/matcher";
import { PENDING_STATUSES } from "@/domain/banking/status";
import { addDays, type CivilDate } from "@/domain/dates/civil-date";
import type { ExpenseGroup } from "@/domain/finance/expense";
import { type Db, DbError, fetchAll, must } from "@/server/billing/context";

const IN_CHUNK = 120;
/** Días alrededor de los movimientos en los que se buscan cobros y gastos ya registrados. */
const REGISTERED_WINDOW_DAYS = 12;
/** Remesas: su fecha de cobro puede ser anterior al abono. */
const REMITTANCE_WINDOW_DAYS = 45;
/** Últimos gastos que se miran para sacar la plantilla de cada proveedor. */
const TEMPLATE_ROWS = 1500;

export const TX_COLUMNS =
  "id, account_id, issuer_id, account_name, booked_on, value_on, amount_cents, concept, counterparty, counterparty_iban, reference, bank_code, balance_after_cents, position, status, matched_cents, remaining_cents, ignored_reason, ignored_note, ignored_at, statement_id, created_at";

type TxRow = {
  id: string | null;
  account_id: string | null;
  issuer_id: string | null;
  booked_on: string | null;
  amount_cents: number | null;
  remaining_cents: number | null;
  concept: string | null;
  counterparty: string | null;
  counterparty_iban: string | null;
  reference: string | null;
  bank_code: string | null;
};

export function toBankTx(row: TxRow): BankTx | null {
  if (!row.id || !row.account_id || !row.booked_on || row.amount_cents === null) return null;
  return {
    id: row.id,
    accountId: row.account_id,
    issuerId: row.issuer_id,
    bookedOn: row.booked_on,
    amountCents: row.amount_cents,
    remainingCents: row.remaining_cents ?? Math.abs(row.amount_cents),
    concept: row.concept ?? "",
    counterparty: row.counterparty,
    counterpartyIban: row.counterparty_iban,
    reference: row.reference,
    bankCode: row.bank_code,
  };
}

/** Movimientos que esperan a un socio (sin conciliar o parciales), de una cuenta o de unos concretos. */
export async function loadPendingTransactions(db: Db, orgId: string, opts: { accountId?: string; ids?: string[] } = {}): Promise<BankTx[]> {
  if (opts.ids && opts.ids.length === 0) return [];
  const rows = await fetchAll(
    (from, to) => {
      let query = db.from("bank_transactions_overview").select(TX_COLUMNS).eq("org_id", orgId).in("status", [...PENDING_STATUSES]);
      if (opts.accountId) query = query.eq("account_id", opts.accountId);
      if (opts.ids) query = query.in("id", opts.ids);
      return query.order("booked_on", { ascending: false }).order("position", { ascending: false }).order("id").range(from, to);
    },
    "banking.pending",
  );
  return rows.flatMap((row) => {
    const tx = toBankTx(row);
    return tx ? [tx] : [];
  });
}

/** Una consulta `in (...)` por trozos (una URL de PostgREST no admite miles de ids). */
async function inChunks<T>(
  ids: readonly string[],
  run: (chunk: string[]) => PromiseLike<{ data: T[] | null; error: PostgrestError | null }>,
  where: string,
): Promise<T[]> {
  const out: T[] = [];
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += IN_CHUNK) {
    const { data, error } = await run(unique.slice(i, i + IN_CHUNK));
    if (error) throw new DbError(error, where);
    out.push(...(data ?? []));
  }
  return out;
}

/** Lo ya enlazado de cada cobro, gasto o remesa (suma de sus enlaces). */
async function linkedCents(db: Db, column: "payment_id" | "expense_id" | "remittance_id", ids: readonly string[]): Promise<Map<string, number>> {
  const rows = await inChunks(
    ids,
    (chunk) => db.from("bank_matches").select(`${column}, amount_cents`).in(column, chunk),
    `banking.linked.${column}`,
  );
  const sums = new Map<string, number>();
  for (const row of rows as unknown as Record<string, string | number | null>[]) {
    const id = row[column] as string | null;
    if (id) sums.set(id, (sums.get(id) ?? 0) + Number(row.amount_cents ?? 0));
  }
  return sums;
}

/**
 * Todo lo que puede explicar los movimientos de un periodo (`window`: del más antiguo al más
 * reciente de los pendientes).
 */
export async function loadMatchContext(db: Db, orgId: string, window: { from: CivilDate; to: CivilDate }): Promise<MatchContext> {
  const near = { from: addDays(window.from, -REGISTERED_WINDOW_DAYS), to: addDays(window.to, REGISTERED_WINDOW_DAYS) };
  const [invoices, clients, mandates, payments, remittances, pendingExpenses, paidExpenses, vendors, categories, rules, accounts, members, issuers, pending, templates, vat] =
    await Promise.all([
      fetchAll(
        (a, b) =>
          db
            .from("invoices_overview")
            .select("id, number, client_id, issuer_id, issued_on, due_on, outstanding_cents")
            .eq("org_id", orgId)
            .gt("outstanding_cents", 0)
            .order("id")
            .range(a, b),
        "banking.ctx.invoices",
      ),
      fetchAll((a, b) => db.from("clients").select("id, display_name, legal_name, tax_id").eq("org_id", orgId).order("id").range(a, b), "banking.ctx.clients"),
      fetchAll((a, b) => db.from("client_mandates").select("client_id, iban").eq("org_id", orgId).order("id").range(a, b), "banking.ctx.mandates"),
      fetchAll(
        (a, b) =>
          db
            .from("payments")
            .select("id, invoice_id, amount_cents, paid_on")
            .eq("org_id", orgId)
            .gte("paid_on", near.from)
            .lte("paid_on", near.to)
            .order("id")
            .range(a, b),
        "banking.ctx.payments",
      ),
      fetchAll(
        (a, b) =>
          db
            .from("sepa_remittances_overview")
            .select("id, issuer_id, collection_on, status, settled_on, total_cents, returned_cents, items_count")
            .eq("org_id", orgId)
            .in("status", ["generated", "sent", "settled"])
            .gte("collection_on", addDays(window.from, -REMITTANCE_WINDOW_DAYS))
            .order("id")
            .range(a, b),
        "banking.ctx.remittances",
      ),
      fetchAll(
        (a, b) =>
          db
            .from("expenses_overview")
            .select("id, issuer_id, vendor_id, category_id, description, vendor_invoice_number, issued_on, payable_on, paid_on, total_cents, subscription_id")
            .eq("org_id", orgId)
            .is("paid_on", null)
            .order("id")
            .range(a, b),
        "banking.ctx.pendingExpenses",
      ),
      fetchAll(
        (a, b) =>
          db
            .from("expenses_overview")
            .select("id, issuer_id, vendor_id, category_id, description, vendor_invoice_number, issued_on, payable_on, paid_on, total_cents, subscription_id")
            .eq("org_id", orgId)
            .gte("paid_on", near.from)
            .lte("paid_on", near.to)
            .order("id")
            .range(a, b),
        "banking.ctx.paidExpenses",
      ),
      fetchAll(
        (a, b) => db.from("vendors").select("id, name, tax_id, default_category_id").eq("org_id", orgId).is("archived_at", null).order("id").range(a, b),
        "banking.ctx.vendors",
      ),
      db.from("expense_categories").select("id, name, expense_group, archived_at, position").eq("org_id", orgId).order("position"),
      db.from("bank_rules").select("id, direction, field, pattern, vendor_id, category_id, client_id").eq("org_id", orgId),
      db.from("cash_accounts").select("id, name, iban").eq("org_id", orgId),
      db.from("members").select("full_name").eq("org_id", orgId).eq("is_active", true),
      db.from("issuers").select("legal_name, trade_name, kind").eq("org_id", orgId).eq("kind", "self_employed"),
      fetchAll(
        (a, b) =>
          db
            .from("bank_transactions_overview")
            .select("id, account_id, booked_on, amount_cents")
            .eq("org_id", orgId)
            .in("status", [...PENDING_STATUSES])
            .gte("booked_on", addDays(window.from, -5))
            .lte("booked_on", addDays(window.to, 5))
            .order("id")
            .range(a, b),
        "banking.ctx.pendingMovements",
      ),
      db
        .from("expenses_overview")
        .select("vendor_id, category_id, vat_bps, irpf_bps, vat_deductible, description, issued_on")
        .eq("org_id", orgId)
        .not("vendor_id", "is", null)
        .order("issued_on", { ascending: false })
        .limit(TEMPLATE_ROWS),
      db.from("tax_rates").select("rate_bps, regime, is_default").eq("org_id", orgId).eq("kind", "vat").is("archived_at", null),
    ]);

  // Cobros: el número y el cliente de su factura; fuera los que ya explica una remesa cobrada.
  const paymentIds = payments.map((p) => p.id);
  const [paymentInvoices, paymentLinks, remittancePayments] = await Promise.all([
    inChunks(
      payments.map((p) => p.invoice_id),
      (chunk) => db.from("invoices").select("id, number, client_id, issuer_id").in("id", chunk),
      "banking.ctx.paymentInvoices",
    ),
    linkedCents(db, "payment_id", paymentIds),
    inChunks(paymentIds, (chunk) => db.from("sepa_remittance_items").select("payment_id").in("payment_id", chunk), "banking.ctx.remittancePayments"),
  ]);
  const invoiceById = new Map(paymentInvoices.map((i) => [i.id, i]));
  const bySepa = new Set(remittancePayments.flatMap((r) => (r.payment_id ? [r.payment_id] : [])));
  const registered: RegisteredPayment[] = payments.flatMap((p) => {
    const invoice = invoiceById.get(p.invoice_id);
    if (!invoice || bySepa.has(p.id)) return [];
    const available = Math.abs(p.amount_cents) - (paymentLinks.get(p.id) ?? 0);
    if (available <= 0) return [];
    return [
      {
        id: p.id,
        invoiceId: p.invoice_id,
        invoiceNumber: invoice.number,
        clientId: invoice.client_id,
        issuerId: invoice.issuer_id,
        paidOn: p.paid_on,
        amountCents: p.amount_cents,
        availableCents: available,
      },
    ];
  });

  const remittanceLinks = await linkedCents(
    db,
    "remittance_id",
    remittances.flatMap((r) => (r.id ? [r.id] : [])),
  );
  const openRemittances: OpenRemittance[] = remittances.flatMap((r) => {
    if (!r.id || !r.issuer_id || !r.collection_on || !r.status || r.status === "draft") return [];
    const available = (r.total_cents ?? 0) - (r.returned_cents ?? 0) - (remittanceLinks.get(r.id) ?? 0);
    if (available <= 0) return [];
    return [
      {
        id: r.id,
        issuerId: r.issuer_id,
        collectionOn: r.collection_on,
        status: r.status,
        settledOn: r.settled_on,
        availableCents: available,
        itemsCount: r.items_count ?? 0,
      },
    ];
  });

  const expenseRows = [...pendingExpenses, ...paidExpenses.filter((e) => !pendingExpenses.some((p) => p.id === e.id))];
  const expenseLinks = await linkedCents(
    db,
    "expense_id",
    expenseRows.flatMap((e) => (e.id ? [e.id] : [])),
  );
  const expenses: OpenExpense[] = expenseRows.flatMap((e) => {
    if (!e.id || !e.issuer_id || !e.category_id || !e.issued_on || e.total_cents === null) return [];
    const available = Math.abs(e.total_cents) - (expenseLinks.get(e.id) ?? 0);
    if (available <= 0) return [];
    return [
      {
        id: e.id,
        issuerId: e.issuer_id,
        vendorId: e.vendor_id,
        categoryId: e.category_id,
        description: e.description ?? "",
        vendorInvoiceNumber: e.vendor_invoice_number,
        issuedOn: e.issued_on,
        payableOn: e.payable_on ?? e.issued_on,
        paidOn: e.paid_on,
        totalCents: e.total_cents,
        availableCents: available,
        fromSubscription: e.subscription_id !== null,
      },
    ];
  });

  const ibansByClient = new Map<string, string[]>();
  for (const m of mandates) ibansByClient.set(m.client_id, [...(ibansByClient.get(m.client_id) ?? []), m.iban]);
  const clientList: ClientIdentity[] = clients.map((c) => ({
    id: c.id,
    name: c.display_name,
    legalName: c.legal_name,
    taxId: c.tax_id,
    ibans: ibansByClient.get(c.id) ?? [],
  }));

  const templateByVendor = new Map<string, ExpenseTemplate>();
  for (const t of must(templates, "banking.ctx.templates")) {
    if (!t.vendor_id || !t.category_id || templateByVendor.has(t.vendor_id)) continue;
    templateByVendor.set(t.vendor_id, {
      vendorId: t.vendor_id,
      categoryId: t.category_id,
      vatBps: t.vat_bps ?? 0,
      irpfBps: t.irpf_bps ?? 0,
      vatDeductible: t.vat_deductible ?? true,
      description: t.description ?? "",
    });
  }

  const vatRows = must(vat, "banking.ctx.vat").filter((r) => r.regime === "general" || r.rate_bps === 0);
  const openInvoices: OpenInvoice[] = invoices.flatMap((i) =>
    i.id && i.client_id && i.issuer_id && i.issued_on && i.outstanding_cents
      ? [{ id: i.id, number: i.number, clientId: i.client_id, issuerId: i.issuer_id, issuedOn: i.issued_on, dueOn: i.due_on, outstandingCents: i.outstanding_cents }]
      : [],
  );
  const pendingMovements: PendingMovement[] = pending.flatMap((m) =>
    m.id && m.account_id && m.booked_on && m.amount_cents !== null ? [{ id: m.id, accountId: m.account_id, bookedOn: m.booked_on, amountCents: m.amount_cents }] : [],
  );

  return {
    invoices: openInvoices,
    clients: clientList,
    payments: registered,
    remittances: openRemittances,
    expenses,
    vendors: vendors.map((v): VendorIdentity => ({ id: v.id, name: v.name, taxId: v.tax_id, defaultCategoryId: v.default_category_id })),
    categories: must(categories, "banking.ctx.categories").map(
      (c): CategoryRef => ({ id: c.id, name: c.name, group: c.expense_group as ExpenseGroup, archived: c.archived_at !== null }),
    ),
    rules: must(rules, "banking.ctx.rules").map(
      (r): BankRule => ({
        id: r.id,
        direction: r.direction,
        field: r.field,
        pattern: r.pattern,
        vendorId: r.vendor_id,
        categoryId: r.category_id,
        clientId: r.client_id,
      }),
    ),
    ownAccounts: must(accounts, "banking.ctx.accounts").map((a) => ({ id: a.id, name: a.name, iban: a.iban })),
    ownParties: [
      ...must(members, "banking.ctx.members").map((m) => m.full_name),
      ...must(issuers, "banking.ctx.issuers").flatMap((i) => [i.legal_name, ...(i.trade_name ? [i.trade_name] : [])]),
    ].filter((name, index, all) => name && all.indexOf(name) === index),
    pendingMovements,
    templates: [...templateByVendor.values()],
    defaultVatBps: vatRows.find((r) => r.is_default)?.rate_bps ?? vatRows[0]?.rate_bps ?? 0,
  };
}

/** El periodo que cubren unos movimientos (para cargar lo que los puede explicar). */
export function windowOf(txs: readonly Pick<BankTx, "bookedOn">[]): { from: CivilDate; to: CivilDate } | null {
  if (txs.length === 0) return null;
  const dates = txs.map((t) => t.bookedOn).sort();
  return { from: dates[0]!, to: dates.at(-1)! };
}
