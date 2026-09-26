import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { addDays } from "@/domain/dates/civil-date";
import { monthOf, monthRange, revenueByMonth, type BillingType, type RevenueRow } from "@/domain/metrics";
import { computeLine } from "@/domain/tax";
import { as, createDb, createOrg, createUser, type Db } from "./harness";

let db: Db;
let owner: string;
let orgId: string;
let today: string;
let ids: { freelancer: string; vat21: string; stages: Record<string, string> };

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0]!;
}

async function rows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

async function asOwner<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return as(db, owner, () => rows<T>(sql, params));
}

async function asService<T>(fn: () => Promise<T>): Promise<T> {
  await db.exec("set role service_role");
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}

/** Rechaza con el hint de Postgres que la app traduce a un mensaje. */
async function expectHint(promise: Promise<unknown>, hint: string) {
  await expect(promise).rejects.toMatchObject({ hint });
}

const day = (offset: number) => addDays(today, offset);

let clientCount = 0;

async function createClient(name: string): Promise<string> {
  clientCount += 1;
  const [client] = await asOwner<{ id: string }>(
    `insert into public.clients (org_id, display_name, legal_name, tax_id, address_line, postal_code, city)
     values ($1, $2, $2, $3, 'Carrer Major 1', '08301', 'Mataró') returning id`,
    [orgId, name, `B1234567${clientCount}`],
  );
  return client!.id;
}

async function createContract(clientId: string, signedOn: string, lines: Record<string, unknown>[]): Promise<string[]> {
  const contractId = await as(db, owner, async () =>
    (
      await one<{ id: string }>("select public.create_contract($1::jsonb) as id", [
        JSON.stringify({
          client_id: clientId,
          issuer_id: ids.freelancer,
          title: "Contrato",
          signed_on: signedOn,
          lines: lines.map((l) => ({ description: "Servicio", tax_rate_id: ids.vat21, unit_price_cents: 10_000, ...l })),
        }),
      ])
    ).id,
  );
  const result = await rows<{ id: string }>("select id from public.contract_lines where contract_id = $1 order by position", [contractId]);
  return result.map((r) => r.id);
}

function draftLine(unitPriceCents: number, billingType: BillingType) {
  const amounts = computeLine({ quantity: "1", unitPriceCents, discountBps: 0, vatBps: 2100, irpfBps: 0, irpfApplies: false });
  return {
    id: randomUUID(),
    description: "Servicio",
    quantity: "1",
    unit_price_cents: unitPriceCents,
    discount_bps: 0,
    base_cents: amounts.baseCents,
    tax_rate_id: ids.vat21,
    vat_bps: 2100,
    vat_regime: "general",
    vat_cents: amounts.vatCents,
    irpf_applies: false,
    irpf_cents: 0,
    billing_type: billingType,
  };
}

/** Emite una factura del autónomo (sin IRPF) con esas líneas y esa fecha; vence a 30 días. */
async function issueInvoice(clientId: string, issuedOn: string, lines: [number, BillingType][]): Promise<string> {
  const invoiceId = await as(db, owner, async () =>
    (
      await one<{ id: string }>("select public.save_invoice_draft($1::jsonb) as id", [
        JSON.stringify({
          header: { issuer_id: ids.freelancer, client_id: clientId, irpf_bps: 0, payment_terms_days: 30 },
          lines: lines.map(([cents, type]) => draftLine(cents, type)),
        }),
      ])
    ).id,
  );
  await completeIssue(invoiceId, issuedOn);
  return invoiceId;
}

async function completeIssue(invoiceId: string, issuedOn: string) {
  await as(db, owner, async () => {
    await db.query("select public.issue_invoice_begin($1, $2::date)", [invoiceId, issuedOn]);
    await db.query("select public.issue_invoice_complete($1, $2::jsonb)", [invoiceId, JSON.stringify({ pdf_path: `${orgId}/${invoiceId}.pdf` })]);
  });
}

async function pay(invoiceId: string, cents: number, paidOn: string) {
  await asOwner("insert into public.payments (org_id, invoice_id, amount_cents, paid_on) values ($1, $2, $3, $4)", [
    orgId,
    invoiceId,
    cents,
    paidOn,
  ]);
}

/** Anula una factura con una rectificativa total emitida en `issuedOn`. */
async function voidInvoice(invoiceId: string, issuedOn: string): Promise<string> {
  const [rect] = await asOwner<{ id: string }>("select public.create_rectification($1, 'Error') as id", [invoiceId]);
  await completeIssue(rect!.id, issuedOn);
  return rect!.id;
}

/** Deal con su historial fechado: `path` son las etapas y los días (relativos a hoy) en que entró en cada una. */
async function createDeal(clientId: string, path: [string, number][], extra: Record<string, unknown> = {}): Promise<string> {
  const [first, ...moves] = path;
  const at = (offset: number) => `${day(offset)}T10:00:00+02:00`;
  await db.query("select set_config('app.stage_changed_at', $1, false)", [at(first![1])]);
  const [deal] = await asOwner<{ id: string }>(
    `insert into public.deals (org_id, client_id, title, stage_id, est_one_off_cents, est_mrr_cents, probability_bps, created_at)
     values ($1, $2, 'Deal', $3, $4, $5, $6, $7) returning id`,
    [orgId, clientId, ids.stages[first![0]], extra.one_off ?? 100_000, extra.mrr ?? 20_000, extra.probability ?? null, at(first![1])],
  );
  for (const [stage, offset] of moves) {
    await db.query("select set_config('app.stage_changed_at', $1, false)", [at(offset)]);
    await asOwner("update public.deals set stage_id = $2 where id = $1", [deal!.id, ids.stages[stage]]);
  }
  await db.query("select set_config('app.stage_changed_at', '', false)");
  return deal!.id;
}

const snapshotRow = (overrides: Record<string, unknown> = {}) => ({
  org_id: orgId,
  month: "2026-08-01",
  mrr_cents: 70_000,
  arr_cents: 840_000,
  new_mrr_cents: 10_000,
  expansion_mrr_cents: 0,
  contraction_mrr_cents: 0,
  churn_mrr_cents: 25_000,
  active_clients: 2,
  revenue_recurring_cents: 180_000,
  revenue_usage_cents: 37_500,
  revenue_one_off_cents: 0,
  outstanding_cents: 102_850,
  overdue_cents: 30_250,
  weighted_pipeline_one_off_cents: 200_000,
  weighted_pipeline_mrr_cents: 25_000,
  definition_version: 1,
  is_estimated: false,
  ...overrides,
});

async function insertSnapshot(overrides: Record<string, unknown> = {}) {
  const row = snapshotRow(overrides);
  const columns = Object.keys(row);
  await db.query(
    `insert into public.metrics_snapshots (${columns.join(", ")}) values (${columns.map((_, i) => `$${i + 1}`).join(", ")})`,
    Object.values(row),
  );
}

beforeEach(async () => {
  db = await createDb();
  owner = await createUser(db, "owner@example.com");
  orgId = await createOrg(db, owner);
  // Dirección para poder emitir, y la fecha Verifactu lejos: los tests emiten con fechas relativas a hoy.
  await db.query(
    "update public.issuers set address_line = 'Carrer Major 1', postal_code = '08301', city = 'Mataró', verifactu_from = '2099-01-01' where org_id = $1",
    [orgId],
  );
  // Las rectificativas del autónomo van en su propia serie.
  const freelancer = (await one<{ id: string }>("select id from public.issuers where org_id = $1 and kind = 'self_employed'", [orgId])).id;
  await db.query(
    "insert into public.invoice_series (org_id, issuer_id, code, name, kind, format, is_default) values ($1, $2, 'R', 'Rectificativas', 'rectifying', 'R{yyyy}-{n:4}', true)",
    [orgId, freelancer],
  );
  const stages = await rows<{ id: string; name: string }>("select id, name from public.pipeline_stages where org_id = $1", [orgId]);
  ids = {
    freelancer,
    vat21: (await one<{ id: string }>("select id from public.tax_rates where org_id = $1 and name = 'IVA 21 %'", [orgId])).id,
    stages: Object.fromEntries(stages.map((s) => [s.name, s.id])),
  };
  today = (await one<{ d: string }>("select private.org_today($1)::text as d", [orgId])).d;
});

describe("fotos mensuales", () => {
  it("las escribe solo el servidor, las leen los miembros y otra org no ve nada", async () => {
    await asService(() => insertSnapshot());
    expect(await asOwner("select month::text, mrr_cents, is_estimated from public.metrics_snapshots")).toEqual([
      { month: "2026-08-01", mrr_cents: 70_000, is_estimated: false },
    ]);
    await expect(as(db, owner, () => insertSnapshot({ month: "2026-07-01" }))).rejects.toThrow(/permission denied/);
    await expect(asOwner("update public.metrics_snapshots set mrr_cents = 1")).rejects.toThrow(/permission denied/);
    await expect(asOwner("delete from public.metrics_snapshots")).rejects.toThrow(/permission denied/);

    const outsider = await createUser(db, "fuera@example.com");
    await as(db, outsider, async () => {
      expect(await rows("select * from public.metrics_snapshots")).toHaveLength(0);
    });
  });

  it("son inmutables, también para service_role y para el dueño de las tablas", async () => {
    await asService(() => insertSnapshot());
    for (const role of ["service_role", null]) {
      if (role) await db.exec(`set role ${role}`);
      try {
        await expectHint(db.query("update public.metrics_snapshots set mrr_cents = 0, arr_cents = 0"), "snapshot_immutable");
        await expectHint(db.query("delete from public.metrics_snapshots"), "snapshot_immutable");
        await expectHint(db.query("truncate public.metrics_snapshots"), "snapshot_immutable");
      } finally {
        await db.exec("reset role");
      }
    }
    expect((await rows("select 1 from public.metrics_snapshots")).length).toBe(1);
  });

  it("una por org y mes, del primer día del mes y con ARR = MRR × 12", async () => {
    await insertSnapshot();
    await expect(insertSnapshot()).rejects.toMatchObject({ code: "23505" });
    await expect(insertSnapshot({ month: "2026-07-15" })).rejects.toMatchObject({ code: "23514" });
    await expect(insertSnapshot({ month: "2026-06-01", arr_cents: 1 })).rejects.toMatchObject({ code: "23514" });
    // Los movimientos no pueden implicar un MRR anterior negativo.
    await expect(insertSnapshot({ month: "2026-05-01", mrr_cents: 1_000, arr_cents: 12_000, new_mrr_cents: 5_000, churn_mrr_cents: 0 })).rejects.toMatchObject({
      code: "23514",
    });
  });
});

describe("estado en una fecha de corte", () => {
  /** Escenario: clientes activo, pausado, ex-cliente y lead; facturas en cada estado; deals. */
  async function scenario() {
    const active = await createClient("Restaurant del Port");
    const paused = await createClient("Hotel Llevant");
    const former = await createClient("Maresme Fit");
    const lead = await createClient("Acadèmia Babel");

    await createContract(active, day(-60), [{ billing_type: "monthly", starts_on: day(-60), billing_day: 1 }]);
    const [pausedLine] = await createContract(paused, day(-90), [{ billing_type: "monthly", starts_on: day(-90), billing_day: 1 }]);
    await asOwner("insert into public.contract_line_pauses (org_id, line_id, starts_on, ends_on) values ($1, $2, $3, $4)", [
      orgId,
      pausedLine,
      day(-3),
      day(10),
    ]);
    await createContract(former, day(-120), [{ billing_type: "yearly", starts_on: day(-120), ends_on: day(-1) }]);

    // En orden de fecha: la serie no admite fechas que retrocedan.
    const overdue = await issueInvoice(active, day(-50), [[20_000, "monthly"]]); // vence a -20; cobro parcial a -10
    const voided = await issueInvoice(paused, day(-45), [[37_500, "usage"]]); // anulada a -5
    const paid = await issueInvoice(former, day(-40), [[24_000, "yearly"]]); // cobrada a -12
    const open = await issueInvoice(active, day(-10), [
      [20_000, "monthly"],
      [150_000, "one_off"],
    ]);
    await pay(overdue, 12_100, day(-10));
    await pay(paid, 29_040, day(-12));
    const rectifying = await voidInvoice(voided, day(-5));

    const openDeal = await createDeal(lead, [["Lead", -20], ["Reunión", -8]]);
    const override = await createDeal(lead, [["Propuesta enviada", -30]], { probability: 3300 });
    const won = await createDeal(active, [["Lead", -70], ["Negociación", -65], ["Ganado", -61]]);
    const archived = await createDeal(lead, [["Lead", -15]]);
    await asOwner("update public.deals set archived_at = now() where id = $1", [archived]);
    return { clients: { active, paused, former, lead }, invoices: { overdue, voided, paid, open, rectifying }, deals: { openDeal, override, won, archived } };
  }

  it("con la fecha de hoy, cada función dice lo mismo que su vista (paridad)", async () => {
    await scenario();
    await as(db, owner, async () => {
      const viewInvoices = await rows(
        `select id, status::text, outstanding_cents from public.invoices_overview
         where kind = 'ordinary' and status in ('issued', 'overdue') order by id`,
      );
      const fnInvoices = await rows(
        "select invoice_id as id, status::text, outstanding_cents from public.open_invoices_on($1, $2) order by invoice_id",
        [orgId, today],
      );
      expect(fnInvoices).toEqual(viewInvoices);
      expect(fnInvoices).toHaveLength(2);

      const viewClients = await rows("select id, status::text from public.clients_overview where status <> 'lead' order by id");
      const fnClients = await rows("select client_id as id, status::text from public.client_statuses_on($1, $2) order by client_id", [orgId, today]);
      expect(fnClients).toEqual(viewClients);
      expect(fnClients.map((c) => (c as { status: string }).status).sort()).toEqual(["active", "former", "paused"]);

      const viewDeals = await rows(
        `select id, stage_id, stage_kind::text, est_one_off_cents, est_mrr_cents, probability_bps
         from public.deals_board where stage_kind = 'open' order by id`,
      );
      const fnDeals = await rows(
        `select deal_id as id, stage_id, stage_kind::text, est_one_off_cents, est_mrr_cents, probability_bps
         from public.open_deals_on($1, $2) order by deal_id`,
        [orgId, today],
      );
      expect(fnDeals).toEqual(viewDeals);
      expect(fnDeals).toHaveLength(2);
    });
  });

  it("en una fecha pasada, lo que las vistas habrían dicho ese día", async () => {
    const { clients, invoices, deals } = await scenario();
    const invoicesOn = (on: string) =>
      asOwner<{ id: string; status: string; outstanding_cents: number }>(
        "select invoice_id as id, status::text, outstanding_cents from public.open_invoices_on($1, $2)",
        [orgId, on],
      );
    const byId = async (on: string) => Object.fromEntries((await invoicesOn(on)).map((r) => [r.id, [r.status, r.outstanding_cents]]));

    // Antes de vencer y antes del cobro parcial: emitida y entera.
    expect((await byId(day(-25)))[invoices.overdue]).toEqual(["issued", 24_200]);
    // Vencida, todavía sin cobrar nada; la que luego se anula sigue viva hasta su rectificativa.
    const before = await byId(day(-15));
    expect(before[invoices.overdue]).toEqual(["overdue", 24_200]);
    expect(before[invoices.voided]).toEqual(["issued", 45_375]);
    expect(before[invoices.paid]).toEqual(["issued", 29_040]);
    // Hoy: el cobro parcial y la anulación ya cuentan; la cobrada ya no está.
    const now = await byId(today);
    expect(now[invoices.overdue]).toEqual(["overdue", 12_100]);
    expect(now[invoices.voided]).toBeUndefined();
    expect(now[invoices.paid]).toBeUndefined();
    expect(now[invoices.rectifying]).toBeUndefined();
    // Nada existe antes de emitirse.
    expect(await invoicesOn(day(-51))).toEqual([]);

    const statusesOn = async (on: string) =>
      Object.fromEntries(
        (await asOwner<{ id: string; status: string }>("select client_id as id, status::text from public.client_statuses_on($1, $2)", [orgId, on])).map(
          (r) => [r.id, r.status],
        ),
      );
    // El contrato del activo aún no estaba firmado; el pausado y el ex-cliente estaban activos.
    expect(await statusesOn(day(-61))).toEqual({ [clients.paused]: "active", [clients.former]: "active" });
    expect(await statusesOn(day(-2))).toEqual({ [clients.active]: "active", [clients.paused]: "paused", [clients.former]: "active" });
    expect(await statusesOn(day(-4))).toMatchObject({ [clients.paused]: "active" });

    const dealsOn = async (on: string) =>
      Object.fromEntries(
        (
          await asOwner<{ id: string; stage_id: string; probability_bps: number }>(
            "select deal_id as id, stage_id, probability_bps from public.open_deals_on($1, $2)",
            [orgId, on],
          )
        ).map((r) => [r.id, [r.stage_id, r.probability_bps]]),
      );
    // Hace 62 días el ganado aún se negociaba (con la probabilidad de esa etapa); el archivado aún no existía.
    const earlier = await dealsOn(day(-62));
    expect(earlier[deals.won]).toEqual([ids.stages["Negociación"], 7500]);
    expect(earlier[deals.archived]).toBeUndefined();
    // Hace 10 días: el abierto seguía en Lead, el archivado existía y la probabilidad fijada manda.
    const recent = await dealsOn(day(-10));
    expect(recent[deals.openDeal]).toEqual([ids.stages["Lead"], 1000]);
    expect(recent[deals.override]).toEqual([ids.stages["Propuesta enviada"], 3300]);
    expect(recent[deals.archived]).toEqual([ids.stages["Lead"], 1000]);
    expect(recent[deals.won]).toBeUndefined();
  });
});

describe("ingresos por mes", () => {
  it("la vista agrega lo mismo que la definición de TS sobre las líneas sueltas (paridad)", async () => {
    const client = await createClient("Restaurant del Port");
    const other = await createClient("Hotel Llevant");
    const first = await issueInvoice(client, day(-75), [
      [15_000, "monthly"],
      [120_000, "yearly"],
    ]);
    await issueInvoice(other, day(-40), [
      [37_500, "usage"],
      [180_000, "one_off"],
    ]);
    await issueInvoice(client, day(-5), [[15_000, "monthly"]]);
    await voidInvoice(first, day(-2));

    const months = monthRange(monthOf(day(-75)), monthOf(today));
    await as(db, owner, async () => {
      const view = await rows<{ month: string; billing_type: BillingType; base_cents: number }>(
        "select month::text, billing_type::text, base_cents from public.revenue_by_month",
      );
      const raw = await rows<{ issued_on: string; billing_type: BillingType; base_cents: number }>(
        `select i.issued_on::text, l.billing_type::text, l.base_cents
         from public.invoice_lines l join public.invoices i on i.id = l.invoice_id where i.lifecycle = 'issued'`,
      );
      const fromView = revenueByMonth(
        view.map((r): RevenueRow => ({ month: r.month, billingType: r.billing_type, baseCents: r.base_cents })),
        months,
      );
      const fromLines = revenueByMonth(
        raw.map((r): RevenueRow => ({ month: r.issued_on, billingType: r.billing_type, baseCents: r.base_cents })),
        months,
      );
      expect(fromView).toEqual(fromLines);
      // La rectificativa resta en su mes: el mes de hoy recoge la mensual nueva menos la anulada.
      const current = fromView.at(-1)!;
      if (monthOf(day(-5)) === monthOf(today) && monthOf(day(-2)) === monthOf(today)) {
        expect(current.recurringCents).toBe(15_000 - 135_000);
      }
      expect(fromView.reduce((sum, m) => sum + m.oneOffCents, 0)).toBe(180_000);

      // Por cliente: suma la facturación neta, igual que clients_overview.
      const byClient = await rows<{ client_id: string; base: number }>(
        "select client_id, sum(base_cents)::bigint as base from public.revenue_by_client_month group by client_id order by client_id",
      );
      const overview = await rows<{ client_id: string; base: number }>(
        "select id as client_id, billed_net_cents as base from public.clients_overview where billed_net_cents <> 0 order by id",
      );
      expect(byClient).toEqual(overview);
    });
  });
});

describe("RLS de las métricas", () => {
  it("otra org no ve nada, un viewer lee y anon no puede ejecutar nada", async () => {
    const client = await createClient("Restaurant del Port");
    await createContract(client, day(-30), [{ billing_type: "monthly", starts_on: day(-30), billing_day: 1 }]);
    await issueInvoice(client, day(-20), [[20_000, "monthly"]]);

    const viewer = await createUser(db, "viewer@example.com");
    await db.query("insert into public.members (org_id, user_id, role, full_name, initials) values ($1, $2, 'viewer', 'Visor', 'VI')", [
      orgId,
      viewer,
    ]);
    const outsider = await createUser(db, "fuera@example.com");
    const reads = [
      "select * from public.revenue_by_month",
      "select * from public.revenue_by_client_month",
      "select * from public.open_invoices_on($1, $2)",
      "select * from public.client_statuses_on($1, $2)",
    ];
    await as(db, viewer, async () => {
      for (const sql of reads) expect((await rows(sql, sql.includes("$1") ? [orgId, today] : [])).length, sql).toBeGreaterThan(0);
    });
    await as(db, outsider, async () => {
      for (const sql of [...reads, "select * from public.open_deals_on($1, $2)"]) {
        expect(await rows(sql, sql.includes("$1") ? [orgId, today] : []), sql).toHaveLength(0);
      }
    });
    await as(db, null, async () => {
      for (const fn of ["open_invoices_on", "client_statuses_on", "open_deals_on"]) {
        await expect(rows(`select * from public.${fn}($1, $2)`, [orgId, today]), fn).rejects.toThrow(/permission denied/);
      }
      await expect(rows("select * from public.revenue_by_month")).rejects.toThrow(/permission denied/);
    });
    // El servidor (service_role) lo ve todo, filtrado por la org que pide.
    await asService(async () => {
      expect(await rows("select * from public.client_statuses_on($1, $2)", [orgId, today])).toHaveLength(1);
    });
  });
});
