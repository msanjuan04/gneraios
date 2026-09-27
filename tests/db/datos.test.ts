import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { parseCsv } from "@/domain/dataio/csv";
import { autoMapColumns } from "@/domain/dataio/fields";
import { type InvoiceImportContext, planInvoiceImport, toImportPayload } from "@/domain/dataio/invoices-import";
import { computeLine } from "@/domain/tax";
import { as, createDb, createOrg, createUser, type Db, onboardingPayload } from "./harness";

let db: Db;
let owner: string;
let orgId: string;
let ids: { freelancer: string; company: string; seriesF: string; companySeries: string; vat21: string };
let clientId: string;

const year = new Date().getUTCFullYear();
const py = year - 1;

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0]!;
}

async function asOwner<T>(sql: string, params: unknown[] = []): Promise<T> {
  return as(db, owner, () => one<T>(sql, params));
}

async function expectHint(promise: Promise<unknown>, hint: string) {
  await expect(promise).rejects.toMatchObject({ hint });
}

function daysFromToday(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Línea histórica con los importes del dominio (como hace el importador). */
function line(description: string, unitPriceCents: number, billingType: "one_off" | "monthly" | "yearly" | "usage", irpfBps = 1500) {
  const amounts = computeLine({ quantity: "1", unitPriceCents, discountBps: 0, vatBps: 2100, irpfBps, irpfApplies: irpfBps > 0 });
  return {
    position: 0,
    description,
    quantity: "1",
    unit_price_cents: unitPriceCents,
    discount_bps: 0,
    base_cents: amounts.baseCents,
    tax_rate_id: ids.vat21,
    vat_bps: 2100,
    vat_regime: "general",
    vat_cents: amounts.vatCents,
    irpf_applies: irpfBps > 0,
    irpf_cents: amounts.irpfCents,
    legal_note: null,
    billing_type: billingType,
    period_start: null,
    period_end: null,
  };
}

/** Payload válido de una factura histórica del autónomo (serie F, `{yyyy}-{n:4}`). */
function historical(numberYear: number, sequence: number, issuedOn: string, over: Record<string, unknown> = {}) {
  const lines = (over.lines as ReturnType<typeof line>[] | undefined) ?? [line("Mantenimiento web", 15_000, "monthly"), line("Campaña Meta Ads", 75_000, "usage")];
  const subtotal = lines.reduce((s, l) => s + l.base_cents, 0);
  const vat = lines.reduce((s, l) => s + l.vat_cents, 0);
  const irpf = lines.reduce((s, l) => s + l.irpf_cents, 0);
  const number = `${numberYear}-${String(sequence).padStart(4, "0")}`;
  return {
    external_id: `invoice:${ids.freelancer}:${number}`,
    issuer_id: ids.freelancer,
    series_id: ids.seriesF,
    client_id: clientId,
    number,
    sequence,
    number_year: numberYear,
    kind: "ordinary",
    issued_on: issuedOn,
    irpf_bps: 1500,
    totals: { subtotal_cents: subtotal, vat_cents: vat, irpf_cents: irpf, total_cents: subtotal + vat - irpf },
    lines: lines.map((l, position) => ({ ...l, position })),
    ...over,
  };
}

async function importInvoice(payload: unknown, user = owner): Promise<string> {
  return as(db, user, async () =>
    (await one<{ id: string }>("select public.import_historical_invoice($1::jsonb) as id", [JSON.stringify(payload)])).id,
  );
}

async function counter(seriesId: string, y: number): Promise<number | null> {
  const { rows } = await db.query<{ last_number: number }>(
    "select last_number from private.invoice_series_counters where series_id = $1 and year = $2",
    [seriesId, y],
  );
  return rows[0]?.last_number ?? null;
}

/** Emite desde GNERAI OS (borrador + emisión en dos pasos), como en facturación. */
async function issueFromApp(issuedOn: string | null = null): Promise<string> {
  return as(db, owner, async () => {
    const amounts = computeLine({ quantity: "1", unitPriceCents: 10_000, discountBps: 0, vatBps: 2100, irpfBps: 1500, irpfApplies: true });
    const draft = (
      await one<{ id: string }>("select public.save_invoice_draft($1::jsonb) as id", [
        JSON.stringify({
          header: { issuer_id: ids.freelancer, client_id: clientId, irpf_bps: 1500 },
          lines: [
            {
              id: randomUUID(),
              description: "Web",
              quantity: "1",
              unit_price_cents: 10_000,
              discount_bps: 0,
              base_cents: amounts.baseCents,
              tax_rate_id: ids.vat21,
              vat_bps: 2100,
              vat_regime: "general",
              vat_cents: amounts.vatCents,
              irpf_applies: true,
              irpf_cents: amounts.irpfCents,
              billing_type: "one_off",
            },
          ],
        }),
      ])
    ).id;
    const begun = await one<{ r: { number: string } }>("select public.issue_invoice_begin($1, $2::date) as r", [draft, issuedOn]);
    await db.query("select public.issue_invoice_complete($1, $2::jsonb)", [draft, JSON.stringify({ pdf_path: `${orgId}/${draft}.pdf` })]);
    return begun.r.number;
  });
}

beforeEach(async () => {
  db = await createDb();
  owner = await createUser(db, "owner@example.com");
  orgId = await createOrg(db, owner);
  await db.query(
    "update public.issuers set address_line = 'Carrer Major 1', postal_code = '08301', city = 'Mataró' where org_id = $1",
    [orgId],
  );
  const issuers = await db.query<{ id: string; kind: string }>("select id, kind from public.issuers where org_id = $1", [orgId]);
  const freelancer = issuers.rows.find((r) => r.kind === "self_employed")!.id;
  const company = issuers.rows.find((r) => r.kind === "company")!.id;
  ids = {
    freelancer,
    company,
    seriesF: (await one<{ id: string }>("select id from public.invoice_series where issuer_id = $1 and code = 'F'", [freelancer])).id,
    companySeries: (await one<{ id: string }>("select id from public.invoice_series where issuer_id = $1 and code = 'F'", [company])).id,
    vat21: (await one<{ id: string }>("select id from public.tax_rates where org_id = $1 and name = 'IVA 21 %'", [orgId])).id,
  };
  clientId = (
    await asOwner<{ id: string }>(
      `insert into public.clients (org_id, display_name, legal_name, tax_id, address_line, postal_code, city)
       values ($1, 'Restaurant del Port', 'Port Mataró SL', 'B12345674', 'Passeig Marítim 3', '08301', 'Mataró') returning id`,
      [orgId],
    )
  ).id;
});

describe("import_historical_invoice", () => {
  it("da de alta la factura ya emitida: su número, sus líneas, los datos del cliente de entonces y su cobro", async () => {
    const id = await importInvoice(
      historical(py, 12, `${py}-03-10`, {
        due_on: `${py}-04-09`,
        client_party: { legal_name: "Port Mataró SL", tax_id: "B12345674", tax_id_kind: "es", address_line: "Antigua dirección 1", city: "Mataró", country_code: "ES" },
        payment: { paid_on: `${py}-04-02` },
      }),
    );
    const inv = await one<Record<string, unknown> & { client_snapshot: Record<string, unknown>; issuer_snapshot: Record<string, unknown> }>(
      "select * from public.invoices where id = $1",
      [id],
    );
    expect(inv).toMatchObject({
      lifecycle: "issued",
      source: "import",
      kind: "ordinary",
      number: `${py}-0012`,
      sequence: 12,
      fiscal_year: py,
      series_id: ids.seriesF,
      pdf_path: null,
      issued_at: null,
      irpf_bps: 1500,
      subtotal_cents: 90_000,
      vat_cents: 18_900,
      irpf_cents: 13_500,
      total_cents: 95_400,
    });
    expect(inv.client_snapshot).toMatchObject({ legal_name: "Port Mataró SL", address_line: "Antigua dirección 1", postal_code: "08301", tax_id: "B12345674" });
    expect(inv.issuer_snapshot).toMatchObject({ tax_id: "12345678Z", kind: "self_employed" });
    const lines = await db.query<{ billing_type: string; base_cents: number }>(
      "select billing_type, base_cents from public.invoice_lines where invoice_id = $1 order by position",
      [id],
    );
    expect(lines.rows).toEqual([
      { billing_type: "monthly", base_cents: 15_000 },
      { billing_type: "usage", base_cents: 75_000 },
    ]);
    const overview = await asOwner<{ status: string; outstanding_cents: number; last_paid_on: Date }>(
      "select status, outstanding_cents, last_paid_on from public.invoices_overview where id = $1",
      [id],
    );
    expect(overview).toMatchObject({ status: "paid", outstanding_cents: 0 });
    expect(await counter(ids.seriesF, py)).toBe(12);
  });

  it("es idempotente: reimportar devuelve la misma factura y no cambia nada", async () => {
    const payload = historical(py, 12, `${py}-03-10`, { payment: { paid_on: `${py}-04-02` } });
    const first = await importInvoice(payload);
    const again = await importInvoice({ ...payload, lines: [line("Otra cosa", 1, "one_off")], totals: { subtotal_cents: 1, vat_cents: 0, irpf_cents: 0, total_cents: 1 } });
    expect(again).toBe(first);
    const counts = await one<{ invoices: number; lines: number; payments: number }>(
      `select (select count(*)::int from public.invoices) as invoices,
              (select count(*)::int from public.invoice_lines) as lines,
              (select count(*)::int from public.payments) as payments`,
    );
    expect(counts).toEqual({ invoices: 1, lines: 2, payments: 1 });
  });

  it("el contador continúa después del último importado y nunca baja", async () => {
    // El onboarding de prueba deja la serie F del autónomo en el 37 de este año.
    expect(await counter(ids.seriesF, year)).toBe(37);
    await importInvoice(historical(year, 40, daysFromToday(0)));
    expect(await counter(ids.seriesF, year)).toBe(40);
    expect(await issueFromApp()).toBe(`${year}-0041`);

    // Un histórico que faltaba, con número menor y fecha no posterior: entra y el contador no baja.
    await importInvoice(historical(year, 39, daysFromToday(0)));
    expect(await counter(ids.seriesF, year)).toBe(41);
    expect(await issueFromApp()).toBe(`${year}-0042`);
  });

  it("no rompe el orden de fechas de lo que GNERAI OS ya ha emitido en la serie y el año", async () => {
    await importInvoice(historical(year, 38, daysFromToday(-4)));
    expect(await issueFromApp(daysFromToday(-2))).toBe(`${year}-0039`);
    // Número mayor que una de GNERAI OS con fecha anterior a ella, o menor con fecha posterior: no.
    await expectHint(importInvoice(historical(year, 45, daysFromToday(-3))), "series_order_conflict");
    await expectHint(importInvoice(historical(year, 30, daysFromToday(-1))), "series_order_conflict");
    // Menor y anterior, o mayor y posterior: sí.
    await importInvoice(historical(year, 30, daysFromToday(-5)));
    await importInvoice(historical(year, 46, daysFromToday(0)));
    // El número ya lo ha usado GNERAI OS.
    await expectHint(importInvoice(historical(year, 39, daysFromToday(-2))), "number_taken");
    // Lo que falla no deja el contador subido.
    expect(await counter(ids.seriesF, year)).toBe(46);
  });

  it("el contador nunca queda por debajo de la última factura importada, ni fijándolo a mano", async () => {
    await importInvoice(historical(py, 20, `${py}-06-01`));
    await expectHint(
      as(db, owner, () => db.query("select public.set_series_last_number($1, $2, 10)", [ids.seriesF, py])),
      "counter_below_used",
    );
    await as(db, owner, () => db.query("select public.set_series_last_number($1, $2, 25)", [ids.seriesF, py]));
    await importInvoice(historical(py, 21, `${py}-06-02`));
    expect(await counter(ids.seriesF, py)).toBe(25);
  });

  it("una factura importada es inmutable, también para service_role", async () => {
    const id = await importInvoice(historical(py, 12, `${py}-03-10`));
    for (const role of [null, "service_role"]) {
      if (role) await db.exec(`set role ${role}`);
      try {
        await expectHint(db.query("update public.invoices set notes = 'cambio' where id = $1", [id]), "invoice_immutable");
        await expectHint(db.query("delete from public.invoices where id = $1", [id]), "invoice_immutable");
        await expectHint(db.query("update public.invoice_lines set base_cents = 1 where invoice_id = $1", [id]), "invoice_immutable");
        await expectHint(db.query("delete from public.invoice_lines where invoice_id = $1", [id]), "invoice_immutable");
      } finally {
        await db.exec("reset role");
      }
    }
    // Y un socio no la escribe directamente.
    await expect(asOwner("update public.invoices set notes = 'x' where id = $1", [id])).rejects.toThrow(/permission denied/);
  });

  it("valida lo esencial: totales, formato del número, fecha, serie, cliente, emisor y líneas", async () => {
    const good = historical(py, 12, `${py}-03-10`);
    await expectHint(importInvoice({ ...good, totals: { ...good.totals, total_cents: good.totals.total_cents + 1 } }), "totals_mismatch");
    await expectHint(importInvoice({ ...good, totals: { ...good.totals, vat_cents: 0, total_cents: 90_000 - 13_500 } }), "totals_mismatch");
    await expectHint(importInvoice({ ...good, number: `${py}-12` }), "number_format_mismatch");
    await expectHint(importInvoice({ ...good, sequence: 13 }), "number_format_mismatch");
    await expectHint(importInvoice(historical(year, 90, daysFromToday(2))), "future_date");
    await expectHint(importInvoice({ ...good, series_id: ids.companySeries }), "series_invalid");
    await expectHint(importInvoice({ ...good, lines: [], totals: { subtotal_cents: 0, vat_cents: 0, irpf_cents: 0, total_cents: 0 } }), "no_lines");
    await expectHint(importInvoice({ ...good, client_id: randomUUID() }), "client_not_found");
    // La SL del onboarding de prueba no tiene fecha de alta: no pudo emitir nada.
    await expectHint(
      importInvoice({ ...good, issuer_id: ids.company, series_id: ids.companySeries, external_id: "invoice:sl:1" }),
      "issuer_inactive",
    );
    await expectHint(importInvoice({ ...good, sequence: null }), "import_invalid");
    // Nada de lo anterior ha dejado rastro.
    expect((await one<{ n: number }>("select count(*)::int as n from public.invoices")).n).toBe(0);
    expect(await counter(ids.seriesF, py)).toBeNull();
  });

  it("una rectificativa importada rectifica a su original (del mismo emisor y cliente) y la anula si es total", async () => {
    await asOwner(
      "insert into public.invoice_series (org_id, issuer_id, code, name, kind, format, is_default) values ($1, $2, 'R', 'Rectificativas', 'rectifying', 'R{yyyy}-{n:4}', true) returning id",
      [orgId, ids.freelancer],
    );
    const seriesR = (await one<{ id: string }>("select id from public.invoice_series where issuer_id = $1 and code = 'R'", [ids.freelancer])).id;
    const original = await importInvoice(historical(py, 30, `${py}-05-01`));
    const negated = [line("Mantenimiento web", -15_000, "monthly"), line("Campaña Meta Ads", -75_000, "usage")];
    const rect = {
      ...historical(py, 1, `${py}-05-20`, { lines: negated }),
      number: `R${py}-0001`,
      external_id: `invoice:${ids.freelancer}:R${py}-0001`,
      series_id: seriesR,
      kind: "rectifying",
      rectifies_number: `${py}-0030`,
      rectification_reason: "Anulación",
    };
    await expectHint(importInvoice({ ...rect, rectifies_number: `${py}-0099` }), "rectified_invalid");
    await expectHint(importInvoice({ ...rect, rectification_reason: " " }), "rectification_reason_required");
    const rectId = await importInvoice(rect);
    const rectRow = await one<{ rectifies_invoice_id: string; total_cents: number; fiscal_year: number }>(
      "select rectifies_invoice_id, total_cents, fiscal_year from public.invoices where id = $1",
      [rectId],
    );
    expect(rectRow).toEqual({ rectifies_invoice_id: original, total_cents: -95_400, fiscal_year: py });
    expect((await asOwner<{ status: string }>("select status from public.invoices_overview where id = $1", [original])).status).toBe("voided");
  });
});

describe("permisos y RLS", () => {
  async function member(role: "viewer" | "partner", email: string, org = orgId): Promise<string> {
    const user = await createUser(db, email);
    await db.query("insert into public.members (org_id, user_id, role, full_name, initials) values ($1, $2, $3, $4, 'XX')", [
      org,
      user,
      role,
      email,
    ]);
    return user;
  }

  it("un viewer o alguien de otra org no importan facturas; un socio sí", async () => {
    const viewer = await member("viewer", "viewer@example.com");
    await expect(importInvoice(historical(py, 12, `${py}-03-10`), viewer)).rejects.toMatchObject({ code: "42501" });

    const outsider = await createUser(db, "otra@example.com");
    await createOrg(db, outsider, onboardingPayload({ org: { name: "Otra", slug: "otra" }, invitations: [] }));
    await expect(importInvoice(historical(py, 12, `${py}-03-10`), outsider)).rejects.toMatchObject({ code: "42501" });

    const partner = await member("partner", "socio@example.com");
    expect(await importInvoice(historical(py, 12, `${py}-03-10`), partner)).toBeTruthy();
  });

  it("import_jobs: los ve cualquier miembro, los lleva un socio y una confirmada queda como historial", async () => {
    const viewer = await member("viewer", "viewer@example.com");
    const outsider = await createUser(db, "otra@example.com");
    await createOrg(db, outsider, onboardingPayload({ org: { name: "Otra", slug: "otra" }, invitations: [] }));

    const job = await asOwner<{ id: string }>(
      "insert into public.import_jobs (org_id, kind, file_name, headers) values ($1, 'clients', 'clientes.csv', array['Nombre','NIF']) returning id",
      [orgId],
    );
    await asOwner("insert into public.import_job_rows (org_id, job_id, row_number, raw) values ($1, $2, 2, $3::jsonb) returning id", [
      orgId,
      job.id,
      JSON.stringify(["Port", "B12345674"]),
    ]);

    const seenByViewer = await as(db, viewer, () => db.query("select id from public.import_job_rows"));
    expect(seenByViewer.rows).toHaveLength(1);
    await expect(
      as(db, viewer, () => db.query("insert into public.import_jobs (org_id, kind, file_name) values ($1, 'clients', 'x.csv')", [orgId])),
    ).rejects.toThrow(/row-level security/);
    const seenByOutsider = await as(db, outsider, () => db.query("select id from public.import_jobs"));
    expect(seenByOutsider.rows).toHaveLength(0);

    // El fichero y sus filas no se reescriben.
    await expectHint(asOwner("update public.import_jobs set headers = array['Otro'] where id = $1", [job.id]), "import_file_fixed");
    await expectHint(asOwner("update public.import_job_rows set raw = '[]'::jsonb where job_id = $1", [job.id]), "import_file_fixed");
    await asOwner("update public.import_job_rows set action = 'create', message = 'client_new', entity_id = $2 where job_id = $1", [job.id, clientId]);

    // Confirmada: ni se borra ni cambia de mapeo.
    await asOwner("update public.import_jobs set status = 'committed', committed_at = now(), mapping = '{\"display_name\":0}' where id = $1", [
      job.id,
    ]);
    await expectHint(asOwner("update public.import_jobs set mapping = '{}' where id = $1", [job.id]), "import_committed");
    const deleted = await as(db, owner, () => db.query("delete from public.import_jobs where id = $1", [job.id]));
    expect(deleted.affectedRows ?? 0).toBe(0);

    // Un borrador sí se descarta, con sus filas.
    const draft = await asOwner<{ id: string }>("insert into public.import_jobs (org_id, kind, file_name) values ($1, 'invoices', 'f.csv') returning id", [orgId]);
    await asOwner("insert into public.import_job_rows (org_id, job_id, row_number, raw) values ($1, $2, 2, '[]'::jsonb) returning id", [orgId, draft.id]);
    await as(db, owner, () => db.query("delete from public.import_jobs where id = $1", [draft.id]));
    expect((await one<{ n: number }>("select count(*)::int as n from public.import_job_rows where job_id = $1", [draft.id])).n).toBe(0);
  });
});

describe("del plan de TS a la RPC", () => {
  /** El contexto que el servidor carga para simular (aquí, con SQL directo). */
  async function loadContext(): Promise<InvoiceImportContext> {
    const issuers = await db.query<{ id: string; kind: "company" | "self_employed"; legal_name: string; tax_id: string | null; active_from: Date | null; active_until: Date | null; archived_at: Date | null; is_primary: boolean }>(
      "select id, kind, legal_name, tax_id, active_from, active_until, archived_at, is_primary from public.issuers where org_id = $1",
      [orgId],
    );
    const series = await db.query<{ id: string; issuer_id: string; code: string; kind: "ordinary" | "rectifying"; format: string; reset_yearly: boolean; is_default: boolean; archived_at: Date | null }>(
      "select id, issuer_id, code, kind, format, reset_yearly, is_default, archived_at from public.invoice_series where org_id = $1",
      [orgId],
    );
    const counters = await db.query<{ series_id: string; year: number; last_number: number }>("select series_id, year, last_number from private.invoice_series_counters");
    const rates = await db.query<{ id: string; kind: "vat" | "irpf"; rate_bps: number; regime: "general" | "exempt" | "reverse_charge_eu" | "not_subject" | null; legal_note: string | null; is_default: boolean; archived_at: Date | null }>(
      "select id, kind, rate_bps, regime, legal_note, is_default, archived_at from public.tax_rates where org_id = $1",
      [orgId],
    );
    const clients = await db.query<{ id: string; display_name: string; legal_name: string | null; tax_id: string | null; archived_at: Date | null; payment_terms_days: number | null }>(
      "select id, display_name, legal_name, tax_id, archived_at, payment_terms_days from public.clients where org_id = $1",
      [orgId],
    );
    const invoices = await db.query<{ id: string; issuer_id: string; series_id: string | null; client_id: string; number: string; fiscal_year: number | null; sequence: number | null; issued_on: Date; source: "app" | "import"; external_id: string | null; kind: "ordinary" | "rectifying"; total_cents: number }>(
      "select id, issuer_id, series_id, client_id, number, fiscal_year, sequence, issued_on, source, external_id, kind, total_cents from public.invoices where org_id = $1 and number is not null",
      [orgId],
    );
    const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
    return {
      today: daysFromToday(0),
      orgPaymentTermsDays: 30,
      issuers: issuers.rows.map((i) => ({ id: i.id, kind: i.kind, name: i.legal_name, taxId: i.tax_id, activeFrom: day(i.active_from), activeUntil: day(i.active_until), archived: i.archived_at !== null, isPrimary: i.is_primary })),
      series: series.rows.map((s) => ({ id: s.id, issuerId: s.issuer_id, code: s.code, kind: s.kind, format: s.format, resetYearly: s.reset_yearly, isDefault: s.is_default, archived: s.archived_at !== null })),
      counters: counters.rows.map((c) => ({ seriesId: c.series_id, year: c.year, lastNumber: c.last_number })),
      taxRates: rates.rows.map((t) => ({ id: t.id, kind: t.kind, rateBps: t.rate_bps, regime: t.regime, legalNote: t.legal_note, isDefault: t.is_default, archived: t.archived_at !== null })),
      clients: clients.rows.map((c) => ({ id: c.id, displayName: c.display_name, legalName: c.legal_name, taxId: c.tax_id, archived: c.archived_at !== null, paymentTermsDays: c.payment_terms_days })),
      invoices: invoices.rows.map((i) => ({ id: i.id, issuerId: i.issuer_id, seriesId: i.series_id, clientId: i.client_id, number: i.number, fiscalYear: i.fiscal_year, sequence: i.sequence, issuedOn: day(i.issued_on)!, source: i.source, externalId: i.external_id, kind: i.kind, totalCents: Number(i.total_cents) })),
    };
  }

  it("simular, confirmar y volver a importar el mismo fichero: la segunda vez todo se salta", async () => {
    const csv =
      "Número;Fecha;Cliente;NIF;Concepto;Cantidad;Precio;% IVA;% IRPF;Base imponible;Cuota IVA;Retención;Total\n" +
      `${py}-0011;15/03/${py};Port Mataró SL;B12345674;Mantenimiento web;1;150,00;21;15;150,00;31,50;22,50;159,00\n` +
      `${py}-0012;02/04/${py};Fabrik Madrid SL;B87654315;Diseño web;1;1.500,00;21;15;1.850,00;388,50;277,50;1.961,00\n` +
      `${py}-0012;02/04/${py};Fabrik Madrid SL;B87654315;Hosting anual;1;350,00;21;15;1.850,00;388,50;277,50;1.961,00\n`;
    const parsed = parseCsv(csv);
    const table = { headers: parsed.headers, rows: parsed.rows, rowNumbers: parsed.rowNumbers };
    const mapping = autoMapColumns("invoices", table.headers);
    const opts = {
      issuerId: ids.freelancer,
      defaultVatBps: null,
      paidMode: "all" as const,
      lineTypes: {},
      decimal: "," as const,
      dateOrder: "dmy" as const,
      defaultDescription: "Servicios",
      defaultRectificationReason: "Rectificación",
    };

    const first = planInvoiceImport(table, mapping, opts, await loadContext());
    expect(first.counts).toEqual({ create: 2, update: 0, skip: 0, error: 0 });
    expect(first.newClients.map((c) => c.display_name)).toEqual(["Fabrik Madrid SL"]);
    // Confirmar: primero el cliente nuevo, después cada factura con la RPC.
    const newClientId = (
      await asOwner<{ id: string }>(
        "insert into public.clients (org_id, display_name, legal_name, tax_id, tax_id_kind) values ($1, $2, $3, $4, $5) returning id",
        [orgId, first.newClients[0]!.display_name, first.newClients[0]!.legal_name, first.newClients[0]!.tax_id, first.newClients[0]!.tax_id_kind],
      )
    ).id;
    for (const inv of first.invoices) {
      const client = inv.client!.kind === "existing" ? inv.client!.id : newClientId;
      await importInvoice(toImportPayload(inv, client));
    }
    const totals = await one<{ n: number; total: number; paid: number }>(
      "select count(*)::int as n, sum(total_cents)::int as total, (select count(*)::int from public.payments) as paid from public.invoices",
    );
    expect(totals).toEqual({ n: 2, total: 15_900 + 196_100, paid: 2 });
    expect(await counter(ids.seriesF, py)).toBe(12);

    const second = planInvoiceImport(table, mapping, opts, await loadContext());
    expect(second.counts).toEqual({ create: 0, update: 0, skip: 2, error: 0 });
    expect(second.newClients).toEqual([]);
  });
});
