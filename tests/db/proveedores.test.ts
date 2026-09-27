import { beforeEach, describe, expect, it } from "vitest";
import { addDays } from "@/domain/dates/civil-date";
import { summarizeAllocations } from "@/domain/vendors";
import { nowInZone } from "@/lib/clock";
import { as, createDb, createOrg, createUser, type Db, onboardingPayload } from "./harness";

// Proveedores y freelancers (supabase/migrations/20260927150000_proveedores.sql): los datos nuevos
// de `vendors`, sus checks y su normalización, y las dos vistas de lo que cuesta cada proveedor.

let db: Db;
let owner: string;
let partner: string;
let viewer: string;
let intruder: string;
let orgId: string;
let otherOrgId: string;
let issuerId: string;
let categoryId: string;
let clientA: string;
let clientB: string;

const TZ = "Europe/Madrid";
const today = () => nowInZone(TZ).date;
const lastYear = () => Number(today().slice(0, 4)) - 1;

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0]!;
}

async function all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

async function addMember(userId: string, role: "viewer" | "partner", initials: string): Promise<void> {
  await db.query("insert into public.members (org_id, user_id, role, full_name, initials) values ($1, $2, $3, 'Socio', $4)", [
    orgId,
    userId,
    role,
    initials,
  ]);
}

/** Inserta un proveedor como `user` (un socio por defecto) y devuelve su id. */
async function createVendor(values: Record<string, unknown> = {}, user = partner): Promise<string> {
  const row = { org_id: orgId, name: "Clara Font Studio", ...values };
  const columns = Object.keys(row);
  return as(db, user, async () =>
    (
      await one<{ id: string }>(
        `insert into public.vendors (${columns.join(", ")}) values (${columns.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
        Object.values(row),
      )
    ).id,
  );
}

type ExpenseInput = {
  vendorId: string | null;
  issuedOn: string;
  base: number;
  vatBps?: number;
  vat?: number;
  deductible?: boolean;
  irpfBps?: number;
  irpf?: number;
  dueOn?: string | null;
  paidOn?: string | null;
  allocation?: "company" | "client" | "hosted_sites";
  clientId?: string | null;
};

async function insertExpense(input: ExpenseInput): Promise<string> {
  const vat = input.vat ?? 0;
  const irpf = input.irpf ?? 0;
  return as(db, partner, async () =>
    (
      await one<{ id: string }>(
        `insert into public.expenses (org_id, issuer_id, vendor_id, category_id, description, issued_on, due_on, base_cents, vat_bps, vat_cents,
                                      vat_deductible, irpf_bps, irpf_cents, total_cents, paid_on, allocation, client_id)
         values ($1, $2, $3, $4, 'Trabajo', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) returning id`,
        [
          orgId,
          issuerId,
          input.vendorId,
          categoryId,
          input.issuedOn,
          input.dueOn ?? null,
          input.base,
          input.vatBps ?? 0,
          vat,
          input.deductible ?? true,
          input.irpfBps ?? 0,
          irpf,
          input.base + vat - irpf,
          input.paidOn ?? null,
          input.allocation ?? "company",
          input.clientId ?? null,
        ],
      )
    ).id,
  );
}

beforeEach(async () => {
  db = await createDb();
  owner = await createUser(db, "owner@example.com");
  partner = await createUser(db, "partner@example.com");
  viewer = await createUser(db, "viewer@example.com");
  intruder = await createUser(db, "intruder@example.com");
  orgId = await createOrg(db, owner);
  otherOrgId = await createOrg(db, intruder, onboardingPayload({ org: { name: "Otra", slug: "otra" }, invitations: [] }));
  await addMember(partner, "partner", "PA");
  await addMember(viewer, "viewer", "VI");
  issuerId = (await one<{ id: string }>("select id from public.issuers where org_id = $1 and kind = 'company'", [orgId])).id;
  categoryId = (await one<{ id: string }>("select id from public.expense_categories where org_id = $1 and name = 'Freelances y colaboradores'", [orgId])).id;
  const client = async (name: string) =>
    as(db, owner, async () => (await one<{ id: string }>("insert into public.clients (org_id, display_name) values ($1, $2) returning id", [orgId, name])).id);
  clientA = await client("Hotel Llevant");
  clientB = await client("Clínica Mar Blau");
});

describe("proveedores: datos de contacto y de pago", () => {
  it("un freelance con sus datos, normalizados; sin tipo, es una empresa", async () => {
    const id = await createVendor({
      kind: "freelancer",
      tax_id: " 39080359-r ",
      country_code: "es",
      contact_name: "  Clara Font ",
      email: "  Hola@ClaraFont.CAT ",
      phone: " +34 600 11 22 33 ",
      iban: "es91 2100 0418 4502 0005 1332",
      website: " clarafont.cat/portfolio ",
      notes: "   ",
    });
    expect(
      await one("select kind, tax_id, country_code, contact_name, email, phone, iban, website, notes from public.vendors where id = $1", [id]),
    ).toEqual({
      kind: "freelancer",
      tax_id: "39080359R",
      country_code: "ES",
      contact_name: "Clara Font",
      email: "hola@clarafont.cat",
      phone: "+34 600 11 22 33",
      iban: "ES9121000418450200051332",
      website: "clarafont.cat/portfolio",
      notes: null,
    });

    const company = await createVendor({ name: "Raiola Networks SL", email: "", website: "", iban: "   " });
    expect(await one("select kind, email, website, iban, contact_name from public.vendors where id = $1", [company])).toEqual({
      kind: "company",
      email: null,
      website: null,
      iban: null,
      contact_name: null,
    });
  });

  it("los checks rechazan lo que no es un email, un teléfono, un IBAN o una web, y lo demasiado largo", async () => {
    await expect(createVendor({ email: "clara@" })).rejects.toThrow(/vendors_email_check/);
    await expect(createVendor({ email: "clara font@estudi.cat" })).rejects.toThrow(/vendors_email_check/);
    await expect(createVendor({ phone: "llámame" })).rejects.toThrow(/vendors_phone_check/);
    await expect(createVendor({ phone: "12345" })).rejects.toThrow(/vendors_phone_check/);
    await expect(createVendor({ iban: "ES12" })).rejects.toThrow(/vendors_iban_check/);
    await expect(createVendor({ website: "no es una web" })).rejects.toThrow(/vendors_website_check/);
    await expect(createVendor({ website: "localhost" })).rejects.toThrow(/vendors_website_check/);
    await expect(createVendor({ contact_name: "x".repeat(201) })).rejects.toThrow(/vendors_contact_name_check/);
    await expect(createVendor({ notes: "x".repeat(2001) })).rejects.toThrow(/vendors_notes_check/);
    await expect(createVendor({ kind: "person" })).rejects.toThrow(/invalid input value for enum/);
    // Lo que sí cabe.
    await createVendor({ phone: "(93) 790-12.34", website: "https://www.clarafont.cat/es?ref=gnerai", notes: "x".repeat(2000) });
  });

  it("al editar también se normaliza y se comprueba", async () => {
    const id = await createVendor();
    await as(db, partner, () => db.query("update public.vendors set email = ' Clara@Estudi.cat', kind = 'freelancer' where id = $1", [id]));
    expect(await one("select email, kind from public.vendors where id = $1", [id])).toEqual({ email: "clara@estudi.cat", kind: "freelancer" });
    await expect(as(db, partner, () => db.query("update public.vendors set iban = 'no' where id = $1", [id]))).rejects.toThrow(/vendors_iban_check/);
  });
});

describe("proveedores: permisos", () => {
  it("los ve cualquier miembro (también sus cifras); otra org no ve nada; sin sesión, nada", async () => {
    const vendorId = await createVendor({ kind: "freelancer" });
    await insertExpense({ vendorId, issuedOn: today(), base: 50_000, allocation: "client", clientId: clientA });

    expect(await as(db, viewer, () => all("select name, kind from public.vendors"))).toEqual([{ name: "Clara Font Studio", kind: "freelancer" }]);
    expect(await as(db, viewer, () => all("select name, expenses_count, cost_cents from public.vendors_overview"))).toEqual([
      { name: "Clara Font Studio", expenses_count: 1, cost_cents: 50_000 },
    ]);
    expect(await as(db, viewer, () => all("select vendor_name, client_name, cost_cents from public.vendor_costs_by_allocation"))).toEqual([
      { vendor_name: "Clara Font Studio", client_name: "Hotel Llevant", cost_cents: 50_000 },
    ]);

    expect(await as(db, intruder, () => all("select id from public.vendors"))).toEqual([]);
    expect(await as(db, intruder, () => all("select id from public.vendors_overview"))).toEqual([]);
    expect(await as(db, intruder, () => all("select vendor_id from public.vendor_costs_by_allocation"))).toEqual([]);
    // Ni aunque lo pida por su org.
    expect(await as(db, intruder, () => all("select id from public.vendors_overview where org_id = $1", [orgId]))).toEqual([]);

    await expect(as(db, null, () => db.query("select id from public.vendors_overview"))).rejects.toThrow(/permission denied/);
    await expect(as(db, null, () => db.query("select vendor_id from public.vendor_costs_by_allocation"))).rejects.toThrow(/permission denied/);
  });

  it("los lleva un socio: un viewer no crea ni cambia nada; nadie los borra (se archivan)", async () => {
    const id = await createVendor();
    await expect(createVendor({ name: "Otro" }, viewer)).rejects.toThrow(/row-level security/);
    await as(db, viewer, () => db.query("update public.vendors set kind = 'freelancer', notes = 'cambiado' where id = $1", [id]));
    expect(await one("select kind, notes from public.vendors where id = $1", [id])).toEqual({ kind: "company", notes: null });

    await as(db, partner, () => db.query("update public.vendors set contact_name = 'Clara', archived_at = now() where id = $1", [id]));
    expect(await one("select contact_name, archived_at is not null as archived from public.vendors where id = $1", [id])).toEqual({
      contact_name: "Clara",
      archived: true,
    });
    await as(db, owner, () => db.query("delete from public.vendors where id = $1", [id]));
    expect(await one("select count(*)::int as n from public.vendors where id = $1", [id])).toEqual({ n: 1 });

    // Un proveedor de otra org no se toca.
    const foreign = await as(db, intruder, async () =>
      (await one<{ id: string }>("insert into public.vendors (org_id, name) values ($1, 'Ajeno') returning id", [otherOrgId])).id,
    );
    await as(db, partner, () => db.query("update public.vendors set name = 'Mío' where id = $1", [foreign]));
    expect(await one("select name from public.vendors where id = $1", [foreign])).toEqual({ name: "Ajeno" });
  });
});

describe("lo que cuesta cada proveedor", () => {
  let vendorId: string;
  let otherVendorId: string;
  let idleVendorId: string;

  beforeEach(async () => {
    vendorId = await createVendor({ kind: "freelancer" });
    otherVendorId = await createVendor({ name: "Oriol Pons Dev", kind: "freelancer" });
    idleVendorId = await createVendor({ name: "Sin gastos SL" });
    const prev = lastYear();
    // Del año pasado, de la empresa y pagado.
    await insertExpense({ vendorId, issuedOn: `${prev}-12-31`, base: 10_000, paidOn: `${prev}-12-31` });
    // De este año, del cliente A: uno pendiente (vence dentro de un mes) y uno con IVA no deducible, pagado.
    await insertExpense({ vendorId, issuedOn: today(), dueOn: addDays(today(), 30), base: 20_000, vatBps: 2100, vat: 4_200, allocation: "client", clientId: clientA });
    await insertExpense({ vendorId, issuedOn: today(), base: 5_000, vatBps: 2100, vat: 1_050, deductible: false, paidOn: today(), allocation: "client", clientId: clientA });
    // Del año pasado, del cliente B, con retención y vencido sin pagar.
    await insertExpense({
      vendorId,
      issuedOn: `${prev}-12-20`,
      dueOn: `${prev}-12-30`,
      base: 30_000,
      vatBps: 2100,
      vat: 6_300,
      irpfBps: 1500,
      irpf: 4_500,
      allocation: "client",
      clientId: clientB,
    });
    // De este año: el reparto entre las webs alojadas y un abono de la empresa.
    await insertExpense({ vendorId, issuedOn: today(), base: 1_000, paidOn: today(), allocation: "hosted_sites" });
    await insertExpense({ vendorId, issuedOn: today(), base: -2_000, paidOn: today() });
    // Otro proveedor también trabaja para el cliente A; y un gasto sin proveedor no cuenta para nadie.
    await insertExpense({ vendorId: otherVendorId, issuedOn: today(), base: 12_000, paidOn: today(), allocation: "client", clientId: clientA });
    await insertExpense({ vendorId: null, issuedOn: today(), base: 99_000, allocation: "client", clientId: clientA });
  });

  it("vendors_overview: gastos, coste (con el IVA no deducible), el año en curso, lo pendiente, lo vencido, fechas y clientes", async () => {
    const prev = lastYear();
    const row = await as(db, viewer, () => one<Record<string, unknown>>("select * from public.vendors_overview where id = $1", [vendorId]));
    expect(row).toMatchObject({
      name: "Clara Font Studio",
      kind: "freelancer",
      expenses_count: 6,
      base_cents: 64_000,
      cost_cents: 65_050,
      year_expenses_count: 4,
      year_cost_cents: 25_050,
      pending_cents: 56_000,
      pending_count: 2,
      overdue_cents: 31_800,
      overdue_count: 1,
      clients_count: 2,
    });
    expect(
      await as(db, viewer, () =>
        one(
          "select to_char(first_expense_on, 'YYYY-MM-DD') as first, to_char(last_expense_on, 'YYYY-MM-DD') as last from public.vendors_overview where id = $1",
          [vendorId],
        ),
      ),
    ).toEqual({ first: `${prev}-12-20`, last: today() });

    expect(await one("select expenses_count, cost_cents, year_cost_cents, pending_cents, clients_count from public.vendors_overview where id = $1", [otherVendorId])).toEqual({
      expenses_count: 1,
      cost_cents: 12_000,
      year_cost_cents: 12_000,
      pending_cents: 0,
      clients_count: 1,
    });
    // Sin gastos: ceros y sin fechas.
    expect(
      await one(
        "select expenses_count, cost_cents, year_cost_cents, pending_cents, overdue_cents, clients_count, first_expense_on, last_expense_on from public.vendors_overview where id = $1",
        [idleVendorId],
      ),
    ).toEqual({
      expenses_count: 0,
      cost_cents: 0,
      year_cost_cents: 0,
      pending_cents: 0,
      overdue_cents: 0,
      clients_count: 0,
      first_expense_on: null,
      last_expense_on: null,
    });
  });

  it("lo vencido se mira con el «hoy» de la zona de la org", async () => {
    // A la misma hora, en Kiritimati (UTC+14) ya es mañana (o pasado) de lo que es en Pago Pago (UTC−11).
    await db.query("update public.orgs set timezone = 'Pacific/Pago_Pago' where id = $1", [orgId]);
    const behind = nowInZone("Pacific/Pago_Pago").date;
    const id = await insertExpense({ vendorId: idleVendorId, issuedOn: behind, dueOn: behind, base: 7_000 });
    const overdue = () => one<{ overdue_count: number }>("select overdue_count from public.vendors_overview where id = $1", [idleVendorId]);
    expect(await overdue()).toEqual({ overdue_count: 0 });
    await db.query("update public.orgs set timezone = 'Pacific/Kiritimati' where id = $1", [orgId]);
    expect(await overdue()).toEqual({ overdue_count: 1 });
    // Pagarlo lo saca de lo pendiente y de lo vencido.
    await as(db, partner, () => db.query("update public.expenses set paid_on = $2 where id = $1", [id, behind]));
    expect(await one("select pending_cents, overdue_cents from public.vendors_overview where id = $1", [idleVendorId])).toEqual({
      pending_cents: 0,
      overdue_cents: 0,
    });
  });

  it("vendor_costs_by_allocation: una fila por destino, con el nombre del cliente, que suma lo del proveedor", async () => {
    type Bucket = {
      allocation: "company" | "client" | "hosted_sites";
      client_id: string | null;
      client_name: string | null;
      expenses_count: number;
      cost_cents: number;
      year_expenses_count: number;
      year_cost_cents: number;
      pending_cents: number;
      last_expense_on: Date | string | null;
    };
    const rows = await as(db, viewer, () =>
      all<Bucket>(
        `select allocation, client_id, client_name, expenses_count, cost_cents, year_expenses_count, year_cost_cents, pending_cents, last_expense_on
         from public.vendor_costs_by_allocation where vendor_id = $1 order by allocation, client_name`,
        [vendorId],
      ),
    );
    const withoutDates = rows.map((r) => Object.fromEntries(Object.entries(r).filter(([key]) => key !== "last_expense_on")));
    expect(withoutDates).toEqual([
      { allocation: "company", client_id: null, client_name: null, expenses_count: 2, cost_cents: 8_000, year_expenses_count: 1, year_cost_cents: -2_000, pending_cents: 0 },
      { allocation: "client", client_id: clientB, client_name: "Clínica Mar Blau", expenses_count: 1, cost_cents: 30_000, year_expenses_count: 0, year_cost_cents: 0, pending_cents: 31_800 },
      { allocation: "client", client_id: clientA, client_name: "Hotel Llevant", expenses_count: 2, cost_cents: 26_050, year_expenses_count: 2, year_cost_cents: 26_050, pending_cents: 24_200 },
      { allocation: "hosted_sites", client_id: null, client_name: null, expenses_count: 1, cost_cents: 1_000, year_expenses_count: 1, year_cost_cents: 1_000, pending_cents: 0 },
    ]);

    // El dominio agrupa esas filas y llega a las mismas cifras que vendors_overview (paridad SQL/TS).
    const overview = await one<{ cost_cents: number; year_cost_cents: number; pending_cents: number; clients_count: number; expenses_count: number }>(
      "select cost_cents, year_cost_cents, pending_cents, clients_count, expenses_count from public.vendors_overview where id = $1",
      [vendorId],
    );
    const input = rows.map((r) => ({
      allocation: r.allocation,
      clientId: r.client_id,
      clientName: r.client_name,
      expensesCount: r.expenses_count,
      costCents: Number(r.cost_cents),
      yearExpensesCount: r.year_expenses_count,
      yearCostCents: Number(r.year_cost_cents),
      pendingCents: Number(r.pending_cents),
      lastExpenseOn: null,
    }));
    const total = summarizeAllocations(input, "total");
    expect(total).toMatchObject({
      count: overview.expenses_count,
      amountCents: Number(overview.cost_cents),
      pendingCents: Number(overview.pending_cents),
      clientsCount: overview.clients_count,
    });
    expect(summarizeAllocations(input, "year").amountCents).toBe(Number(overview.year_cost_cents));
  });

  it("filtrada por cliente: quién ha trabajado para él (la tarjeta de la ficha del cliente)", async () => {
    const rows = await as(db, viewer, () =>
      all("select vendor_name, vendor_kind, expenses_count, cost_cents, year_cost_cents from public.vendor_costs_by_allocation where client_id = $1 order by vendor_name", [
        clientA,
      ]),
    );
    expect(rows).toEqual([
      { vendor_name: "Clara Font Studio", vendor_kind: "freelancer", expenses_count: 2, cost_cents: 26_050, year_cost_cents: 26_050 },
      { vendor_name: "Oriol Pons Dev", vendor_kind: "freelancer", expenses_count: 1, cost_cents: 12_000, year_cost_cents: 12_000 },
    ]);
    // Archivar al proveedor no borra lo que costó: la vista lo dice.
    await as(db, partner, () => db.query("update public.vendors set archived_at = now() where id = $1", [otherVendorId]));
    expect(
      await one("select vendor_archived_at is not null as archived from public.vendor_costs_by_allocation where vendor_id = $1", [otherVendorId]),
    ).toEqual({ archived: true });
  });
});
