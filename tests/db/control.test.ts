import { beforeEach, describe, expect, it } from "vitest";
import { addDays } from "@/domain/dates/civil-date";
import { expenseStatus } from "@/domain/finance/expense";
import { planSubscriptionExpenses, type ExpenseSubscription } from "@/domain/finance/subscriptions";
import { nowInZone } from "@/lib/clock";
import { as, createDb, createOrg, createUser, type Db, onboardingPayload } from "./harness";

let db: Db;
let owner: string;
let orgId: string;
let issuerId: string;
let categories: Record<string, string>;

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

/** Días desde hoy en la zona de la org (la vista deriva el estado con ese "hoy"). */
function daysFromToday(days: number): string {
  return addDays(nowInZone("Europe/Madrid").date, days);
}

async function addMember(email: string, role: "viewer" | "partner" | "owner", org = orgId): Promise<{ user: string; member: string }> {
  const user = await createUser(db, email);
  const { id } = await one<{ id: string }>(
    "insert into public.members (org_id, user_id, role, full_name, initials) values ($1, $2, $3, $4, 'XX') returning id",
    [org, user, role, email.split("@")[0]],
  );
  return { user, member: id };
}

type ExpenseInput = {
  base: number;
  vatBps?: number;
  vat?: number;
  irpfBps?: number;
  irpf?: number;
  total?: number;
  issuedOn?: string;
  dueOn?: string | null;
  paidOn?: string | null;
  category?: string;
  deductible?: boolean;
};

async function insertExpense(user: string, input: ExpenseInput, org = orgId, issuer = issuerId): Promise<string> {
  const vat = input.vat ?? 0;
  const irpf = input.irpf ?? 0;
  const [row] = await asUser<{ id: string }>(
    user,
    `insert into public.expenses (org_id, issuer_id, category_id, description, issued_on, due_on, base_cents, vat_bps, vat_cents,
                                  vat_deductible, irpf_bps, irpf_cents, total_cents, paid_on)
     values ($1, $2, $3, 'Gasto de prueba', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) returning id`,
    [
      org,
      issuer,
      input.category ?? categories["Software y suscripciones"],
      input.issuedOn ?? daysFromToday(-10),
      input.dueOn ?? null,
      input.base,
      input.vatBps ?? 0,
      vat,
      input.deductible ?? true,
      input.irpfBps ?? 0,
      irpf,
      input.total ?? input.base + vat - irpf,
      input.paidOn ?? null,
    ],
  );
  return row!.id;
}

async function insertSubscription(user: string, opts: { startsOn: string; billingDay?: number; interval?: "monthly" | "yearly" } ): Promise<string> {
  const interval = opts.interval ?? "monthly";
  const [row] = await asUser<{ id: string }>(
    user,
    `insert into public.expense_subscriptions (org_id, issuer_id, category_id, description, base_cents, vat_bps, billing_interval,
                                               starts_on, billing_day)
     values ($1, $2, $3, 'Suite de diseño', 6000, 2100, $4, $5, $6) returning id`,
    [orgId, issuerId, categories["Software y suscripciones"], interval, opts.startsOn, interval === "monthly" ? (opts.billingDay ?? 1) : null],
  );
  return row!.id;
}

/** Inserta los gastos de unos periodos como lo hace generateSubscriptionExpenses: idempotente por (suscripción, periodo). */
async function generate(user: string, subscriptionId: string, periods: string[]): Promise<number> {
  return as(db, user, async () => {
    const { affectedRows } = await db.query(
      `insert into public.expenses (org_id, issuer_id, category_id, description, issued_on, base_cents, vat_bps, vat_cents,
                                    total_cents, subscription_id, period_start, source, paid_on, payment_method)
       select $1, $2, $3, 'Suite de diseño', p::date, 6000, 2100, 1260, 7260, $4, p::date, 'subscription', p::date, 'card'
       from unnest($5::text[]) as p
       on conflict (subscription_id, period_start) do nothing`,
      [orgId, issuerId, categories["Software y suscripciones"], subscriptionId, periods],
    );
    return affectedRows ?? 0;
  });
}

beforeEach(async () => {
  db = await createDb();
  owner = await createUser(db, "owner@example.com");
  orgId = await createOrg(db, owner);
  issuerId = (await one<{ id: string }>("select id from public.issuers where org_id = $1 and kind = 'company'", [orgId])).id;
  const { rows } = await db.query<{ id: string; name: string }>("select id, name from public.expense_categories where org_id = $1", [orgId]);
  categories = Object.fromEntries(rows.map((r) => [r.name, r.id]));
});

describe("categorías de gasto", () => {
  it("toda org nueva nace con categorías editables, con su grupo y si son fijas", async () => {
    const { rows } = await db.query<{ name: string; expense_group: string; is_fixed: boolean }>(
      "select name, expense_group, is_fixed from public.expense_categories where org_id = $1 order by position",
      [orgId],
    );
    // 16 de siempre + las 3 de infraestructura (20260927100000_gastos_clientes.sql).
    expect(rows).toHaveLength(19);
    expect(rows[0]).toEqual({ name: "Software y suscripciones", expense_group: "operating", is_fixed: true });
    expect(rows.find((r) => r.name === "Retribución de socios")).toMatchObject({ expense_group: "partner_compensation", is_fixed: true });
    expect(rows.find((r) => r.name === "Freelances y colaboradores")).toMatchObject({ expense_group: "cost_of_sales", is_fixed: false });
    expect(new Set(rows.map((r) => r.expense_group))).toEqual(
      new Set(["operating", "payroll", "partner_compensation", "cost_of_sales", "taxes", "financial", "other"]),
    );
  });

  it("solo un owner las cambia; un nombre repetido (sin mayúsculas ni espacios) no entra", async () => {
    const partner = await addMember("socio@example.com", "partner");
    await expect(
      asUser(partner.user, "insert into public.expense_categories (org_id, name) values ($1, 'Licencias de fuentes')", [orgId]),
    ).rejects.toThrow(/row-level security/);
    const renamed = await asUser(partner.user, "update public.expense_categories set name = 'Otra' where org_id = $1 returning id", [orgId]);
    expect(renamed).toEqual([]);

    await asUser(owner, "insert into public.expense_categories (org_id, name, expense_group) values ($1, 'Licencias de fuentes', 'cost_of_sales')", [orgId]);
    await expect(
      asUser(owner, "insert into public.expense_categories (org_id, name) values ($1, '  seguros ')", [orgId]),
    ).rejects.toThrow(/expense_categories_name_idx/);
  });

  it("una categoría archivada no se elige en gastos nuevos, pero los que ya la tienen la conservan", async () => {
    const expense = await insertExpense(owner, { base: 1000 });
    await asUser(owner, "update public.expense_categories set archived_at = now() where id = $1", [categories["Software y suscripciones"]]);
    await expectHint(insertExpense(owner, { base: 500 }), "category_archived");
    await asUser(owner, "update public.expenses set description = 'Sigue aquí' where id = $1", [expense]);
    expect((await one<{ description: string }>("select description from public.expenses where id = $1", [expense])).description).toBe(
      "Sigue aquí",
    );
  });
});

describe("gastos", () => {
  it("el total es base + IVA − IRPF; el IVA y el IRPF necesitan su tipo", async () => {
    // Freelance: 1.000 € + 21 % − 15 % = 1.060 €.
    const id = await insertExpense(owner, { base: 100_000, vatBps: 2100, vat: 21_000, irpfBps: 1500, irpf: 15_000 });
    expect(await one("select total_cents from public.expenses where id = $1", [id])).toEqual({ total_cents: 106_000 });
    await expect(insertExpense(owner, { base: 100_000, vatBps: 2100, vat: 21_000, total: 121_001 })).rejects.toThrow(/check constraint/);
    await expect(insertExpense(owner, { base: 100_000, vat: 21_000 })).rejects.toThrow(/check constraint/);
    await expect(insertExpense(owner, { base: 100_000, irpf: 1_000 })).rejects.toThrow(/check constraint/);
  });

  it("el estado se deriva: pagado, vencido (por la fecha de pago o, sin ella, la de la factura) o pendiente", async () => {
    const paid = await insertExpense(owner, { base: 1000, issuedOn: daysFromToday(-40), paidOn: daysFromToday(-39) });
    const overdue = await insertExpense(owner, { base: 1000, issuedOn: daysFromToday(-40), dueOn: daysFromToday(-1) });
    const overdueNoDue = await insertExpense(owner, { base: 1000, issuedOn: daysFromToday(-3) });
    const pending = await insertExpense(owner, { base: 1000, issuedOn: daysFromToday(-3), dueOn: daysFromToday(0) });
    const { rows } = await db.query<{ id: string; status: string; payable_on: Date }>(
      "select id, status, payable_on from public.expenses_overview where org_id = $1",
      [orgId],
    );
    const status = Object.fromEntries(rows.map((r) => [r.id, r.status]));
    expect(status).toEqual({ [paid]: "paid", [overdue]: "overdue", [overdueNoDue]: "overdue", [pending]: "pending" });
  });

  it("la vista y el dominio derivan el mismo estado (paridad SQL/TS)", async () => {
    const today = nowInZone("Europe/Madrid").date;
    const cases = [
      { issuedOn: daysFromToday(-40), dueOn: null, paidOn: daysFromToday(-35) },
      { issuedOn: daysFromToday(-40), dueOn: daysFromToday(-2), paidOn: null },
      { issuedOn: daysFromToday(-2), dueOn: daysFromToday(3), paidOn: null },
      { issuedOn: daysFromToday(-1), dueOn: null, paidOn: null },
      { issuedOn: daysFromToday(0), dueOn: null, paidOn: null },
      { issuedOn: daysFromToday(-9), dueOn: daysFromToday(0), paidOn: null },
    ];
    for (const c of cases) {
      const id = await insertExpense(owner, { base: 1000, issuedOn: c.issuedOn, dueOn: c.dueOn, paidOn: c.paidOn });
      const { status } = await one<{ status: string }>("select status from public.expenses_overview where id = $1", [id]);
      expect(status, JSON.stringify(c)).toBe(expenseStatus(c, today));
    }
  });

  it("el coste suma el IVA que no se deduce; la vista mensual da el IVA soportado deducible por trimestre", async () => {
    await insertExpense(owner, { base: 10_000, vatBps: 2100, vat: 2_100, issuedOn: "2026-07-10", paidOn: "2026-07-10" });
    await insertExpense(owner, { base: 5_000, vatBps: 2100, vat: 1_050, deductible: false, issuedOn: "2026-08-03", paidOn: "2026-08-03" });
    await insertExpense(owner, {
      base: 100_000,
      vatBps: 2100,
      vat: 21_000,
      irpfBps: 1500,
      irpf: 15_000,
      category: categories["Freelances y colaboradores"],
      issuedOn: "2026-09-30",
      paidOn: "2026-10-02",
    });
    const overview = await db.query<{ cost_cents: number; deductible_vat_cents: number }>(
      "select cost_cents, deductible_vat_cents from public.expenses_overview where org_id = $1 order by issued_on",
      [orgId],
    );
    expect(overview.rows).toEqual([
      { cost_cents: 10_000, deductible_vat_cents: 2_100 },
      { cost_cents: 6_050, deductible_vat_cents: 0 },
      { cost_cents: 100_000, deductible_vat_cents: 21_000 },
    ]);
    const quarter = await one<{ deductible: number; irpf: number; cost: number }>(
      `select sum(deductible_vat_cents)::int as deductible, sum(irpf_cents)::int as irpf, sum(cost_cents)::int as cost
       from public.expenses_by_month where org_id = $1 and quarter = '2026-07-01'`,
      [orgId],
    );
    expect(quarter).toEqual({ deductible: 23_100, irpf: 15_000, cost: 116_050 });
    const groups = await db.query<{ month: Date; expense_group: string; cost_cents: number }>(
      "select month, expense_group, cost_cents from public.expenses_by_month where org_id = $1 order by month",
      [orgId],
    );
    expect(groups.rows.map((r) => [r.month.toISOString().slice(0, 7), r.expense_group, r.cost_cents])).toEqual([
      ["2026-07", "operating", 10_000],
      ["2026-08", "operating", 6_050],
      ["2026-09", "cost_of_sales", 100_000],
    ]);
  });

  it("el justificante vive en la carpeta de su org", async () => {
    const id = await insertExpense(owner, { base: 1000 });
    await expect(
      asUser(owner, "update public.expenses set attachment_path = $2 where id = $1", [id, `otra-org/${id}.pdf`]),
    ).rejects.toThrow(/check constraint/);
    await asUser(owner, "update public.expenses set attachment_path = $2 where id = $1", [id, `${orgId}/${id}.pdf`]);
  });
});

describe("suscripciones", () => {
  it("generar dos veces los mismos periodos no duplica nada", async () => {
    const sub = await insertSubscription(owner, { startsOn: "2026-06-01" });
    expect(await generate(owner, sub, ["2026-06-01", "2026-07-01", "2026-08-01"])).toBe(3);
    expect(await generate(owner, sub, ["2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01"])).toBe(1);
    expect(await generate(owner, sub, ["2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01"])).toBe(0);
    const { n } = await one<{ n: number }>("select count(*)::int as n from public.expenses where subscription_id = $1", [sub]);
    expect(n).toBe(4);
  });

  it("el plan del dominio (lo que inserta generateSubscriptionExpenses) es idempotente también con dos ejecuciones a la vez", async () => {
    const sub = await insertSubscription(owner, { startsOn: "2026-01-31", billingDay: 31 });
    const subscription: ExpenseSubscription = {
      id: sub,
      issuerId,
      vendorId: null,
      categoryId: categories["Software y suscripciones"]!,
      memberId: null,
      description: "Suite de diseño",
      baseCents: 6000,
      vatBps: 2100,
      vatDeductible: true,
      irpfBps: 0,
      interval: "monthly",
      startsOn: "2026-01-31",
      endsOn: null,
      billingDay: 31,
      paymentMethod: "card",
      isActive: true,
      allocation: "company",
      clientId: null,
      rebill: false,
      rebillMarkupBps: 0,
    };
    const insertPlan = async (generated: Map<string, Set<string>>) =>
      as(db, owner, async () => {
        const planned = planSubscriptionExpenses([subscription], generated, "2026-05-31");
        let inserted = 0;
        for (const p of planned) {
          const { affectedRows } = await db.query(
            `insert into public.expenses (org_id, issuer_id, category_id, description, issued_on, base_cents, vat_bps, vat_cents,
                                          total_cents, subscription_id, period_start, source, paid_on, payment_method)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'subscription', $12, $13)
             on conflict (subscription_id, period_start) do nothing`,
            [orgId, p.issuerId, p.categoryId, p.description, p.issuedOn, p.baseCents, p.vatBps, p.vatCents, p.totalCents, p.subscriptionId, p.periodStart, p.paidOn, p.paymentMethod],
          );
          inserted += affectedRows ?? 0;
        }
        return { planned: planned.length, inserted };
      });
    const loadGenerated = async () => {
      const { rows } = await db.query<{ period_start: Date }>("select period_start from public.expenses where subscription_id = $1", [sub]);
      return new Map([[sub, new Set(rows.map((r) => r.period_start.toISOString().slice(0, 10)))]]);
    };

    expect(await insertPlan(new Map())).toEqual({ planned: 5, inserted: 5 });
    // Otra ejecución que no vio lo anterior (a la vez): planea lo mismo y no inserta nada.
    expect(await insertPlan(new Map())).toEqual({ planned: 5, inserted: 0 });
    // Con lo ya generado, el dominio ni siquiera lo propone.
    expect(await insertPlan(await loadGenerated())).toEqual({ planned: 0, inserted: 0 });
    const { rows } = await db.query<{ period_start: Date; paid_on: Date }>(
      "select period_start, paid_on from public.expenses where subscription_id = $1 order by period_start",
      [sub],
    );
    expect(rows.map((r) => r.period_start.toISOString().slice(0, 10))).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"]);
    // Con tarjeta, cada cargo nace pagado el día del cargo.
    expect(rows.every((r) => r.paid_on.getTime() === r.period_start.getTime())).toBe(true);
  });

  it("lo que una suscripción activa volvería a generar no se borra; apagada, sí", async () => {
    const sub = await insertSubscription(owner, { startsOn: "2026-06-01" });
    await generate(owner, sub, ["2026-06-01", "2026-07-01"]);
    await expectHint(asUser(owner, "delete from public.expenses where subscription_id = $1", [sub]), "expense_generated");
    // Fuera de las fechas de la suscripción (se terminó antes), ya no se regenera: se puede borrar.
    await asUser(owner, "update public.expense_subscriptions set ends_on = '2026-06-30' where id = $1", [sub]);
    await asUser(owner, "delete from public.expenses where subscription_id = $1 and period_start = '2026-07-01'", [sub]);
    await asUser(owner, "update public.expense_subscriptions set is_active = false where id = $1", [sub]);
    await asUser(owner, "delete from public.expenses where subscription_id = $1", [sub]);
    expect((await one<{ n: number }>("select count(*)::int as n from public.expenses where subscription_id = $1", [sub])).n).toBe(0);
  });

  it("con gastos generados no cambia de calendario ni de origen; el importe sí", async () => {
    const sub = await insertSubscription(owner, { startsOn: "2026-06-01" });
    await generate(owner, sub, ["2026-06-01"]);
    await expectHint(
      asUser(owner, "update public.expense_subscriptions set billing_day = 15 where id = $1", [sub]),
      "subscription_schedule_locked",
    );
    await expectHint(
      asUser(owner, "update public.expense_subscriptions set starts_on = '2026-05-01' where id = $1", [sub]),
      "subscription_schedule_locked",
    );
    await asUser(owner, "update public.expense_subscriptions set base_cents = 6500, ends_on = '2026-12-31' where id = $1", [sub]);
    await expectHint(
      asUser(owner, "update public.expenses set period_start = '2026-06-02' where subscription_id = $1", [sub]),
      "expense_origin_fixed",
    );
    await expectHint(
      asUser(owner, "update public.expenses set source = 'manual', subscription_id = null, period_start = null where subscription_id = $1", [sub]),
      "expense_origin_fixed",
    );
  });

  it("delete_expense_subscription borra la suscripción y, si se pide, sus gastos en una transacción", async () => {
    const sub = await insertSubscription(owner, { startsOn: "2026-06-01" });
    await generate(owner, sub, ["2026-06-01", "2026-07-01"]);
    await expect(asUser(owner, "select public.delete_expense_subscription($1)", [sub])).rejects.toThrow(/foreign key/);
    const [result] = await asUser<{ n: number }>(owner, "select public.delete_expense_subscription($1, true) as n", [sub]);
    expect(result).toEqual({ n: 2 });
    expect((await one<{ n: number }>("select count(*)::int as n from public.expense_subscriptions where id = $1", [sub])).n).toBe(0);
    await expectHint(asUser(owner, "select public.delete_expense_subscription($1, true)", [sub]), "subscription_not_found");
  });

  it("las anuales no llevan día de cobro y las mensuales sí", async () => {
    await insertSubscription(owner, { startsOn: "2026-02-15", interval: "yearly" });
    await expect(
      asUser(
        owner,
        `insert into public.expense_subscriptions (org_id, issuer_id, category_id, description, base_cents, billing_interval, starts_on)
         values ($1, $2, $3, 'Sin día', 1000, 'monthly', '2026-01-01')`,
        [orgId, issuerId, categories["Software y suscripciones"]],
      ),
    ).rejects.toThrow(/check constraint/);
  });
});

describe("caja", () => {
  it("la posición es el último saldo de cada cuenta y el total de la org suma solo las activas", async () => {
    const account = async (name: string, active = true) =>
      (
        await asUser<{ id: string }>(
          owner,
          "insert into public.cash_accounts (org_id, issuer_id, name, iban, is_active) values ($1, $2, $3, $4, $5) returning id",
          [orgId, issuerId, name, name === "Principal" ? "es91 2100 0418 4502 0005 1332" : null, active],
        )
      )[0]!.id;
    const main = await account("Principal");
    const savings = await account("Ahorro");
    const closed = await account("Antigua", false);
    const balance = (id: string, on: string, cents: number) =>
      asUser(owner, "insert into public.cash_balances (org_id, account_id, balance_on, balance_cents) values ($1, $2, $3, $4)", [
        orgId,
        id,
        on,
        cents,
      ]);
    await balance(main, "2026-08-31", 1_000_000);
    await balance(main, "2026-09-25", 1_250_000);
    await balance(savings, "2026-09-01", 500_000);
    await balance(closed, "2026-09-20", 999_999);
    await expect(balance(main, "2026-09-25", 1)).rejects.toThrow(/cash_balances_account_id_balance_on_key/);

    const { rows } = await db.query<{
      name: string;
      iban: string | null;
      balance_cents: number;
      org_total_cents: number;
      org_oldest_balance_on: Date;
      org_latest_balance_on: Date;
    }>(
      "select name, iban, balance_cents, org_total_cents, org_oldest_balance_on, org_latest_balance_on from public.cash_position where org_id = $1 order by name",
      [orgId],
    );
    expect(rows.map((r) => [r.name, r.balance_cents, r.org_total_cents])).toEqual([
      ["Ahorro", 500_000, 1_750_000],
      ["Antigua", 999_999, 1_750_000],
      ["Principal", 1_250_000, 1_750_000],
    ]);
    expect(rows.find((r) => r.name === "Principal")!.iban).toBe("ES9121000418450200051332");
    expect(rows[0]!.org_oldest_balance_on.toISOString().slice(0, 10)).toBe("2026-09-01");
    expect(rows[0]!.org_latest_balance_on.toISOString().slice(0, 10)).toBe("2026-09-25");
  });
});

describe("participaciones", () => {
  it("cada fecha suma el 100 %: un reparto incompleto no se confirma", async () => {
    const partner = await addMember("socio@example.com", "partner");
    const ownerMember = (await one<{ id: string }>("select id from public.members where user_id = $1", [owner])).id;
    const save = (user: string, validFrom: string, shares: [string, number][], previous: string | null = null) =>
      asUser(user, "select public.save_shareholdings($1, $2, $3::jsonb, $4)", [
        orgId,
        validFrom,
        JSON.stringify(shares.map(([member_id, percent_bps]) => ({ member_id, percent_bps }))),
        previous,
      ]);

    await save(owner, "2026-09-01", [
      [ownerMember, 5000],
      [partner.member, 5000],
    ]);
    await expectHint(
      save(owner, "2026-09-01", [
        [ownerMember, 6000],
        [partner.member, 3000],
      ]),
      "shareholdings_total",
    );
    // Lo anterior sigue intacto (la transacción entera se deshace).
    expect((await one<{ n: number }>("select sum(percent_bps)::int as n from public.shareholdings where org_id = $1", [orgId])).n).toBe(
      10_000,
    );
    // Un reparto nuevo desde otra fecha, y mover una fecha.
    await save(owner, "2027-01-01", [
      [ownerMember, 6000],
      [partner.member, 4000],
    ]);
    await save(owner, "2027-02-01", [[ownerMember, 10_000]], "2027-01-01");
    const { rows } = await db.query<{ valid_from: Date; total: number }>(
      "select valid_from, sum(percent_bps)::int as total from public.shareholdings where org_id = $1 group by valid_from order by valid_from",
      [orgId],
    );
    expect(rows.map((r) => [r.valid_from.toISOString().slice(0, 10), r.total])).toEqual([
      ["2026-09-01", 10_000],
      ["2027-02-01", 10_000],
    ]);

    // Una fila suelta que deja la fecha a medias tampoco se confirma, y un socio no las toca.
    await expectHint(
      asUser(owner, "insert into public.shareholdings (org_id, member_id, percent_bps, valid_from) values ($1, $2, 2500, '2027-03-01')", [
        orgId,
        ownerMember,
      ]),
      "shareholdings_total",
    );
    await expect(save(partner.user, "2027-03-01", [[partner.member, 10_000]])).rejects.toMatchObject({ code: "42501" });
    // Borrar un reparto entero deja la fecha vacía, que es válido.
    await save(owner, "2027-02-01", []);
    expect((await one<{ n: number }>("select count(*)::int as n from public.shareholdings where valid_from = '2027-02-01'")).n).toBe(0);
  });
});

describe("RLS de finanzas", () => {
  it("otra org no ve nada ni puede apuntar a lo nuestro; un viewer lee pero no escribe", async () => {
    await insertExpense(owner, { base: 1000 });
    const sub = await insertSubscription(owner, { startsOn: "2026-06-01" });
    await generate(owner, sub, ["2026-06-01"]);
    await asUser(owner, "insert into public.vendors (org_id, name, tax_id) values ($1, 'Adobe Systems Software Ireland', 'ie 6364992h')", [
      orgId,
    ]);
    const [account] = await asUser<{ id: string }>(
      owner,
      "insert into public.cash_accounts (org_id, issuer_id, name) values ($1, $2, 'Principal') returning id",
      [orgId, issuerId],
    );
    await asUser(owner, "insert into public.cash_balances (org_id, account_id, balance_on, balance_cents) values ($1, $2, '2026-09-01', 100)", [
      orgId,
      account!.id,
    ]);

    // Otra org.
    const intruder = await createUser(db, "otro@example.com");
    const otherOrg = await createOrg(db, intruder, onboardingPayload({ org: { name: "Otra", slug: "otra" }, invitations: [] }));
    const otherIssuer = (await one<{ id: string }>("select id from public.issuers where org_id = $1 and kind = 'company'", [otherOrg])).id;
    for (const table of ["expenses", "expense_subscriptions", "vendors", "cash_accounts", "cash_balances", "expense_categories"]) {
      const rows = await asUser(intruder, `select id from public.${table} where org_id = $1`, [orgId]);
      expect(rows, table).toEqual([]);
    }
    for (const view of ["expenses_overview", "cash_position", "expenses_by_month"]) {
      const rows = await asUser(intruder, `select * from public.${view} where org_id = $1`, [orgId]);
      expect(rows, view).toEqual([]);
    }
    // Su gasto no puede usar nuestra categoría (FK compuesta), aunque conozca el id.
    await expect(
      insertExpense(intruder, { base: 1000, category: categories["Seguros"] }, otherOrg, otherIssuer),
    ).rejects.toThrow(/foreign key/);
    // Ni escribir en nuestra org.
    await expect(insertExpense(intruder, { base: 1000 })).rejects.toThrow(/row-level security/);

    // Viewer.
    const viewer = await addMember("viewer@example.com", "viewer");
    expect(await asUser(viewer.user, "select id from public.expenses_overview where org_id = $1", [orgId])).toHaveLength(2);
    expect(await asUser(viewer.user, "select account_id from public.cash_position where org_id = $1", [orgId])).toHaveLength(1);
    await expect(insertExpense(viewer.user, { base: 1000 })).rejects.toThrow(/row-level security/);
    expect(await asUser(viewer.user, "update public.expenses set paid_on = current_date where org_id = $1 returning id", [orgId])).toEqual([]);
    expect(await asUser(viewer.user, "delete from public.cash_balances where org_id = $1 returning id", [orgId])).toEqual([]);
    await expect(
      asUser(viewer.user, "insert into public.vendors (org_id, name) values ($1, 'Nuevo')", [orgId]),
    ).rejects.toThrow(/row-level security/);
    await expectHint(asUser(viewer.user, "select public.delete_expense_subscription($1, true)", [sub]), "subscription_not_found");

    // Un socio lleva la operativa.
    const partner = await addMember("socio@example.com", "partner");
    await insertExpense(partner.user, { base: 2000 });
    const vendor = await one<{ tax_id: string }>("select tax_id from public.vendors where org_id = $1", [orgId]);
    expect(vendor.tax_id).toBe("IE6364992H");
  });
});
