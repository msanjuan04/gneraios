import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { INVOICE_FIXTURES } from "@/domain/invoice-import/fixtures";
import { buildImportPayload, type ImportForm, initialForm } from "@/domain/invoice-import/form";
import type { ImportSetup } from "@/domain/invoice-import/match";
import { parseInvoiceText } from "@/domain/invoice-import/parse";
import { as, createDb, createOrg, createUser, type Db } from "./harness";

// El PDF original de las facturas importadas (20260927110000_facturas_adjuntas.sql) y el camino
// completo de «Importar facturas emitidas»: texto del PDF → lector → formulario → payload →
// import_historical_invoice (con el cobro en su propia fecha) → enlace del PDF, con RLS.

let db: Db;
let owner: string;
let orgId: string;
let setup: ImportSetup;

const today = new Date().toISOString().slice(0, 10);

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0]!;
}

async function asUser<T>(user: string, sql: string, params: unknown[] = []): Promise<T[]> {
  return as(db, user, async () => (await db.query<T>(sql, params)).rows);
}

async function expectHint(promise: Promise<unknown>, hint: string) {
  await expect(promise).rejects.toMatchObject({ hint });
}

async function addMember(email: string, role: "viewer" | "partner" | "owner", org = orgId): Promise<string> {
  const user = await createUser(db, email);
  await db.query("insert into public.members (org_id, user_id, role, full_name, initials) values ($1, $2, $3, $4, 'XX')", [org, user, role, email.split("@")[0]]);
  return user;
}

/** Lo que carga el servidor para el panel (loadImportSetup), leído aquí con SQL. */
async function loadSetup(): Promise<ImportSetup> {
  const issuers = await db.query<Record<string, unknown>>(
    "select id, kind, legal_name, trade_name, tax_id, active_from, active_until, archived_at, is_primary, default_irpf_bps from public.issuers where org_id = $1",
    [orgId],
  );
  const series = await db.query<Record<string, unknown>>(
    "select id, issuer_id, code, name, format, reset_yearly, is_default, archived_at from public.invoice_series where org_id = $1 and kind = 'ordinary'",
    [orgId],
  );
  const rates = await db.query<Record<string, unknown>>(
    "select id, kind, name, rate_bps, regime, legal_note, is_default from public.tax_rates where org_id = $1 and archived_at is null",
    [orgId],
  );
  const clients = await db.query<Record<string, unknown>>("select id, display_name, legal_name, tax_id, payment_terms_days from public.clients where org_id = $1", [orgId]);
  const date = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : (v as string | null));
  const rate = (r: Record<string, unknown>) => ({
    id: r.id as string,
    name: r.name as string,
    rateBps: r.rate_bps as number,
    regime: (r.regime as ImportSetup["vatRates"][number]["regime"]) ?? null,
    legalNote: (r.legal_note as string | null) ?? null,
    isDefault: r.is_default as boolean,
  });
  return {
    today,
    orgPaymentTermsDays: 30,
    issuers: issuers.rows.map((i) => ({
      id: i.id as string,
      name: (i.trade_name as string | null) ?? (i.legal_name as string),
      legalName: i.legal_name as string,
      taxId: i.tax_id as string | null,
      kind: i.kind as "company" | "self_employed",
      activeFrom: date(i.active_from),
      activeUntil: date(i.active_until),
      archived: i.archived_at !== null,
      isPrimary: i.is_primary as boolean,
      defaultIrpfBps: i.default_irpf_bps as number,
    })),
    series: series.rows.map((s) => ({
      id: s.id as string,
      issuerId: s.issuer_id as string,
      code: s.code as string,
      name: s.name as string,
      format: s.format as string,
      resetYearly: s.reset_yearly as boolean,
      isDefault: s.is_default as boolean,
      archived: s.archived_at !== null,
    })),
    vatRates: rates.rows.filter((r) => r.kind === "vat").map(rate),
    irpfRates: rates.rows.filter((r) => r.kind === "irpf").map(rate),
    clients: clients.rows.map((c) => ({
      id: c.id as string,
      name: c.display_name as string,
      legalName: c.legal_name as string | null,
      taxId: c.tax_id as string | null,
      paymentTermsDays: c.payment_terms_days as number | null,
    })),
    mandates: [],
  };
}

/** El formulario de la factura de la app de facturas (Restaurant del Port, 2025-0036), como lo deja el panel. */
function appForm(overrides: Partial<ImportForm> = {}): ImportForm {
  const fixture = INVOICE_FIXTURES.find((f) => f.name === "app de facturas")!;
  const extraction = parseInvoiceText(fixture.text, { issuerTaxIds: setup.issuers.flatMap((i) => (i.taxId ? [i.taxId] : [])) });
  const { form } = initialForm(extraction, setup, { defaultDescription: "Servicios profesionales" });
  return { ...form, ...overrides };
}

async function importAs(user: string, form: ImportForm): Promise<string> {
  const built = buildImportPayload(form, setup);
  if (!built.ok) throw new Error(JSON.stringify(built.issues));
  const [row] = await asUser<{ id: string }>(user, "select public.import_historical_invoice($1::jsonb) as id", [JSON.stringify(built.payload)]);
  return row!.id;
}

function attachment(invoiceId: string, over: Record<string, unknown> = {}) {
  const sha256 = createHash("sha256").update(`pdf:${invoiceId}`).digest("hex");
  return { org_id: orgId, invoice_id: invoiceId, storage_path: `${orgId}/${invoiceId}.pdf`, file_name: "factura.pdf", size_bytes: 1234, sha256, ...over };
}

async function attach(user: string, row: Record<string, unknown>) {
  return asUser<{ id: string }>(
    user,
    `insert into public.invoice_attachments (org_id, invoice_id, storage_path, file_name, size_bytes, sha256)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [row.org_id, row.invoice_id, row.storage_path, row.file_name, row.size_bytes, row.sha256],
  );
}

beforeEach(async () => {
  db = await createDb();
  owner = await createUser(db, "owner@example.com");
  orgId = await createOrg(db, owner);
  await as(db, owner, () =>
    db.query(
      `insert into public.clients (org_id, display_name, legal_name, tax_id, address_line, postal_code, city)
       values ($1, 'Restaurant del Port', 'Restaurant del Port SL', 'B12345674', 'Passeig Marítim 3', '08301', 'Mataró')`,
      [orgId],
    ),
  );
  setup = await loadSetup();
});

describe("importar una factura leída de un PDF", () => {
  it("se lee, se rellena y entra ya emitida con su número, su cliente y su cobro en su propia fecha", async () => {
    const form = appForm({ payment: { status: "paid", paidOn: "2025-04-20", amount: "", method: "transfer", reference: "Transf. 123" } });
    expect(form.clientId).not.toBeNull();
    const id = await importAs(owner, form);

    const invoice = await one<Record<string, unknown>>(
      "select source, lifecycle, number, sequence, fiscal_year, issued_on::text, due_on::text, subtotal_cents, vat_cents, irpf_cents, total_cents, pdf_path from public.invoices where id = $1",
      [id],
    );
    expect(invoice).toMatchObject({
      source: "import",
      lifecycle: "issued",
      number: "2025-0036",
      sequence: 36,
      issued_on: "2025-03-15",
      due_on: "2025-04-14",
      subtotal_cents: 90_000,
      vat_cents: 18_900,
      irpf_cents: 13_500,
      total_cents: 95_400,
      pdf_path: null,
    });
    const payment = await one<Record<string, unknown>>("select amount_cents, paid_on::text, method, reference from public.payments where invoice_id = $1", [id]);
    // La fecha de cobro es la del cobro, no la de la factura.
    expect(payment).toEqual({ amount_cents: 95_400, paid_on: "2025-04-20", method: "transfer", reference: "Transf. 123" });
    const overview = await one<Record<string, unknown>>("select status, last_paid_on::text, outstanding_cents from public.invoices_overview where id = $1", [id]);
    expect(overview).toEqual({ status: "paid", last_paid_on: "2025-04-20", outstanding_cents: 0 });
    const lines = await db.query<{ description: string; billing_type: string; base_cents: number }>(
      "select description, billing_type, base_cents from public.invoice_lines where invoice_id = $1 order by position",
      [id],
    );
    expect(lines.rows).toEqual([
      { description: "Mantenimiento web marzo 2025", billing_type: "monthly", base_cents: 15_000 },
      { description: "Campaña Meta Ads · marzo", billing_type: "usage", base_cents: 75_000 },
    ]);
    // El contador de la serie en ese año sube hasta la secuencia importada.
    const counter = await one<{ last_number: number }>(
      "select c.last_number from private.invoice_series_counters c join public.invoices i on i.series_id = c.series_id and c.year = i.fiscal_year where i.id = $1",
      [id],
    );
    expect(counter.last_number).toBe(36);

    // Volver a importarla (un reintento) no la duplica.
    expect(await importAs(owner, form)).toBe(id);
  });

  it("pendiente: sin cobro, vencida; el cobro se registra después como en cualquier factura", async () => {
    const id = await importAs(owner, appForm({ payment: { status: "pending", paidOn: "", amount: "", method: "transfer", reference: "" } }));
    expect((await one<{ n: number }>("select count(*)::int as n from public.payments where invoice_id = $1", [id])).n).toBe(0);
    expect((await one<{ status: string }>("select status from public.invoices_overview where id = $1", [id])).status).toBe("overdue");
    // «Registrar cobro» (addPayment): un socio inserta el cobro de una factura emitida.
    await asUser(owner, "insert into public.payments (org_id, invoice_id, amount_cents, paid_on, method) values ($1, $2, 95400, '2025-06-01', 'transfer')", [orgId, id]);
    expect(await one("select status, last_paid_on::text from public.invoices_overview where id = $1", [id])).toEqual({ status: "paid", last_paid_on: "2025-06-01" });
  });

  it("cobro parcial: queda lo pendiente", async () => {
    const id = await importAs(owner, appForm({ payment: { status: "partial", paidOn: "2025-04-01", amount: "400,00", method: "sepa_debit", reference: "" } }));
    expect(await one("select paid_cents, outstanding_cents from public.invoices_overview where id = $1", [id])).toEqual({ paid_cents: 40_000, outstanding_cents: 55_400 });
    expect((await one<{ method: string }>("select method from public.payments where invoice_id = $1", [id])).method).toBe("sepa_debit");
  });

  it("un cobro con fecha futura lo rechaza también la base de datos", async () => {
    const form = appForm({ payment: { status: "paid", paidOn: "2025-04-20", amount: "", method: "transfer", reference: "" } });
    const built = buildImportPayload(form, setup);
    if (!built.ok) throw new Error("payload");
    const payload = { ...built.payload, payment: { ...built.payload.payment!, paid_on: "2999-01-01" } };
    await expectHint(asUser(owner, "select public.import_historical_invoice($1::jsonb)", [JSON.stringify(payload)]), "future_date");
  });
});

describe("invoice_attachments: el PDF original", () => {
  it("se enlaza con la factura importada; lo ve cualquier miembro, lo adjunta un socio", async () => {
    const id = await importAs(owner, appForm());
    const viewer = await addMember("viewer@example.com", "viewer");
    await expect(attach(viewer, attachment(id))).rejects.toThrow(/row-level security/);
    const [row] = await attach(owner, attachment(id));
    expect(row!.id).toBeTruthy();
    expect(await asUser(viewer, "select file_name, kind from public.invoice_attachments where invoice_id = $1", [id])).toEqual([{ file_name: "factura.pdf", kind: "original" }]);
    // Reconocer el mismo PDF subido otra vez: por su huella.
    const { sha256 } = attachment(id);
    expect(await asUser(owner, "select invoice_id from public.invoice_attachments where org_id = $1 and sha256 = $2", [orgId, sha256])).toEqual([{ invoice_id: id }]);
  });

  it("un original por factura, que no se reescribe (se quita y se vuelve a adjuntar)", async () => {
    const id = await importAs(owner, appForm());
    await attach(owner, attachment(id));
    await expect(attach(owner, attachment(id, { sha256: "a".repeat(64) }))).rejects.toThrow(/invoice_attachments_invoice_id_kind_key/);
    await expect(asUser(owner, "update public.invoice_attachments set file_name = 'otro.pdf' where invoice_id = $1", [id])).rejects.toThrow(/permission denied/);
    // Ni siquiera el servidor (sin RLS) lo reescribe.
    await expectHint(db.query("update public.invoice_attachments set file_name = 'otro.pdf' where invoice_id = $1", [id]), "attachment_immutable");
    expect(await asUser(owner, "delete from public.invoice_attachments where invoice_id = $1 returning id", [id])).toHaveLength(1);
    await attach(owner, attachment(id, { sha256: "b".repeat(64) }));
  });

  it("solo en facturas importadas y emitidas, con la ruta dentro de su org", async () => {
    const id = await importAs(owner, appForm());
    // Un borrador de GNERAI OS no lleva «original» (su PDF legal lo genera la emisión).
    const series = setup.series.find((s) => s.issuerId === setup.issuers.find((i) => i.taxId)!.id)!;
    const client = setup.clients[0]!;
    const draft = await as(db, owner, async () =>
      (
        await one<{ id: string }>("select public.save_invoice_draft($1::jsonb) as id", [
          JSON.stringify({
            header: { issuer_id: series.issuerId, client_id: client.id, irpf_bps: 0 },
            lines: [
              {
                id: "00000000-0000-4000-8000-000000000001",
                description: "Web",
                quantity: "1",
                unit_price_cents: 10_000,
                discount_bps: 0,
                base_cents: 10_000,
                tax_rate_id: setup.vatRates.find((r) => r.rateBps === 2100)!.id,
                vat_bps: 2100,
                vat_regime: "general",
                vat_cents: 2100,
                irpf_applies: false,
                irpf_cents: 0,
                billing_type: "one_off",
              },
            ],
          }),
        ])
      ).id,
    );
    await expectHint(attach(owner, attachment(draft)), "attachment_not_imported");
    await expect(attach(owner, attachment(id, { storage_path: `otra-org/${id}.pdf` }))).rejects.toThrow(/invoice_attachments_check/);
    await expect(attach(owner, attachment(id, { sha256: "no-es-una-huella" }))).rejects.toThrow(/invoice_attachments_sha256_check/);
  });

  it("otra org no ve los PDF ni puede enlazar uno a una factura ajena", async () => {
    const id = await importAs(owner, appForm());
    await attach(owner, attachment(id));
    const stranger = await createUser(db, "otra@example.com");
    const otherOrg = await createOrg(db, stranger, {
      ...(await import("./harness")).onboardingPayload({ org: { name: "Otra", slug: "otra" } }),
    });
    expect(await asUser(stranger, "select id from public.invoice_attachments")).toEqual([]);
    // Con su org y la factura de la nuestra: no es una factura importada de su org (y la FK compuesta tampoco lo dejaría).
    await expectHint(attach(stranger, attachment(id, { org_id: otherOrg, storage_path: `${otherOrg}/${id}.pdf` })), "attachment_not_imported");
    // Sin el trigger (el servidor), la FK compuesta (org, factura) lo impide igualmente.
    await asUser(owner, "delete from public.invoice_attachments where invoice_id = $1", [id]);
    await db.exec("alter table public.invoice_attachments disable trigger invoice_attachments_guard");
    await expect(
      db.query("insert into public.invoice_attachments (org_id, invoice_id, storage_path, file_name, size_bytes, sha256) values ($1, $2, $3, 'x.pdf', 1, $4)", [
        otherOrg,
        id,
        `${otherOrg}/${id}.pdf`,
        "c".repeat(64),
      ]),
    ).rejects.toThrow(/foreign key/);
    await db.exec("alter table public.invoice_attachments enable trigger invoice_attachments_guard");
  });
});
