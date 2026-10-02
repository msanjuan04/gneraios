// Sin "server-only": estas lecturas las usan también el cron (generateSubscriptionExpenses), el
// seed de la demo y las herramientas del agente CFO (getFinanceSnapshot). Solo se importan desde
// código de servidor.
//
// Funcionan con el cliente de un miembro (RLS) y con el de servidor (service_role), porque todas
// filtran por la org de forma explícita.

import type { CivilDate } from "@/domain/dates/civil-date";
import { resolvePaymentTermsDays } from "@/domain/invoicing/draft-line";
import type {
  CashBillingContract,
  CashMovement,
  ExpenseMonthRow,
  ExpenseSubscription,
  PendingBillableItem,
  SnapshotAccount,
  SnapshotPendingExpense,
  SnapshotReceivable,
  SnapshotShareholding,
  TaxAmountRow,
} from "@/domain/finance";
import type { Month } from "@/domain/metrics/months";
import { type Db, fetchAll, must, orgSettings } from "@/server/billing/context";

/** Suscripciones de gasto de la org (todas: las apagadas no generan nada, pero se listan). */
export async function loadSubscriptions(db: Db, orgId: string): Promise<ExpenseSubscription[]> {
  const rows = await fetchAll(
    (from, to) =>
      db
        .from("expense_subscriptions")
        .select(
          "id, issuer_id, vendor_id, category_id, member_id, description, base_cents, vat_bps, vat_deductible, irpf_bps, billing_interval, starts_on, ends_on, billing_day, payment_method, is_active, allocation, client_id, rebill, rebill_markup_bps",
        )
        .eq("org_id", orgId)
        .order("id")
        .range(from, to),
    "finance.subscriptions",
  );
  return rows.map((s) => ({
    id: s.id,
    issuerId: s.issuer_id,
    vendorId: s.vendor_id,
    categoryId: s.category_id,
    memberId: s.member_id,
    description: s.description,
    baseCents: s.base_cents,
    vatBps: s.vat_bps,
    vatDeductible: s.vat_deductible,
    irpfBps: s.irpf_bps,
    interval: s.billing_interval,
    startsOn: s.starts_on,
    endsOn: s.ends_on,
    billingDay: s.billing_day,
    paymentMethod: s.payment_method,
    isActive: s.is_active,
    allocation: s.allocation,
    clientId: s.client_id,
    rebill: s.rebill,
    rebillMarkupBps: s.rebill_markup_bps,
  }));
}

/** Periodos ya generados de cada suscripción (la clave de la idempotencia). */
export async function loadGeneratedStarts(db: Db, orgId: string): Promise<Map<string, Set<CivilDate>>> {
  const rows = await fetchAll(
    (from, to) =>
      db
        .from("expenses")
        .select("subscription_id, period_start")
        .eq("org_id", orgId)
        .not("subscription_id", "is", null)
        .order("id")
        .range(from, to),
    "finance.generated",
  );
  const generated = new Map<string, Set<CivilDate>>();
  for (const row of rows) {
    if (!row.subscription_id || !row.period_start) continue;
    const set = generated.get(row.subscription_id) ?? new Set<CivilDate>();
    set.add(row.period_start);
    generated.set(row.subscription_id, set);
  }
  return generated;
}

/** Gastos agregados por emisor, mes y categoría (vista expenses_by_month), de `from` a `to`. */
export async function loadExpenseMonths(
  db: Db,
  orgId: string,
  from: Month,
  to: Month,
): Promise<{ costs: ExpenseMonthRow[]; inputVat: TaxAmountRow[]; withholdings: TaxAmountRow[] }> {
  const rows = await fetchAll(
    (a, b) =>
      db
        .from("expenses_by_month")
        .select("issuer_id, month, category_id, expense_group, is_fixed, cost_cents, deductible_vat_cents, irpf_cents")
        .eq("org_id", orgId)
        .gte("month", from)
        .lte("month", to)
        .order("month")
        .order("issuer_id")
        .order("category_id")
        .range(a, b),
    "finance.expensesByMonth",
  );
  const costs: ExpenseMonthRow[] = [];
  const inputVat: TaxAmountRow[] = [];
  const withholdings: TaxAmountRow[] = [];
  for (const r of rows) {
    if (!r.month || !r.issuer_id || !r.expense_group) continue;
    costs.push({ month: r.month, expenseGroup: r.expense_group, isFixed: r.is_fixed ?? false, costCents: r.cost_cents ?? 0 });
    if (r.deductible_vat_cents) inputVat.push({ issuerId: r.issuer_id, on: r.month, cents: r.deductible_vat_cents });
    if (r.irpf_cents) withholdings.push({ issuerId: r.issuer_id, on: r.month, cents: r.irpf_cents });
  }
  return { costs, inputVat, withholdings };
}

/** IVA repercutido de las facturas emitidas por emisor y mes (vista invoice_taxes_by_month). */
export async function loadOutputVat(db: Db, orgId: string, from: Month, to: Month): Promise<TaxAmountRow[]> {
  const rows = await fetchAll(
    (a, b) =>
      db
        .from("invoice_taxes_by_month")
        .select("issuer_id, month, vat_cents")
        .eq("org_id", orgId)
        .gte("month", from)
        .lte("month", to)
        .order("month")
        .order("issuer_id")
        .range(a, b),
    "finance.outputVat",
  );
  return rows.flatMap((r) => (r.issuer_id && r.month && r.vat_cents ? [{ issuerId: r.issuer_id, on: r.month, cents: r.vat_cents }] : []));
}

export type CashAccountRow = SnapshotAccount & { issuerName: string; iban: string | null };

/** Cuentas de caja con su último saldo (vista cash_position). */
export async function loadCashAccounts(db: Db, orgId: string): Promise<CashAccountRow[]> {
  const rows = must(
    await db
      .from("cash_position")
      .select("account_id, issuer_id, issuer_name, name, iban, is_active, balance_on, balance_cents")
      .eq("org_id", orgId)
      .order("name"),
    "finance.cashPosition",
  );
  return rows.flatMap((r) =>
    r.account_id && r.issuer_id
      ? [
          {
            accountId: r.account_id,
            issuerId: r.issuer_id,
            issuerName: r.issuer_name ?? "",
            name: r.name ?? "",
            iban: r.iban,
            isActive: r.is_active ?? false,
            balanceOn: r.balance_on,
            balanceCents: r.balance_cents,
          },
        ]
      : [],
  );
}

/**
 * Cobros (+, por el emisor de su factura) y pagos de gastos (−, por quien los paga) con fecha
 * posterior a `after` y hasta `today`: lo que ha movido la caja desde el último saldo apuntado.
 */
export async function loadCashMovements(db: Db, orgId: string, after: CivilDate, today: CivilDate): Promise<CashMovement[]> {
  const [payments, expenses] = await Promise.all([
    fetchAll(
      (a, b) =>
        db
          .from("payments")
          .select("id, amount_cents, paid_on, cash_account_id, invoices!inner(issuer_id)")
          .eq("org_id", orgId)
          .gt("paid_on", after)
          .lte("paid_on", today)
          .order("id")
          .range(a, b),
      "finance.movements.payments",
    ),
    fetchAll(
      (a, b) =>
        db
          .from("expenses")
        .select("id, issuer_id, paid_on, total_cents, cash_account_id")
          .eq("org_id", orgId)
          .gt("paid_on", after)
          .lte("paid_on", today)
          .order("id")
          .range(a, b),
      "finance.movements.expenses",
    ),
  ]);
  const receipts = await fetchAll(
    (a, b) => db.from("client_receipts").select("id, issuer_id, received_on, amount_cents, cash_account_id").eq("org_id", orgId).gt("received_on", after).lte("received_on", today).order("id").range(a, b),
    "finance.movements.clientReceipts",
  );
  return [
    ...payments.flatMap((p) => {
      const issuerId = p.invoices.issuer_id;
      return [{ accountId: p.cash_account_id ?? null, issuerId, on: p.paid_on, cents: p.amount_cents }];
    }),
    ...expenses.flatMap((e) => {
      if (!e.paid_on) return [];
      return [{ accountId: e.cash_account_id ?? null, issuerId: e.issuer_id, on: e.paid_on, cents: -e.total_cents }];
    }),
    ...receipts.flatMap((r) => r.issuer_id ? [{ accountId: r.cash_account_id ?? null, issuerId: r.issuer_id, on: r.received_on, cents: r.amount_cents }] : []),
  ];
}

/** Gastos sin pagar, con su fecha de pago (vencimiento o fecha de la factura). */
export async function loadPendingExpenses(db: Db, orgId: string): Promise<SnapshotPendingExpense[]> {
  const rows = await fetchAll(
    (a, b) =>
      db
        .from("expenses_overview")
        .select("id, issuer_id, description, vendor_name, payable_on, total_cents")
        .eq("org_id", orgId)
        .is("paid_on", null)
        .order("payable_on")
        .order("id")
        .range(a, b),
    "finance.pendingExpenses",
  );
  return rows.flatMap((r) =>
    r.id && r.issuer_id && r.payable_on
      ? [
          {
            id: r.id,
            issuerId: r.issuer_id,
            label: r.vendor_name ? `${r.vendor_name} · ${r.description ?? ""}` : (r.description ?? ""),
            payableOn: r.payable_on,
            totalCents: r.total_cents ?? 0,
          },
        ]
      : [],
  );
}

/** Facturas emitidas pendientes de cobro (con IVA, netas de IRPF). */
export async function loadReceivables(db: Db, orgId: string): Promise<SnapshotReceivable[]> {
  const rows = await fetchAll(
    (a, b) =>
      db
        .from("invoices_overview")
        .select("id, issuer_id, number, client_name, due_on, outstanding_cents")
        .eq("org_id", orgId)
        .eq("kind", "ordinary")
        .in("status", ["issued", "overdue"])
        .order("due_on")
        .order("id")
        .range(a, b),
    "finance.receivables",
  );
  return rows.flatMap((r) =>
    r.id && r.issuer_id && (r.outstanding_cents ?? 0) !== 0
      ? [
          {
            invoiceId: r.id,
            issuerId: r.issuer_id,
            number: r.number,
            clientName: r.client_name ?? "",
            dueOn: r.due_on,
            outstandingCents: r.outstanding_cents ?? 0,
          },
        ]
      : [],
  );
}

export type CashBillingData = {
  contracts: CashBillingContract[];
  pendingItems: PendingBillableItem[];
  issuerIrpfBps: Map<string, number>;
  /** Cliente de cada contrato, para las etiquetas de la previsión. */
  contractLabels: Map<string, string>;
};

/**
 * Lo que los contratos firmados van a facturar: sus líneas con el IVA de cada una, sus hitos, sus
 * emisores por fecha y el plazo de pago resuelto, más lo ya facturado (emitido o condonado) para
 * no preverlo dos veces y los conceptos creados aún sin factura emitida.
 */
export async function loadCashBilling(db: Db, orgId: string): Promise<CashBillingData> {
  const [org, contracts, vatRates, issuers, items] = await Promise.all([
    db.from("orgs").select("settings").eq("id", orgId).single(),
    fetchAll(
      (a, b) =>
        db
          .from("contracts")
          .select(
            "id, client_id, signed_on, payment_terms_days, contract_issuers(issuer_id, valid_from), contract_lines(id, billing_type, quantity, unit_price_cents, discount_bps, tax_rate_id, irpf_applies, starts_on, ends_on, billing_day, prorate_first, contract_line_pauses(starts_on, ends_on)), contract_milestones(id, position, percent_bps, planned_on)",
          )
          .eq("org_id", orgId)
          .is("archived_at", null)
          .not("signed_on", "is", null)
          .order("id")
          .range(a, b),
      "finance.billing.contracts",
    ),
    db.from("tax_rates").select("id, rate_bps").eq("org_id", orgId).eq("kind", "vat"),
    db.from("issuers").select("id, default_irpf_bps").eq("org_id", orgId),
    fetchAll(
      (a, b) =>
        db
          .from("billable_items_overview")
          .select("id, contract_id, contract_line_id, source, period_start, milestone_id, billable_on, amount_cents, state")
          .eq("org_id", orgId)
          .order("id")
          .range(a, b),
      "finance.billing.items",
    ),
  ]);
  const settings = orgSettings(must(org, "finance.billing.org"));
  const vat = new Map(must(vatRates, "finance.billing.vat").map((r) => [r.id, r.rate_bps]));
  const issuerIrpfBps = new Map(must(issuers, "finance.billing.issuers").map((i) => [i.id, i.default_irpf_bps]));

  const clientIds = [...new Set(contracts.map((c) => c.client_id))];
  const clients = clientIds.length
    ? must(
        await db
          .from("clients")
          .select("id, display_name, is_business, tax_id_kind, country_code, payment_terms_days")
          .in("id", clientIds),
        "finance.billing.clients",
      )
    : [];
  const clientById = new Map(clients.map((c) => [c.id, c]));

  const billedStarts = new Map<string, Set<CivilDate>>();
  const milestonesWithItems = new Set<string>();
  const pendingItems: PendingBillableItem[] = [];
  for (const item of items) {
    if (!item.id || !item.contract_line_id || !item.contract_id || !item.source || !item.state || !item.billable_on) continue;
    const done = item.state === "invoiced" || item.state === "waived";
    if (item.source === "recurring") {
      if (done && item.period_start) {
        const set = billedStarts.get(item.contract_line_id) ?? new Set<CivilDate>();
        set.add(item.period_start);
        billedStarts.set(item.contract_line_id, set);
      }
      continue;
    }
    if (item.milestone_id) milestonesWithItems.add(item.milestone_id);
    if (!done) {
      pendingItems.push({
        id: item.id,
        contractId: item.contract_id,
        lineId: item.contract_line_id,
        source: item.source,
        periodStart: item.period_start,
        billableOn: item.billable_on,
        amountCents: item.amount_cents ?? 0,
      });
    }
  }

  const contractLabels = new Map<string, string>();
  const cashContracts: CashBillingContract[] = contracts.map((c) => {
    const client = clientById.get(c.client_id);
    contractLabels.set(c.id, client?.display_name ?? "");
    return {
      id: c.id,
      signedOn: c.signed_on,
      paymentTermsDays: resolvePaymentTermsDays(c.payment_terms_days, client?.payment_terms_days, settings.paymentTermsDays),
      issuers: c.contract_issuers.map((ci) => ({ issuerId: ci.issuer_id, validFrom: ci.valid_from })),
      client: {
        isBusiness: client?.is_business ?? true,
        taxIdKind: client?.tax_id_kind ?? "es",
        countryCode: client?.country_code ?? "ES",
      },
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
        vatBps: vat.get(l.tax_rate_id) ?? 0,
        irpfApplies: l.irpf_applies,
      })),
      milestones: c.contract_milestones.map((m) => ({ id: m.id, position: m.position, percentBps: m.percent_bps, plannedOn: m.planned_on })),
      billedMilestoneIds: milestonesWithItems,
      billedStarts,
    };
  });
  return { contracts: cashContracts, pendingItems, issuerIrpfBps, contractLabels };
}

/** Reparto vigente en `on`: el de la fecha más reciente que no la supere. */
export async function loadShareholdingsOn(
  db: Db,
  orgId: string,
  on: CivilDate,
): Promise<{ validFrom: CivilDate | null; rows: SnapshotShareholding[] }> {
  const rows = must(
    await db
      .from("shareholdings")
      .select("member_id, percent_bps, valid_from")
      .eq("org_id", orgId)
      .lte("valid_from", on)
      .order("valid_from", { ascending: false }),
    "finance.shareholdings",
  );
  const validFrom = rows[0]?.valid_from ?? null;
  return {
    validFrom,
    rows: rows.filter((r) => r.valid_from === validFrom).map((r) => ({ memberId: r.member_id, percentBps: r.percent_bps })),
  };
}

/** Categorías fijas de la org (sus suscripciones son los costes fijos cuando aún no hay historia). */
export async function loadFixedCategoryIds(db: Db, orgId: string): Promise<Set<string>> {
  const rows = must(await db.from("expense_categories").select("id").eq("org_id", orgId).eq("is_fixed", true), "finance.fixedCategories");
  return new Set(rows.map((r) => r.id));
}
