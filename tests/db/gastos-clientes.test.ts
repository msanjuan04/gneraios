import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { costAssignmentIssues, type CostAssignment } from "@/domain/finance/allocation";
import { planRebillLines, type RebillExpense } from "@/domain/finance/rebill";
import type { DraftLinePayload, TaxRateRef } from "@/domain/invoicing/draft-line";
import { as, createDb, createOrg, createUser, type Db, onboardingPayload } from "./harness";

// Gastos por cliente (20260927100000_gastos_clientes.sql) y su repercusión
// (20260927120000_repercutir_gastos.sql): invariantes, RLS, estado derivado, la RPC
// rebill_expenses y la guarda de lo ya repercutido.

let db: Db;
let owner: string;
let orgId: string;
let companyId: string;
let freelancerId: string;
let categoryId: string;
let clientId: string;
let otherClientId: string;
let vat21: TaxRateRef;

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0]!;
}

async function asUser<T>(user: string, sql: string, params: unknown[] = []): Promise<T[]> {
  return as(db, user, async () => (await db.query<T>(sql, params)).rows);
}

/** Rechaza con el hint de Postgres que la app traduce a un mensaje. */
async function expectHint(promise: Promise<unknown>, hint: string) {
  await expect(promise).rejects.toMatchObject({ hint });
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

type ExpenseFields = {
  allocation?: "company" | "client" | "hosted_sites";
  client?: string | null;
  rebill?: boolean;
  markup?: number;
  base?: number;
  description?: string;
  issuedOn?: string;
};

async function insertExpense(user: string, f: ExpenseFields = {}): Promise<string> {
  const base = f.base ?? 10_000;
  const [row] = await asUser<{ id: string }>(
    user,
    `insert into public.expenses (org_id, issuer_id, category_id, description, issued_on, base_cents, total_cents,
                                  allocation, client_id, rebill, rebill_markup_bps)
     values ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9, $10) returning id`,
    [orgId, companyId, categoryId, f.description ?? "Servidor", f.issuedOn ?? "2026-09-01", base, f.allocation ?? "company", f.client ?? null, f.rebill ?? false, f.markup ?? 0],
  );
  return row!.id;
}

/** Un gasto de `client` para repercutir (10 % de margen salvo que se diga otro). */
const rebillable = (client: string, f: ExpenseFields = {}) => insertExpense(owner, { allocation: "client", client, rebill: true, markup: 1000, ...f });

async function subscription(f: { allocation?: string; client?: string | null; rebill?: boolean; markup?: number }): Promise<string> {
  const [row] = await asUser<{ id: string }>(
    owner,
    `insert into public.expense_subscriptions (org_id, issuer_id, category_id, description, base_cents, billing_interval, starts_on,
                                               billing_day, allocation, client_id, rebill, rebill_markup_bps)
     values ($1, $2, $3, 'Hosting', 2000, 'monthly', '2026-09-01', 1, $4, $5, $6, $7) returning id`,
    [orgId, companyId, categoryId, f.allocation ?? "company", f.client ?? null, f.rebill ?? false, f.markup ?? 0],
  );
  return row!.id;
}

/** Los pendientes tal como los lee el servidor (expenses_overview). */
async function pending(ids: string[]): Promise<RebillExpense[]> {
  const { rows } = await db.query<{
    id: string;
    client_id: string;
    description: string;
    vendor_name: string | null;
    issued_on: string;
    period_start: string | null;
    base_cents: string;
    rebill_markup_bps: number;
  }>(
    `select id, client_id, description, vendor_name, issued_on::text, period_start::text, base_cents, rebill_markup_bps
     from public.expenses_overview where id = any($1::uuid[]) and rebill_state = 'pending'`,
    [ids],
  );
  return rows.map((r) => ({
    id: r.id,
    clientId: r.client_id,
    description: r.description,
    vendorName: r.vendor_name,
    issuedOn: r.issued_on,
    periodStart: r.period_start,
    baseCents: Number(r.base_cents),
    markupBps: r.rebill_markup_bps,
  }));
}

/** Las líneas de la repercusión, calculadas por el dominio como en el servidor. */
function rebillLines(expenses: RebillExpense[], startPosition = 0, irpfBps = 0) {
  return planRebillLines(expenses, {
    startPosition,
    taxRate: vat21,
    invoiceIrpfBps: irpfBps,
    irpfApplies: true,
    describe: (e) => `Repercusión: ${e.description}`,
    newId: randomUUID,
  });
}

type Payload = { draft: Record<string, unknown>; links: { expense_id: string; line_id: string }[] };

/** Repercusión en un borrador nuevo del cliente. */
function newDraftPayload(client: string, expenses: RebillExpense[], issuer = companyId): Payload {
  const lines = rebillLines(expenses);
  return {
    draft: { header: { issuer_id: issuer, client_id: client, irpf_bps: 0, language: "es", payment_method: "transfer" }, lines: lines.map((l) => l.line) },
    links: lines.map((l) => ({ expense_id: l.expenseId, line_id: l.line.id })),
  };
}

async function rebill(user: string, payload: Payload): Promise<string> {
  return as(db, user, async () => (await one<{ id: string }>("select public.rebill_expenses($1::jsonb) as id", [JSON.stringify(payload)])).id);
}

async function saveDraft(payload: Record<string, unknown>, user = owner): Promise<string> {
  return as(db, user, async () => (await one<{ id: string }>("select public.save_invoice_draft($1::jsonb) as id", [JSON.stringify(payload)])).id);
}

/** Las líneas guardadas de un borrador, en el formato del JSON de las RPC (para reenviarlas). */
async function draftLines(invoiceId: string): Promise<DraftLinePayload[]> {
  const { rows } = await db.query<Record<string, unknown>>("select * from public.invoice_lines where invoice_id = $1 order by position", [invoiceId]);
  return rows.map((l) => ({
    id: l.id as string,
    position: l.position as number,
    description: l.description as string,
    quantity: String(l.quantity),
    unit_price_cents: Number(l.unit_price_cents),
    discount_bps: l.discount_bps as number,
    base_cents: Number(l.base_cents),
    tax_rate_id: l.tax_rate_id as string,
    vat_bps: l.vat_bps as number,
    vat_regime: l.vat_regime as DraftLinePayload["vat_regime"],
    vat_cents: Number(l.vat_cents),
    irpf_applies: l.irpf_applies as boolean,
    irpf_cents: Number(l.irpf_cents),
    legal_note: (l.legal_note as string | null) ?? null,
    billing_type: l.billing_type as DraftLinePayload["billing_type"],
    period_start: null,
    period_end: null,
    contract_line_id: null,
    rectifies_line_id: null,
    billable_item_id: null,
  }));
}

async function expenseRow(id: string) {
  return one<{ rebill_invoice_line_id: string | null; rebill_state: string | null; rebill_invoice_id: string | null; rebill_invoice_number: string | null }>(
    "select rebill_invoice_line_id, rebill_state, rebill_invoice_id, rebill_invoice_number from public.expenses_overview where id = $1",
    [id],
  );
}

beforeEach(async () => {
  db = await createDb();
  owner = await createUser(db, "owner@example.com");
  orgId = await createOrg(db, owner);
  const issuers = await db.query<{ id: string; kind: string }>("select id, kind from public.issuers where org_id = $1", [orgId]);
  companyId = issuers.rows.find((r) => r.kind === "company")!.id;
  freelancerId = issuers.rows.find((r) => r.kind === "self_employed")!.id;
  // Sin dirección no se puede emitir (el onboarding de prueba no la trae).
  await db.query("update public.issuers set address_line = 'Carrer Major 1', postal_code = '08301', city = 'Mataró' where org_id = $1", [orgId]);
  categoryId = (await one<{ id: string }>("select id from public.expense_categories where org_id = $1 and name = 'Servidores y hosting'", [orgId])).id;
  const rate = await one<{ id: string }>("select id from public.tax_rates where org_id = $1 and name = 'IVA 21 %'", [orgId]);
  vat21 = { id: rate.id, rateBps: 2100, regime: "general", legalNote: null };
  const client = (name: string, taxId: string) =>
    asUser<{ id: string }>(
      owner,
      `insert into public.clients (org_id, display_name, legal_name, tax_id, address_line, postal_code, city)
       values ($1, $2, $2, $3, 'Passeig Marítim 3', '08301', 'Mataró') returning id`,
      [orgId, name, taxId],
    );
  clientId = (await client("Restaurant del Port", "B12345674"))[0]!.id;
  otherClientId = (await client("Bodega Nova", "B87654315"))[0]!.id;
});

describe("categorías de infraestructura", () => {
  it("toda org nueva nace con servidores, bases de datos y dominios como infraestructura (y nada más lo es)", async () => {
    const { rows } = await db.query<{ name: string; is_infrastructure: boolean; expense_group: string; is_fixed: boolean }>(
      "select name, is_infrastructure, expense_group, is_fixed from public.expense_categories where org_id = $1 order by position",
      [orgId],
    );
    expect(rows).toHaveLength(19);
    expect(rows.filter((r) => r.is_infrastructure)).toEqual([
      { name: "Servidores y hosting", is_infrastructure: true, expense_group: "operating", is_fixed: true },
      { name: "Bases de datos y APIs", is_infrastructure: true, expense_group: "operating", is_fixed: true },
      { name: "Dominios", is_infrastructure: true, expense_group: "operating", is_fixed: true },
    ]);
    const [created] = await asUser<{ is_infrastructure: boolean }>(
      owner,
      "insert into public.expense_categories (org_id, name) values ($1, 'CDN') returning is_infrastructure",
      [orgId],
    );
    expect(created!.is_infrastructure).toBe(false);
  });
});

describe("a quién sirve un gasto: invariantes", () => {
  it("por defecto es de la empresa, sin cliente y sin repercutir", async () => {
    const id = await insertExpense(owner);
    expect(await one("select allocation, client_id, rebill, rebill_markup_bps, rebill_invoice_line_id from public.expenses where id = $1", [id])).toEqual({
      allocation: "company",
      client_id: null,
      rebill: false,
      rebill_markup_bps: 0,
      rebill_invoice_line_id: null,
    });
  });

  it("lleva cliente si y solo si es de un cliente", async () => {
    await expect(insertExpense(owner, { allocation: "client" })).rejects.toThrow(/expenses_allocation_client/);
    await expect(insertExpense(owner, { allocation: "company", client: clientId })).rejects.toThrow(/expenses_allocation_client/);
    await expect(insertExpense(owner, { allocation: "hosted_sites", client: clientId })).rejects.toThrow(/expenses_allocation_client/);
    await insertExpense(owner, { allocation: "client", client: clientId });
    await insertExpense(owner, { allocation: "hosted_sites" });
  });

  it("solo se repercute lo que es de un cliente, con un margen del 0 al 1.000 %", async () => {
    await expect(insertExpense(owner, { rebill: true })).rejects.toThrow(/expenses_rebill_client/);
    await expect(insertExpense(owner, { allocation: "hosted_sites", rebill: true })).rejects.toThrow(/expenses_rebill_client/);
    await expect(rebillable(clientId, { markup: -1 })).rejects.toThrow(/expenses_markup/);
    await expect(rebillable(clientId, { markup: 100_001 })).rejects.toThrow(/expenses_markup/);
    await rebillable(clientId, { markup: 100_000 });
  });

  it("el cliente tiene que ser de la misma org", async () => {
    const stranger = await createUser(db, "otra@example.com");
    const otherOrg = await createOrg(db, stranger, onboardingPayload({ org: { name: "Otra", slug: "otra" } }));
    const [foreign] = await asUser<{ id: string }>(stranger, "insert into public.clients (org_id, display_name) values ($1, 'Ajeno') returning id", [otherOrg]);
    await expect(insertExpense(owner, { allocation: "client", client: foreign!.id })).rejects.toThrow(/expenses_client_fk/);
  });

  it("una línea de factura solo con «repercutir», y cada línea repercute un solo gasto", async () => {
    const first = await rebillable(clientId);
    const second = await rebillable(clientId, { description: "Dominio" });
    const plain = await insertExpense(owner, { allocation: "client", client: clientId });
    const invoice = await rebill(owner, newDraftPayload(clientId, await pending([first])));
    const [line] = await draftLines(invoice);
    await expect(asUser(owner, "update public.expenses set rebill_invoice_line_id = $2 where id = $1", [plain, line!.id])).rejects.toThrow(
      /expenses_rebill_line/,
    );
    await expect(asUser(owner, "update public.expenses set rebill_invoice_line_id = $2 where id = $1", [second, line!.id])).rejects.toThrow(
      /expenses_rebill_line_idx/,
    );
  });

  it("paridad: la base de datos acepta exactamente lo que el dominio da por bueno (gastos y suscripciones)", async () => {
    const cases: Omit<CostAssignment, "clientId">[] = [];
    for (const allocation of ["company", "client", "hosted_sites"] as const) {
      for (const rebill of [false, true]) for (const rebillMarkupBps of [-1, 0, 1250, 100_000, 100_001]) cases.push({ allocation, rebill, rebillMarkupBps });
    }
    const accepts = (write: () => Promise<unknown>) =>
      write().then(
        () => true,
        () => false,
      );
    for (const c of cases) {
      for (const client of [null, clientId]) {
        const assignment: CostAssignment = { ...c, clientId: client };
        const valid = costAssignmentIssues(assignment).length === 0;
        const label = JSON.stringify({ ...assignment, clientId: Boolean(client) });
        const fields = { allocation: c.allocation, client, rebill: c.rebill, markup: c.rebillMarkupBps };
        // Una a una: el arnés cambia de rol en la única conexión de PGlite.
        expect(await accepts(() => insertExpense(owner, fields)), `expense ${label}`).toBe(valid);
        expect(await accepts(() => subscription(fields)), `subscription ${label}`).toBe(valid);
      }
    }
  });

  it("las suscripciones cumplen lo mismo", async () => {
    await expect(subscription({ allocation: "client" })).rejects.toThrow(/expense_subscriptions_allocation_client/);
    await expect(subscription({ client: clientId })).rejects.toThrow(/expense_subscriptions_allocation_client/);
    await expect(subscription({ rebill: true })).rejects.toThrow(/expense_subscriptions_rebill_client/);
    await expect(subscription({ allocation: "client", client: clientId, rebill: true, markup: 100_001 })).rejects.toThrow(/expense_subscriptions_markup/);
    const id = await subscription({ allocation: "client", client: clientId, rebill: true, markup: 1500 });
    expect(await one("select allocation, client_id, rebill, rebill_markup_bps from public.expense_subscriptions where id = $1", [id])).toEqual({
      allocation: "client",
      client_id: clientId,
      rebill: true,
      rebill_markup_bps: 1500,
    });
  });
});

describe("RLS sin cambios", () => {
  it("un viewer ve a quién sirve cada gasto pero no lo cambia; un socio sí", async () => {
    const viewer = await addMember("viewer@example.com", "viewer");
    const partner = await addMember("socio@example.com", "partner");
    const id = await rebillable(clientId);
    const seen = await asUser<{ allocation: string; client_name: string; rebill_state: string }>(
      viewer,
      "select allocation, client_name, rebill_state from public.expenses_overview where id = $1",
      [id],
    );
    expect(seen).toEqual([{ allocation: "client", client_name: "Restaurant del Port", rebill_state: "pending" }]);
    expect(await asUser(viewer, "update public.expenses set rebill = false where id = $1 returning id", [id])).toEqual([]);
    await expect(
      asUser(viewer, "insert into public.expenses (org_id, issuer_id, category_id, description, issued_on, base_cents, total_cents) values ($1, $2, $3, 'x', '2026-09-01', 1, 1)", [
        orgId,
        companyId,
        categoryId,
      ]),
    ).rejects.toThrow(/row-level security/);
    expect(await asUser(partner, "update public.expenses set rebill_markup_bps = 2000 where id = $1 returning rebill_markup_bps", [id])).toEqual([
      { rebill_markup_bps: 2000 },
    ]);
    const sub = await subscription({ allocation: "client", client: clientId, rebill: true, markup: 500 });
    expect(await asUser(viewer, "select allocation, client_id, rebill_markup_bps from public.expense_subscriptions where id = $1", [sub])).toEqual([
      { allocation: "client", client_id: clientId, rebill_markup_bps: 500 },
    ]);
    expect(await asUser(viewer, "update public.expense_subscriptions set rebill = false where id = $1 returning id", [sub])).toEqual([]);
  });

  it("nadie de otra org ve los gastos ni los repercute", async () => {
    const id = await rebillable(clientId);
    const stranger = await createUser(db, "otra@example.com");
    await createOrg(db, stranger, onboardingPayload({ org: { name: "Otra", slug: "otra" } }));
    expect(await asUser(stranger, "select id from public.expenses_overview where id = $1", [id])).toEqual([]);
    await expect(rebill(stranger, newDraftPayload(clientId, await pending([id])))).rejects.toMatchObject({ code: "42501" });
  });
});

describe("expenses_overview: a quién sirve y en qué punto está la repercusión", () => {
  it("empresa, webs alojadas y cliente; el estado solo existe si se repercute", async () => {
    const company = await insertExpense(owner);
    const shared = await insertExpense(owner, { allocation: "hosted_sites" });
    const direct = await insertExpense(owner, { allocation: "client", client: clientId });
    const toRebill = await rebillable(clientId);
    const { rows } = await db.query<{ id: string; allocation: string; client_id: string | null; client_name: string | null; rebill: boolean; rebill_state: string | null }>(
      "select id, allocation, client_id, client_name, rebill, rebill_state from public.expenses_overview where org_id = $1",
      [orgId],
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(company)).toMatchObject({ allocation: "company", client_id: null, client_name: null, rebill_state: null });
    expect(byId.get(shared)).toMatchObject({ allocation: "hosted_sites", client_id: null, rebill_state: null });
    expect(byId.get(direct)).toMatchObject({ allocation: "client", client_name: "Restaurant del Port", rebill: false, rebill_state: null });
    expect(byId.get(toRebill)).toMatchObject({ allocation: "client", client_id: clientId, rebill: true, rebill_state: "pending" });
  });
});

describe("rebill_expenses", () => {
  it("crea un borrador del cliente con una línea por gasto (base + margen) y enlaza cada gasto con la suya", async () => {
    const server = await rebillable(clientId, { base: 550, markup: 0, issuedOn: "2026-09-01" });
    const domain = await rebillable(clientId, { base: 1_500, markup: 2000, description: "Dominio", issuedOn: "2026-08-15" });
    const invoice = await rebill(owner, newDraftPayload(clientId, await pending([server, domain])));

    const header = await one<{ client_id: string; lifecycle: string; kind: string; subtotal_cents: number; vat_cents: number; total_cents: number }>(
      "select client_id, lifecycle, kind, subtotal_cents, vat_cents, total_cents from public.invoices where id = $1",
      [invoice],
    );
    // 15,00 € + 20 % = 18,00 € y 5,50 €: 23,50 € de base, 4,94 € de IVA (3,78 + 1,16).
    expect(header).toEqual({ client_id: clientId, lifecycle: "draft", kind: "ordinary", subtotal_cents: 2_350, vat_cents: 494, total_cents: 2_844 });
    const lines = await draftLines(invoice);
    expect(lines.map((l) => [l.description, l.unit_price_cents, l.billing_type])).toEqual([
      ["Repercusión: Dominio", 1_800, "one_off"],
      ["Repercusión: Servidor", 550, "one_off"],
    ]);
    expect(await expenseRow(domain)).toMatchObject({ rebill_invoice_line_id: lines[0]!.id, rebill_state: "drafted", rebill_invoice_id: invoice });
    expect(await expenseRow(server)).toMatchObject({ rebill_invoice_line_id: lines[1]!.id, rebill_state: "drafted", rebill_invoice_id: invoice });
  });

  it("es idempotente: repetirla no hace nada (rebill_taken) y no deja borradores a medias", async () => {
    const id = await rebillable(clientId);
    const expenses = await pending([id]);
    const invoice = await rebill(owner, newDraftPayload(clientId, expenses));
    // Lo mismo otra vez (doble clic, o dos socios a la vez): con líneas nuevas, pero el gasto ya no está pendiente.
    await expectHint(rebill(owner, newDraftPayload(clientId, expenses)), "rebill_taken");
    const { rows } = await db.query("select id from public.invoices where client_id = $1", [clientId]);
    expect(rows).toEqual([{ id: invoice }]);
    expect(await draftLines(invoice)).toHaveLength(1);
  });

  it("se añade a un borrador abierto del cliente reenviando todas sus líneas; si ha cambiado entretanto, draft_changed", async () => {
    const existing = await saveDraft({
      header: { issuer_id: companyId, client_id: clientId, irpf_bps: 0 },
      lines: rebillLines([{ id: "manual", clientId, description: "Mantenimiento", vendorName: null, issuedOn: "2026-09-01", periodStart: null, baseCents: 20_000, markupBps: 0 }]).map(
        (l) => ({ ...l.line, description: "Mantenimiento web" }),
      ),
    });
    const id = await rebillable(clientId, { base: 1_000, markup: 0 });
    const { updated_at } = await one<{ updated_at: string }>("select updated_at::text from public.invoices where id = $1", [existing]);
    const current = await draftLines(existing);
    const added = rebillLines(await pending([id]), current.length);
    const payload = (expectedUpdatedAt: string): Payload => ({
      draft: { invoice_id: existing, expected_updated_at: expectedUpdatedAt, lines: [...current, ...added.map((l) => l.line)] },
      links: added.map((l) => ({ expense_id: l.expenseId, line_id: l.line.id })),
    });

    await expectHint(rebill(owner, payload("2000-01-01T00:00:00Z")), "draft_changed");
    expect((await expenseRow(id)).rebill_state).toBe("pending");

    expect(await rebill(owner, payload(updated_at))).toBe(existing);
    const lines = await draftLines(existing);
    expect(lines.map((l) => [l.position, l.description, l.unit_price_cents])).toEqual([
      [0, "Mantenimiento web", 20_000],
      [1, "Repercusión: Servidor", 1_000],
    ]);
    expect(await one("select subtotal_cents from public.invoices where id = $1", [existing])).toEqual({ subtotal_cents: 21_000 });
    expect(await expenseRow(id)).toMatchObject({ rebill_state: "drafted", rebill_invoice_line_id: lines[1]!.id });
  });

  it("solo gastos pendientes del cliente del borrador", async () => {
    const mine = await rebillable(clientId);
    const theirs = await rebillable(otherClientId);
    const notRebilled = await insertExpense(owner, { allocation: "client", client: clientId });
    const company = await insertExpense(owner);
    // Otro cliente: ni en un borrador nuevo de este, ni añadido a un borrador suyo.
    const theirsAsMine: Payload = newDraftPayload(clientId, (await pending([theirs])).map((e) => ({ ...e, clientId })));
    await expectHint(rebill(owner, theirsAsMine), "rebill_taken");
    for (const expense of [notRebilled, company]) {
      const fake: RebillExpense = { id: expense, clientId, description: "x", vendorName: null, issuedOn: "2026-09-01", periodStart: null, baseCents: 100, markupBps: 0 };
      await expectHint(rebill(owner, newDraftPayload(clientId, [fake])), "rebill_taken");
    }
    const theirDraft = await rebill(owner, newDraftPayload(otherClientId, await pending([theirs])));
    const current = await draftLines(theirDraft);
    const added = rebillLines(await pending([mine]), current.length);
    const { updated_at } = await one<{ updated_at: string }>("select updated_at::text from public.invoices where id = $1", [theirDraft]);
    await expectHint(
      rebill(owner, {
        draft: { invoice_id: theirDraft, expected_updated_at: updated_at, lines: [...current, ...added.map((l) => l.line)] },
        links: added.map((l) => ({ expense_id: l.expenseId, line_id: l.line.id })),
      }),
      "rebill_taken",
    );
    expect((await expenseRow(mine)).rebill_state).toBe("pending");
    expect(await draftLines(theirDraft)).toHaveLength(1);
  });

  it("cada gasto va con una línea del borrador, y hace falta al menos uno", async () => {
    const id = await rebillable(clientId);
    const payload = newDraftPayload(clientId, await pending([id]));
    await expect(rebill(owner, { ...payload, links: [{ expense_id: id, line_id: randomUUID() }] })).rejects.toMatchObject({ code: "22023" });
    await expect(rebill(owner, { ...payload, links: [payload.links[0]!, { ...payload.links[0]!, line_id: randomUUID() }] })).rejects.toMatchObject({
      code: "22023",
    });
    await expectHint(rebill(owner, { ...payload, links: [] }), "rebill_empty");
    expect((await expenseRow(id)).rebill_state).toBe("pending");
  });

  it("solo un socio: un viewer no repercute", async () => {
    const viewer = await addMember("viewer@example.com", "viewer");
    const partner = await addMember("socio@example.com", "partner");
    const id = await rebillable(clientId);
    await expect(rebill(viewer, newDraftPayload(clientId, await pending([id])))).rejects.toMatchObject({ code: "42501" });
    await rebill(partner, newDraftPayload(clientId, await pending([id])));
    expect((await expenseRow(id)).rebill_state).toBe("drafted");
  });

  it("al quitar su línea del borrador, o borrar el borrador, el gasto vuelve a estar pendiente", async () => {
    const first = await rebillable(clientId);
    const second = await rebillable(clientId, { description: "Base de datos" });
    const invoice = await rebill(owner, newDraftPayload(clientId, await pending([first, second])));
    const lines = await draftLines(invoice);
    const firstLine = lines.find((l) => l.description === "Repercusión: Servidor")!;
    // El editor guarda el borrador sin esa línea.
    await saveDraft({ invoice_id: invoice, lines: lines.filter((l) => l.id !== firstLine.id) });
    expect(await expenseRow(first)).toMatchObject({ rebill_state: "pending", rebill_invoice_line_id: null });
    expect((await expenseRow(second)).rebill_state).toBe("drafted");

    await asUser(owner, "delete from public.invoices where id = $1", [invoice]);
    expect(await expenseRow(second)).toMatchObject({ rebill_state: "pending", rebill_invoice_line_id: null, rebill_invoice_id: null });
    // Y se puede volver a repercutir.
    await rebill(owner, newDraftPayload(clientId, await pending([first, second])));
    expect((await expenseRow(first)).rebill_state).toBe("drafted");
  });

  it("emitida la factura, el gasto queda repercutido con su número", async () => {
    const id = await rebillable(clientId);
    const invoice = await rebill(owner, newDraftPayload(clientId, await pending([id]), freelancerId));
    await as(db, owner, async () => {
      await db.query("select public.issue_invoice_begin($1)", [invoice]);
      await db.query("select public.issue_invoice_complete($1, $2::jsonb)", [invoice, JSON.stringify({ pdf_path: `${orgId}/${invoice}.pdf` })]);
    });
    const row = await expenseRow(id);
    expect(row).toMatchObject({ rebill_state: "invoiced", rebill_invoice_id: invoice });
    expect(row.rebill_invoice_number).toMatch(/^\d{4}-\d{4}$/);
  });
});

describe("un gasto repercutido queda como se facturó", () => {
  it("no cambia de cliente ni de condiciones, no se borra y no se desengancha a mano; lo demás sí cambia", async () => {
    const id = await rebillable(clientId);
    await rebill(owner, newDraftPayload(clientId, await pending([id])));
    for (const change of [
      `client_id = '${otherClientId}'`,
      "allocation = 'hosted_sites', client_id = null, rebill = false",
      "rebill = false",
      "rebill_markup_bps = 0",
      "rebill_invoice_line_id = null",
    ]) {
      await expectHint(asUser(owner, `update public.expenses set ${change} where id = $1`, [id]), "expense_rebilled");
    }
    await expectHint(asUser(owner, "delete from public.expenses where id = $1", [id]), "expense_rebilled");
    const [updated] = await asUser<{ description: string; paid_on: string }>(
      owner,
      "update public.expenses set description = 'Servidor (corregido)', paid_on = '2026-09-02' where id = $1 returning description, paid_on::text",
      [id],
    );
    expect(updated).toEqual({ description: "Servidor (corregido)", paid_on: "2026-09-02" });
  });

  it("una suscripción con gastos repercutidos no se borra con ellos", async () => {
    const sub = await subscription({ allocation: "client", client: clientId, rebill: true, markup: 0 });
    const [generated] = await asUser<{ id: string }>(
      owner,
      `insert into public.expenses (org_id, issuer_id, category_id, description, issued_on, base_cents, total_cents, subscription_id, period_start,
                                    source, allocation, client_id, rebill)
       values ($1, $2, $3, 'Hosting', '2026-09-01', 2000, 2000, $4, '2026-09-01', 'subscription', 'client', $5, true) returning id`,
      [orgId, companyId, categoryId, sub, clientId],
    );
    await rebill(owner, newDraftPayload(clientId, await pending([generated!.id])));
    await expectHint(asUser(owner, "select public.delete_expense_subscription($1, true)", [sub]), "expense_rebilled");
    expect(await one("select count(*)::int as n from public.expenses where subscription_id = $1", [sub])).toEqual({ n: 1 });
  });
});
