import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { reconciliationStatus } from "@/domain/banking/status";
import { endToEndId, proposeSpanishCreditorId } from "@/domain/collections";
import { addDays } from "@/domain/dates/civil-date";
import { computeLine } from "@/domain/tax";
import { nowInZone } from "@/lib/clock";
import { as, createDb, createOrg, createUser, type Db, onboardingPayload } from "./harness";

let db: Db;
let owner: string;
let orgId: string;
let ids: { freelancer: string; company: string; vat21: string };
let account: string;
let clientA: string;
let categories: Record<string, string>;

const ACCOUNT_IBAN = "ES9121000418450200051332";
const DEBTOR_IBAN = "ES7921000813610123456789";

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0]!;
}

async function asOwner<T>(sql: string, params: unknown[] = []): Promise<T> {
  return as(db, owner, () => one<T>(sql, params));
}

async function asUser<T>(user: string, sql: string, params: unknown[] = []): Promise<T[]> {
  return as(db, user, async () => (await db.query<T>(sql, params)).rows);
}

/** Rechaza con el hint de Postgres que la app traduce a un mensaje. */
async function expectHint(promise: Promise<unknown>, hint: string) {
  await expect(promise).rejects.toMatchObject({ hint });
}

/** Días desde hoy en la zona de la org (el periodo de un extracto no puede acabar después de hoy). */
function daysFromToday(days: number): string {
  return addDays(nowInZone("Europe/Madrid").date, days);
}

async function addMember(email: string, role: "viewer" | "partner" | "owner", org = orgId): Promise<string> {
  const user = await createUser(db, email);
  await db.query("insert into public.members (org_id, user_id, role, full_name, initials) values ($1, $2, $3, $4, 'XX')", [
    org,
    user,
    role,
    email.split("@")[0],
  ]);
  return user;
}

type Row = {
  booked_on: string;
  amount_cents: number;
  concept?: string;
  fingerprint?: string;
  reference?: string;
};

let fileCounter = 0;

/** Importa un extracto como lo hace el servidor (la huella la calcula TS; aquí se da hecha). */
async function importStatement(
  rows: Row[],
  opts: { user?: string; account?: string; start?: string; end?: string; opening?: number | null; closing?: number | null; hash?: string } = {},
) {
  const dates = rows.map((r) => r.booked_on).sort();
  const payload = {
    account_id: opts.account ?? account,
    file_name: `extracto-${++fileCounter}.n43`,
    file_hash: opts.hash ?? randomUUID().replace(/-/g, "").padEnd(64, "0"),
    format: "n43",
    period_start: opts.start ?? dates[0] ?? daysFromToday(-10),
    period_end: opts.end ?? dates.at(-1) ?? daysFromToday(-1),
    opening_balance_cents: opts.opening ?? null,
    closing_balance_cents: opts.closing ?? null,
    balance_note: "Extracto de prueba",
    transactions: rows.map((r, position) => ({
      position,
      booked_on: r.booked_on,
      value_on: r.booked_on,
      amount_cents: r.amount_cents,
      concept: r.concept ?? "",
      reference: r.reference ?? null,
      fingerprint: r.fingerprint ?? `${r.booked_on}|${r.amount_cents}|1`,
    })),
  };
  return as(db, opts.user ?? owner, async () =>
    (
      await one<{ r: { statement_id: string; inserted: number; duplicates: number; opening_recorded_cents: number | null; closing_previous_cents: number | null } }>(
        "select public.bank_import_statement($1::jsonb) as r",
        [JSON.stringify(payload)],
      )
    ).r,
  );
}

async function txId(fingerprint: string): Promise<string> {
  return (await one<{ id: string }>("select id from public.bank_transactions where fingerprint = $1", [fingerprint])).id;
}

async function txState(id: string) {
  return one<{ status: string; matched_cents: number; remaining_cents: number }>(
    "select status, matched_cents, remaining_cents from public.bank_transactions_overview where id = $1",
    [id],
  );
}

type Allocation = { kind: "invoice" | "payment" | "expense" | "remittance"; id: string; amount_cents: number; method?: string };

async function apply(transactionId: string, allocations: Allocation[], opts: { user?: string; rule?: Record<string, unknown> } = {}) {
  return as(db, opts.user ?? owner, async () =>
    (
      await one<{ r: { match_ids: string[] } }>("select public.bank_apply($1::jsonb) as r", [
        JSON.stringify({ transaction_id: transactionId, allocations, rule: opts.rule ?? null }),
      ])
    ).r,
  );
}

async function undo(matchId: string, user = owner) {
  return as(db, user, async () => (await one<{ r: Record<string, unknown> }>("select public.bank_undo_match($1) as r", [matchId])).r);
}

async function invoiceState(invoiceId: string) {
  return one<{ status: string; outstanding_cents: number; paid_cents: number }>(
    "select status, outstanding_cents, paid_cents from public.invoices_overview where id = $1",
    [invoiceId],
  );
}

/** Factura emitida del autónomo (IRPF 15 %): 900 € de base → 954 € a cobrar. */
async function issuedInvoice(clientId: string, issuedOn = daysFromToday(-40)): Promise<string> {
  const lines = [
    ["Mantenimiento web", 15_000],
    ["Campaña Meta Ads", 75_000],
  ].map(([description, cents]) => {
    const amounts = computeLine({
      quantity: "1",
      unitPriceCents: cents as number,
      discountBps: 0,
      vatBps: 2100,
      irpfBps: 1500,
      irpfApplies: true,
    });
    return {
      id: randomUUID(),
      description,
      quantity: "1",
      unit_price_cents: cents,
      discount_bps: 0,
      base_cents: amounts.baseCents,
      tax_rate_id: ids.vat21,
      vat_bps: 2100,
      vat_regime: "general",
      vat_cents: amounts.vatCents,
      irpf_applies: true,
      irpf_cents: amounts.irpfCents,
      billing_type: "monthly",
    };
  });
  return as(db, owner, async () => {
    const { id } = await one<{ id: string }>("select public.save_invoice_draft($1::jsonb) as id", [
      JSON.stringify({
        header: { issuer_id: ids.freelancer, client_id: clientId, irpf_bps: 1500, payment_terms_days: 30, payment_method: "transfer" },
        lines,
      }),
    ]);
    await db.query("select public.issue_invoice_begin($1, $2::date)", [id, issuedOn]);
    await db.query("select public.issue_invoice_complete($1, $2::jsonb)", [id, JSON.stringify({ pdf_path: `${orgId}/${id}.pdf` })]);
    return id;
  });
}

async function insertExpense(input: { total: number; paidOn?: string | null; issuedOn?: string }): Promise<string> {
  return (
    await asOwner<{ id: string }>(
      `insert into public.expenses (org_id, issuer_id, category_id, description, issued_on, base_cents, total_cents, paid_on, payment_method)
       values ($1, $2, $3, 'Suite de diseño', $4, $5, $5, $6, 'card') returning id`,
      [orgId, ids.freelancer, categories["Software y suscripciones"], input.issuedOn ?? daysFromToday(-20), input.total, input.paidOn ?? null],
    )
  ).id;
}

beforeEach(async () => {
  db = await createDb();
  owner = await createUser(db, "owner@example.com");
  orgId = await createOrg(db, owner);
  const issuers = await db.query<{ id: string; kind: string }>("select id, kind from public.issuers where org_id = $1", [orgId]);
  await db.query(
    "update public.issuers set address_line = 'Carrer Major 1', postal_code = '08301', city = 'Mataró', iban = $2 where org_id = $1",
    [orgId, ACCOUNT_IBAN],
  );
  const rates = await db.query<{ id: string; name: string }>("select id, name from public.tax_rates where org_id = $1", [orgId]);
  ids = {
    freelancer: issuers.rows.find((r) => r.kind === "self_employed")!.id,
    company: issuers.rows.find((r) => r.kind === "company")!.id,
    vat21: rates.rows.find((r) => r.name === "IVA 21 %")!.id,
  };
  const cats = await db.query<{ id: string; name: string }>("select id, name from public.expense_categories where org_id = $1", [orgId]);
  categories = Object.fromEntries(cats.rows.map((r) => [r.name, r.id]));
  account = (
    await asOwner<{ id: string }>(
      "insert into public.cash_accounts (org_id, issuer_id, name, iban) values ($1, $2, 'Cuenta principal', $3) returning id",
      [orgId, ids.freelancer, ACCOUNT_IBAN],
    )
  ).id;
  clientA = (
    await asOwner<{ id: string }>(
      `insert into public.clients (org_id, display_name, legal_name, tax_id, address_line, postal_code, city)
       values ($1, 'Restaurant del Port', 'Restaurant del Port SL', 'B12345674', 'Passeig Marítim 3', '08301', 'Mataró') returning id`,
      [orgId],
    )
  ).id;
});

describe("RLS del banco", () => {
  it("un viewer lo lee todo pero no importa, no concilia, no ignora y no escribe en las tablas", async () => {
    await importStatement([{ booked_on: daysFromToday(-3), amount_cents: 10_000 }]);
    const viewer = await addMember("viewer@example.com", "viewer");
    const tx = await txId(`${daysFromToday(-3)}|10000|1`);

    expect(await asUser(viewer, "select id from public.bank_transactions_overview")).toHaveLength(1);
    expect(await asUser(viewer, "select id from public.bank_statements_overview")).toHaveLength(1);
    await expect(importStatement([{ booked_on: daysFromToday(-2), amount_cents: 5_000 }], { user: viewer })).rejects.toMatchObject({
      code: "42501",
    });
    const invoice = await issuedInvoice(clientA);
    await expect(apply(tx, [{ kind: "invoice", id: invoice, amount_cents: 10_000 }], { user: viewer })).rejects.toMatchObject({ code: "42501" });
    await expect(asUser(viewer, "select public.bank_ignore($1, 'other', 'nota')", [tx])).rejects.toMatchObject({ code: "42501" });
    await expect(
      asUser(viewer, "insert into public.bank_ignores (org_id, transaction_id, reason) values ($1, $2, 'personal')", [orgId, tx]),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(viewer, "insert into public.bank_rules (org_id, direction, field, pattern, client_id) values ($1, 'credit', 'concept', 'PORT', $2)", [
        orgId,
        clientA,
      ]),
    ).rejects.toThrow(/row-level security/);
  });

  it("un socio no escribe en las tablas directamente (solo con las RPC), pero sí lleva las reglas", async () => {
    const partner = await addMember("socio@example.com", "partner");
    await importStatement([{ booked_on: daysFromToday(-3), amount_cents: -2_000 }], { user: partner });
    const tx = await txId(`${daysFromToday(-3)}|-2000|1`);
    await expect(asUser(partner, "update public.bank_transactions set amount_cents = 1 where id = $1", [tx])).rejects.toThrow(/permission denied/);
    await expect(
      asUser(partner, "insert into public.bank_matches (org_id, transaction_id, amount_cents, expense_id) values ($1, $2, 1, $2)", [orgId, tx]),
    ).rejects.toThrow(/permission denied/);
    const [rule] = await asUser<{ id: string }>(
      partner,
      "insert into public.bank_rules (org_id, direction, field, pattern, category_id) values ($1, 'debit', 'concept', 'ADOBE CREATIVE', $2) returning id",
      [orgId, categories["Software y suscripciones"]],
    );
    expect(rule?.id).toBeTruthy();
    // Un cargo apunta a una categoría; un abono, a un cliente.
    await expect(
      asUser(partner, "insert into public.bank_rules (org_id, direction, field, pattern, client_id) values ($1, 'debit', 'concept', 'PORT', $2)", [
        orgId,
        clientA,
      ]),
    ).rejects.toThrow(/check constraint/);
  });

  it("otra org no ve nada, no importa en una cuenta ajena y no concilia con cobros ajenos", async () => {
    await importStatement([{ booked_on: daysFromToday(-3), amount_cents: 10_000 }]);
    const stranger = await createUser(db, "otra@example.com");
    const otherOrg = await createOrg(db, stranger, onboardingPayload({ org: { name: "Otra", slug: "otra" }, invitations: [] }));
    expect(await asUser(stranger, "select id from public.bank_transactions_overview")).toEqual([]);
    expect(await asUser(stranger, "select id from public.bank_matches_overview")).toEqual([]);
    await expect(importStatement([{ booked_on: daysFromToday(-2), amount_cents: 5_000 }], { user: stranger })).rejects.toMatchObject({
      code: "42501",
    });

    // Un movimiento de la otra org no puede enlazar un cobro de esta (FK compuesta + comprobación).
    const otherIssuer = (await one<{ id: string }>("select id from public.issuers where org_id = $1 limit 1", [otherOrg])).id;
    const otherAccount = (
      await asUser<{ id: string }>(stranger, "insert into public.cash_accounts (org_id, issuer_id, name) values ($1, $2, 'Suya') returning id", [
        otherOrg,
        otherIssuer,
      ])
    )[0]!.id;
    await importStatement([{ booked_on: daysFromToday(-2), amount_cents: 954_00, fingerprint: "otra|1" }], { user: stranger, account: otherAccount });
    const invoice = await issuedInvoice(clientA);
    await expectHint(apply(await txId("otra|1"), [{ kind: "invoice", id: invoice, amount_cents: 954_00 }], { user: stranger }), "bank_invoice_not_payable");
  });
});

describe("importación y huella", () => {
  it("dos movimientos idénticos del mismo día entran los dos; un extracto que se solapa no los duplica", async () => {
    const day = daysFromToday(-5);
    const first = await importStatement([
      { booked_on: day, amount_cents: -999, fingerprint: `${day}|-999|1`, concept: "COMPRA TARJ. CAFETERIA" },
      { booked_on: day, amount_cents: -999, fingerprint: `${day}|-999|2`, concept: "COMPRA TARJ. CAFETERIA" },
      { booked_on: daysFromToday(-4), amount_cents: 50_000, fingerprint: `${daysFromToday(-4)}|50000|1` },
    ]);
    expect(first).toMatchObject({ inserted: 3, duplicates: 0 });

    const second = await importStatement([
      { booked_on: day, amount_cents: -999, fingerprint: `${day}|-999|1` },
      { booked_on: day, amount_cents: -999, fingerprint: `${day}|-999|2` },
      { booked_on: daysFromToday(-4), amount_cents: 50_000, fingerprint: `${daysFromToday(-4)}|50000|1` },
      { booked_on: daysFromToday(-2), amount_cents: -1_500, fingerprint: `${daysFromToday(-2)}|-1500|1` },
    ]);
    expect(second).toMatchObject({ inserted: 1, duplicates: 3 });
    expect((await one<{ n: number }>("select count(*)::int as n from public.bank_transactions where account_id = $1", [account])).n).toBe(4);
    // Cada movimiento se queda con el extracto que lo trajo primero.
    const { rows } = await db.query<{ statement_id: string }>("select statement_id from public.bank_transactions order by booked_on, position");
    expect(rows.map((r) => r.statement_id)).toEqual([first.statement_id, first.statement_id, first.statement_id, second.statement_id]);
  });

  it("el mismo fichero dos veces es la misma importación; un movimiento fuera del periodo no entra", async () => {
    const hash = "a".repeat(64);
    await importStatement([{ booked_on: daysFromToday(-5), amount_cents: 100 }], { hash });
    await expectHint(importStatement([{ booked_on: daysFromToday(-5), amount_cents: 100 }], { hash }), "bank_statement_duplicate");
    await expectHint(
      importStatement([{ booked_on: daysFromToday(-9), amount_cents: 100 }], { start: daysFromToday(-5), end: daysFromToday(-1) }),
      "bank_statement_period",
    );
    await expectHint(importStatement([{ booked_on: daysFromToday(0), amount_cents: 100 }], { end: daysFromToday(1) }), "bank_statement_period");
    await expectHint(
      importStatement([
        { booked_on: daysFromToday(-3), amount_cents: 100, fingerprint: "x" },
        { booked_on: daysFromToday(-3), amount_cents: 100, fingerprint: "x" },
      ]),
      "bank_statement_invalid",
    );
  });

  it("los saldos del extracto son saldos de caja: el inicial si no había, el final siempre; la vista comprueba que cuadran", async () => {
    const start = daysFromToday(-10);
    const end = daysFromToday(-1);
    // Un saldo manual el día del cierre: el del banco lo sustituye.
    await asOwner("insert into public.cash_balances (org_id, account_id, balance_on, balance_cents, source) values ($1, $2, $3, 1, 'manual')", [
      orgId,
      account,
      end,
    ]);
    const result = await importStatement(
      [
        { booked_on: daysFromToday(-8), amount_cents: 50_000 },
        { booked_on: daysFromToday(-4), amount_cents: -20_000 },
      ],
      { start, end, opening: 100_000, closing: 130_000 },
    );
    expect(result).toMatchObject({ opening_recorded_cents: 100_000, closing_previous_cents: 1 });
    const balances = await db.query<{ balance_on: Date; balance_cents: number; source: string }>(
      "select balance_on, balance_cents, source from public.cash_balances where account_id = $1 order by balance_on",
      [account],
    );
    expect(balances.rows.map((b) => [b.balance_cents, b.source])).toEqual([
      [100_000, "import"],
      [130_000, "import"],
    ]);
    expect(await one("select opening_balance_cents, closing_balance_cents, balance_gap_cents, new_count from public.bank_statements_overview")).toEqual({
      opening_balance_cents: 100_000,
      closing_balance_cents: 130_000,
      balance_gap_cents: 0,
      new_count: 2,
    });
    // La posición de caja del módulo de Finanzas ya ve el saldo del banco.
    expect(await one("select balance_cents from public.cash_position where account_id = $1", [account])).toEqual({ balance_cents: 130_000 });

    // Un saldo inicial que no coincide con el que ya había se conserva (el resumen lo avisa); el final
    // del banco sustituye al anterior. Los dos extractos siguen cuadrando con todos los movimientos.
    const again = await importStatement([{ booked_on: daysFromToday(-1), amount_cents: 7_000, fingerprint: "late|1" }], {
      start,
      end,
      opening: 999_999,
      closing: 137_000,
    });
    expect(again).toMatchObject({ inserted: 1, opening_recorded_cents: 100_000, closing_previous_cents: 130_000 });
    const gaps = async () =>
      (await db.query<{ balance_gap_cents: number | null }>("select balance_gap_cents from public.bank_statements_overview")).rows.map(
        (r) => r.balance_gap_cents,
      );
    expect(await gaps()).toEqual([0, 0]);
    // Un saldo cambiado a mano después descuadra los extractos que lo usan.
    await asOwner("update public.cash_balances set balance_cents = 136000 where account_id = $1 and balance_on = $2", [account, end]);
    expect(await gaps()).toEqual([-1_000, -1_000]);
  });
});

describe("importes de los enlaces", () => {
  it("un abono cobra una factura (crea el cobro y su enlace) y nunca supera su pendiente ni el movimiento", async () => {
    const invoice = await issuedInvoice(clientA);
    await importStatement([{ booked_on: daysFromToday(-2), amount_cents: 100_000, concept: "TRANSF RESTAURANT DEL PORT" }]);
    const tx = await txId(`${daysFromToday(-2)}|100000|1`);

    await expectHint(apply(tx, [{ kind: "invoice", id: invoice, amount_cents: 95_401 }]), "bank_match_exceeds_outstanding");
    const { match_ids } = await apply(tx, [{ kind: "invoice", id: invoice, amount_cents: 95_400 }]);
    expect(match_ids).toHaveLength(1);
    expect(await invoiceState(invoice)).toMatchObject({ status: "paid", outstanding_cents: 0 });
    const payment = await one<{ amount_cents: number; paid_on: Date; method: string }>(
      "select amount_cents, paid_on, method from public.payments where invoice_id = $1",
      [invoice],
    );
    expect(payment).toMatchObject({ amount_cents: 95_400, method: "transfer" });
    expect(await txState(tx)).toEqual({ status: "partial", matched_cents: 95_400, remaining_cents: 4_600 });

    // Lo que queda (46 €) no da para otra factura entera: el movimiento no se puede pasar.
    const second = await issuedInvoice(clientA);
    await expectHint(apply(tx, [{ kind: "invoice", id: second, amount_cents: 5_000 }]), "bank_match_exceeds_movement");
    await apply(tx, [{ kind: "invoice", id: second, amount_cents: 4_600 }]);
    expect(await txState(tx)).toEqual({ status: "reconciled", matched_cents: 100_000, remaining_cents: 0 });
    expect(await invoiceState(second)).toMatchObject({ status: "overdue", outstanding_cents: 95_400 - 4_600 });
  });

  it("un movimiento reparte entre varias facturas de una vez, y si un reparto falla no se escribe nada", async () => {
    const a = await issuedInvoice(clientA);
    const b = await issuedInvoice(clientA);
    await importStatement([{ booked_on: daysFromToday(-1), amount_cents: 190_800 }]);
    const tx = await txId(`${daysFromToday(-1)}|190800|1`);

    await expectHint(
      apply(tx, [
        { kind: "invoice", id: a, amount_cents: 95_400 },
        { kind: "invoice", id: b, amount_cents: 95_401 },
      ]),
      "bank_match_exceeds_outstanding",
    );
    expect(await txState(tx)).toMatchObject({ status: "unmatched" });
    expect((await one<{ n: number }>("select count(*)::int as n from public.payments")).n).toBe(0);

    await apply(tx, [
      { kind: "invoice", id: a, amount_cents: 95_400 },
      { kind: "invoice", id: b, amount_cents: 95_400 },
    ]);
    expect(await txState(tx)).toMatchObject({ status: "reconciled" });
    expect([(await invoiceState(a)).status, (await invoiceState(b)).status]).toEqual(["paid", "paid"]);
  });

  it("una factura se cobra con varios movimientos (parciales) hasta su pendiente, no más", async () => {
    const invoice = await issuedInvoice(clientA);
    await importStatement([
      { booked_on: daysFromToday(-6), amount_cents: 50_000, fingerprint: "p1" },
      { booked_on: daysFromToday(-3), amount_cents: 45_400, fingerprint: "p2" },
      { booked_on: daysFromToday(-2), amount_cents: 1_000, fingerprint: "p3" },
    ]);
    await apply(await txId("p1"), [{ kind: "invoice", id: invoice, amount_cents: 50_000 }]);
    expect(await invoiceState(invoice)).toMatchObject({ status: "overdue", outstanding_cents: 45_400 });
    await apply(await txId("p2"), [{ kind: "invoice", id: invoice, amount_cents: 45_400 }]);
    expect(await invoiceState(invoice)).toMatchObject({ status: "paid", outstanding_cents: 0 });
    await expectHint(apply(await txId("p3"), [{ kind: "invoice", id: invoice, amount_cents: 1_000 }]), "bank_match_exceeds_outstanding");
  });

  it("enlazar un cobro ya registrado no crea nada; no supera el cobro y el signo tiene que cuadrar", async () => {
    const invoice = await issuedInvoice(clientA);
    const payment = (
      await asOwner<{ id: string }>(
        "insert into public.payments (org_id, invoice_id, amount_cents, paid_on) values ($1, $2, 95400, $3) returning id",
        [orgId, invoice, daysFromToday(-3)],
      )
    ).id;
    await importStatement([
      { booked_on: daysFromToday(-3), amount_cents: 95_400, fingerprint: "in" },
      { booked_on: daysFromToday(-3), amount_cents: 95_400, fingerprint: "in2" },
      { booked_on: daysFromToday(-2), amount_cents: -95_400, fingerprint: "out" },
    ]);
    await expectHint(apply(await txId("out"), [{ kind: "payment", id: payment, amount_cents: 95_400 }]), "bank_match_direction");
    await expectHint(apply(await txId("out"), [{ kind: "invoice", id: invoice, amount_cents: 1 }]), "bank_match_direction");
    await apply(await txId("in"), [{ kind: "payment", id: payment, amount_cents: 95_400 }]);
    expect((await one<{ n: number }>("select count(*)::int as n from public.payments")).n).toBe(1);
    // El mismo cobro no se explica dos veces.
    await expectHint(apply(await txId("in2"), [{ kind: "payment", id: payment, amount_cents: 1 }]), "bank_match_exceeds_target");
  });

  it("un cargo paga un gasto pendiente (queda pagado ese día) y nunca más de lo que cuesta", async () => {
    const expense = await insertExpense({ total: 7_260 });
    await importStatement([
      { booked_on: daysFromToday(-4), amount_cents: -7_260, fingerprint: "c1" },
      { booked_on: daysFromToday(-4), amount_cents: 7_260, fingerprint: "c2" },
    ]);
    await expectHint(apply(await txId("c2"), [{ kind: "expense", id: expense, amount_cents: 7_260 }]), "bank_match_direction");
    await expectHint(apply(await txId("c1"), [{ kind: "expense", id: expense, amount_cents: 7_261 }]), "bank_match_exceeds_movement");
    await apply(await txId("c1"), [{ kind: "expense", id: expense, amount_cents: 7_260, method: "card" }]);
    const row = await one<{ status: string; paid_on: Date }>("select status, paid_on from public.expenses_overview where id = $1", [expense]);
    expect(row.status).toBe("paid");
    expect(row.paid_on.toISOString().slice(0, 10)).toBe(daysFromToday(-4));
  });
});

describe("deshacer", () => {
  it("deshacer un cobro creado por el enlace lo borra; deshacer el enlace de un cobro que ya existía lo conserva", async () => {
    const invoice = await issuedInvoice(clientA);
    await importStatement([
      { booked_on: daysFromToday(-3), amount_cents: 95_400, fingerprint: "u1" },
      { booked_on: daysFromToday(-2), amount_cents: 10_000, fingerprint: "u2" },
    ]);
    const [created] = (await apply(await txId("u1"), [{ kind: "invoice", id: invoice, amount_cents: 95_400 }])).match_ids;
    expect(await undo(created!)).toMatchObject({ deleted_payment: true, invoice_id: invoice });
    expect(await invoiceState(invoice)).toMatchObject({ outstanding_cents: 95_400 });
    expect(await txState(await txId("u1"))).toMatchObject({ status: "unmatched" });

    const manual = (
      await asOwner<{ id: string }>(
        "insert into public.payments (org_id, invoice_id, amount_cents, paid_on) values ($1, $2, 10000, $3) returning id",
        [orgId, invoice, daysFromToday(-2)],
      )
    ).id;
    const [linked] = (await apply(await txId("u2"), [{ kind: "payment", id: manual, amount_cents: 10_000 }])).match_ids;
    expect(await undo(linked!)).toMatchObject({ deleted_payment: false });
    expect((await one<{ n: number }>("select count(*)::int as n from public.payments where id = $1", [manual])).n).toBe(1);
    await expectHint(undo(linked!), "bank_match_not_found");
  });

  it("deshacer el pago de un gasto que se dio por pagado lo deja pendiente; si ya estaba pagado, sigue pagado", async () => {
    const pending = await insertExpense({ total: 5_000 });
    const paid = await insertExpense({ total: 3_000, paidOn: daysFromToday(-6) });
    await importStatement([
      { booked_on: daysFromToday(-5), amount_cents: -5_000, fingerprint: "g1" },
      { booked_on: daysFromToday(-6), amount_cents: -3_000, fingerprint: "g2" },
    ]);
    const [m1] = (await apply(await txId("g1"), [{ kind: "expense", id: pending, amount_cents: 5_000 }])).match_ids;
    const [m2] = (await apply(await txId("g2"), [{ kind: "expense", id: paid, amount_cents: 3_000 }])).match_ids;
    expect(await undo(m1!)).toMatchObject({ expense_unpaid: true });
    expect(await undo(m2!)).toMatchObject({ expense_unpaid: false });
    const statuses = await db.query<{ id: string; status: string }>("select id, status from public.expenses_overview where id = any($1)", [[pending, paid]]);
    expect(Object.fromEntries(statuses.rows.map((r) => [r.id, r.status]))).toEqual({ [pending]: "overdue", [paid]: "paid" });
  });

  it("crear un gasto desde un movimiento lo deja pagado y enlazado; deshacerlo lo borra", async () => {
    await importStatement([{ booked_on: daysFromToday(-3), amount_cents: -12_100, fingerprint: "e1" }]);
    const tx = await txId("e1");
    const created = await as(db, owner, async () =>
      (
        await one<{ r: { expense_id: string; match_id: string; vendor_id: string } }>("select public.bank_create_expense($1::jsonb) as r", [
          JSON.stringify({
            transaction_id: tx,
            expense: {
              issuer_id: ids.freelancer,
              new_vendor_name: "Papelería Riera",
              category_id: categories["Equipos y material"],
              description: "Material de oficina",
              issued_on: daysFromToday(-3),
              base_cents: 10_000,
              vat_bps: 2100,
              vat_cents: 2_100,
              vat_deductible: true,
              irpf_bps: 0,
              irpf_cents: 0,
              total_cents: 12_100,
              payment_method: "card",
            },
            rule: { direction: "debit", field: "concept", pattern: "PAPELERIA RIERA", vendor_id: null, category_id: categories["Equipos y material"] },
          }),
        ])
      ).r,
    );
    expect(await txState(tx)).toMatchObject({ status: "reconciled" });
    const expense = await one<{ status: string; source: string; vendor_name: string }>(
      "select status, source, vendor_name from public.expenses_overview where id = $1",
      [created.expense_id],
    );
    expect(expense).toEqual({ status: "paid", source: "import", vendor_name: "Papelería Riera" });
    expect(await one("select pattern, category_id from public.bank_rules")).toEqual({
      pattern: "PAPELERIA RIERA",
      category_id: categories["Equipos y material"],
    });

    // Los importes los vuelve a comprobar la base de datos (total = base + IVA − IRPF), como en Finanzas,
    // y el gasto no puede pasar del movimiento.
    await importStatement([{ booked_on: daysFromToday(-2), amount_cents: -100, fingerprint: "e2" }]);
    const createExpense = (expense: Record<string, unknown>) =>
      as(db, owner, () =>
        db.query("select public.bank_create_expense($1::jsonb)", [
          JSON.stringify({
            transaction_id: expense.transaction_id,
            expense: {
              issuer_id: ids.freelancer,
              category_id: categories["Equipos y material"],
              description: "Cable",
              issued_on: daysFromToday(-2),
              vat_bps: 2100,
              ...expense,
            },
          }),
        ]),
      );
    const e2 = await txId("e2");
    await expect(createExpense({ transaction_id: e2, base_cents: 100, vat_cents: 21, total_cents: 100 })).rejects.toThrow(/check constraint/);
    await expectHint(createExpense({ transaction_id: e2, base_cents: 100, vat_cents: 21, total_cents: 121 }), "bank_match_exceeds_movement");
    await expectHint(createExpense({ transaction_id: e2, base_cents: -100, vat_cents: -21, total_cents: -121 }), "bank_match_direction");
    await expect(createExpense({ transaction_id: "00000000-0000-0000-0000-000000000000", base_cents: 1, total_cents: 1 })).rejects.toMatchObject({
      code: "42501",
    });

    expect(await undo(created.match_id)).toMatchObject({ deleted_expense: true });
    expect((await one<{ n: number }>("select count(*)::int as n from public.expenses where id = $1", [created.expense_id])).n).toBe(0);
    expect(await txState(tx)).toMatchObject({ status: "unmatched" });
  });
});

describe("estado derivado", () => {
  it("sin conciliar → parcial → conciliado; ignorado con su motivo; y la vista y el dominio dicen lo mismo", async () => {
    const expense = await insertExpense({ total: 2_000 });
    const other = await insertExpense({ total: 1_000 });
    await importStatement([
      { booked_on: daysFromToday(-2), amount_cents: -3_000, fingerprint: "s1" },
      { booked_on: daysFromToday(-2), amount_cents: 50_000, fingerprint: "s2" },
    ]);
    const tx = await txId("s1");
    const check = async (id: string) => {
      const row = await one<{ status: string; amount_cents: number; matched_cents: number; ignored_reason: string | null }>(
        "select status, amount_cents, matched_cents, ignored_reason from public.bank_transactions_overview where id = $1",
        [id],
      );
      expect(row.status).toBe(
        reconciliationStatus({ amountCents: Number(row.amount_cents), matchedCents: Number(row.matched_cents), ignored: row.ignored_reason !== null }),
      );
      return row.status;
    };
    expect(await check(tx)).toBe("unmatched");
    await apply(tx, [{ kind: "expense", id: expense, amount_cents: 2_000 }]);
    expect(await check(tx)).toBe("partial");
    await apply(tx, [{ kind: "expense", id: other, amount_cents: 1_000 }]);
    expect(await check(tx)).toBe("reconciled");

    // Un movimiento con algo conciliado no se ignora; uno ignorado no se concilia.
    await expectHint(asOwner("select public.bank_ignore($1, 'internal_transfer')", [tx]), "bank_transaction_matched");
    const transfer = await txId("s2");
    await asOwner("select public.bank_ignore($1, 'internal_transfer', 'A la cuenta de la SL')", [transfer]);
    expect(await check(transfer)).toBe("ignored");
    const invoice = await issuedInvoice(clientA);
    await expectHint(apply(transfer, [{ kind: "invoice", id: invoice, amount_cents: 50_000 }]), "bank_transaction_ignored");
    // "Otro motivo" necesita una nota.
    await expect(asOwner("select public.bank_ignore($1, 'other')", [transfer])).rejects.toThrow(/check constraint/);
    await asOwner("select public.bank_unignore($1)", [transfer]);
    expect(await check(transfer)).toBe("unmatched");
  });

  it("un extracto con movimientos decididos no se borra; sin decisiones, se borra con sus movimientos", async () => {
    const { statement_id } = await importStatement([
      { booked_on: daysFromToday(-2), amount_cents: -3_000, fingerprint: "d1" },
      { booked_on: daysFromToday(-1), amount_cents: 3_000, fingerprint: "d2" },
    ]);
    await asOwner("select public.bank_ignore($1, 'personal')", [await txId("d1")]);
    await expectHint(asOwner("select public.bank_delete_statement($1)", [statement_id]), "bank_statement_in_use");
    await asOwner("select public.bank_unignore($1)", [await txId("d1")]);
    expect(await asOwner("select public.bank_delete_statement($1) as n", [statement_id])).toEqual({ n: 2 });
    expect((await one<{ n: number }>("select count(*)::int as n from public.bank_transactions")).n).toBe(0);
  });

  it("confirmar con una regla la aprende; confirmar otra vez con otro destino la actualiza", async () => {
    const clientB = (
      await asOwner<{ id: string }>(
        "insert into public.clients (org_id, display_name, legal_name, tax_id, address_line, postal_code, city) values ($1, 'Cafè', 'Cafè SL', '12345678Z', 'C/ 1', '08301', 'Mataró') returning id",
        [orgId],
      )
    ).id;
    const a = await issuedInvoice(clientA);
    const b = await issuedInvoice(clientB);
    await importStatement([
      { booked_on: daysFromToday(-3), amount_cents: 95_400, fingerprint: "r1" },
      { booked_on: daysFromToday(-2), amount_cents: 95_400, fingerprint: "r2" },
    ]);
    const rule = (clientId: string) => ({ direction: "credit", field: "counterparty", pattern: "RESTAURANT PORT", client_id: clientId });
    await apply(await txId("r1"), [{ kind: "invoice", id: a, amount_cents: 95_400 }], { rule: rule(clientA) });
    await apply(await txId("r2"), [{ kind: "invoice", id: b, amount_cents: 95_400 }], { rule: rule(clientB) });
    const { rows } = await db.query<{ client_id: string }>("select client_id from public.bank_rules");
    expect(rows).toEqual([{ client_id: clientB }]);
  });
});

describe("remesas SEPA", () => {
  it("el abono de una remesa enviada la cobra (un cobro por recibo) y la enlaza; más de lo que abona, no", async () => {
    const invoice = await issuedInvoice(clientA);
    await asOwner(
      `insert into public.sepa_creditors (org_id, issuer_id, creditor_identifier, creditor_identifier_confirmed_at, iban)
       values ($1, $2, $3, now(), $4)`,
      [orgId, ids.freelancer, proposeSpanishCreditorId("12345678Z"), ACCOUNT_IBAN],
    );
    const mandate = (
      await asOwner<{ id: string }>(
        `insert into public.client_mandates (org_id, client_id, issuer_id, reference, debtor_name, iban, signed_on)
         values ($1, $2, $3, 'PORT-1', 'Restaurant del Port SL', $4, $5) returning id`,
        [orgId, clientA, ids.freelancer, DEBTOR_IBAN, daysFromToday(-100)],
      )
    ).id;
    const remittance = await as(db, owner, async () =>
      (
        await one<{ id: string }>("select public.sepa_save_remittance($1::jsonb) as id", [
          JSON.stringify({ issuer_id: ids.freelancer, collection_on: daysFromToday(3), invoice_ids: [invoice] }),
        ])
      ).id,
    );
    const item = await one<{ id: string; invoice_number: string }>(
      "select id, invoice_number from public.sepa_remittance_items_overview where remittance_id = $1",
      [remittance],
    );
    await as(db, owner, () =>
      db.query("select public.sepa_mark_generated($1::jsonb)", [
        JSON.stringify({
          remittance_id: remittance,
          message_id: "REM-TEST-1",
          generated_at: new Date().toISOString(),
          file_path: `${orgId}/${remittance}/remesa.xml`,
          creditor: { creditor_id: proposeSpanishCreditorId("12345678Z"), name: "Socio Autónomo Uno", iban: ACCOUNT_IBAN, bic: null },
          items: [{ id: item.id, mandate_id: mandate, amount_cents: 95_400, sequence_type: "FRST", end_to_end_id: endToEndId(item.invoice_number, item.id) }],
        }),
      ]),
    );
    await asOwner("select public.sepa_mark_sent($1)", [remittance]);

    await importStatement([
      { booked_on: daysFromToday(0), amount_cents: 95_400, fingerprint: "rem", concept: "ABONO REMESA RECIBOS" },
      { booked_on: daysFromToday(0), amount_cents: 95_400, fingerprint: "rem2" },
    ], { end: daysFromToday(0) });
    await apply(await txId("rem"), [{ kind: "remittance", id: remittance, amount_cents: 95_400 }]);
    expect(await one("select status from public.sepa_remittances where id = $1", [remittance])).toEqual({ status: "settled" });
    expect(await invoiceState(invoice)).toMatchObject({ status: "paid" });
    expect(await one("select settled_remittance, target_kind from public.bank_matches_overview")).toEqual({
      settled_remittance: true,
      target_kind: "remittance",
    });
    // Ya está explicada entera: otro abono no la vuelve a enlazar ni la cobra dos veces.
    await expectHint(apply(await txId("rem2"), [{ kind: "remittance", id: remittance, amount_cents: 95_400 }]), "bank_match_exceeds_target");
    expect((await one<{ n: number }>("select count(*)::int as n from public.payments where invoice_id = $1", [invoice])).n).toBe(1);
  });
});
