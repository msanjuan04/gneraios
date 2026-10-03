import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { endToEndId, proposeSpanishCreditorId } from "@/domain/collections";
import { computeLine } from "@/domain/tax";
import { composeRemittanceFile } from "@/server/collections/generate";
import { as, createDb, createOrg, createUser, type Db, daysFromToday } from "./harness";

let db: Db;
let owner: string;
let orgId: string;
let ids: { freelancer: string; company: string; vat21: string };
let clientA: string;
let clientB: string;

const CREDITOR_IBAN = "ES9121000418450200051332";
const DEBTOR_IBAN = "ES7921000813610123456789";

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


/** Factura emitida del autónomo (IRPF 15 %): 900 € de base → 954 € a cobrar, domiciliada. */
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
        header: { issuer_id: ids.freelancer, client_id: clientId, irpf_bps: 1500, payment_terms_days: 30, payment_method: "sepa_debit" },
        lines,
      }),
    ]);
    await db.query("select public.issue_invoice_begin($1, $2::date)", [id, issuedOn]);
    await db.query("select public.issue_invoice_complete($1, $2::jsonb)", [id, JSON.stringify({ pdf_path: `${orgId}/${id}.pdf` })]);
    return id;
  });
}

async function addMandate(clientId: string, reference: string, opts: { issuerId?: string; signedOn?: string } = {}) {
  return (
    await asOwner<{ id: string }>(
      `insert into public.client_mandates (org_id, client_id, issuer_id, reference, debtor_name, iban, signed_on)
       values ($1, $2, $3, $4, 'Port Mataró SL', $5, $6) returning id`,
      [orgId, clientId, opts.issuerId ?? ids.freelancer, reference, DEBTOR_IBAN, opts.signedOn ?? daysFromToday(-100)],
    )
  ).id;
}

async function confirmCreditor(issuerId = ids.freelancer) {
  await asOwner(
    `insert into public.sepa_creditors (org_id, issuer_id, creditor_identifier, creditor_identifier_confirmed_at, iban)
     values ($1, $2, $3, now(), $4)`,
    [orgId, issuerId, proposeSpanishCreditorId("12345678Z"), CREDITOR_IBAN],
  );
}

async function saveRemittance(invoiceIds: string[], opts: { id?: string; on?: string; user?: string } = {}): Promise<string> {
  return as(db, opts.user ?? owner, async () =>
    (
      await one<{ id: string }>("select public.sepa_save_remittance($1::jsonb) as id", [
        JSON.stringify({
          remittance_id: opts.id ?? null,
          issuer_id: ids.freelancer,
          collection_on: opts.on ?? daysFromToday(5),
          invoice_ids: invoiceIds,
        }),
      ])
    ).id,
  );
}

/** Lo que haría el servidor al generar: mandato vigente, pendiente y secuencia derivada de cada recibo. */
async function generatePayload(remittanceId: string, patch: (item: Record<string, unknown>) => Record<string, unknown> = (i) => i) {
  const items = await as(db, owner, async () =>
    (
      await db.query<{ id: string; invoice_number: string; amount_cents: number; mandate_id: string; next_sequence_type: string }>(
        `select it.id, it.invoice_number, it.amount_cents, m.id as mandate_id, m.next_sequence_type
         from public.sepa_remittance_items_overview it
         join public.client_mandates_overview m on m.client_id = it.client_id and m.issuer_id = it.issuer_id and m.is_active
         where it.remittance_id = $1 order by it.invoice_number`,
        [remittanceId],
      )
    ).rows,
  );
  return {
    remittance_id: remittanceId,
    message_id: `REM-${remittanceId.slice(0, 8).toUpperCase()}`,
    generated_at: new Date().toISOString(),
    file_path: `${orgId}/${remittanceId}/remesa.xml`,
    creditor: { creditor_id: proposeSpanishCreditorId("12345678Z"), name: "Socio Autónomo Uno", iban: CREDITOR_IBAN, bic: null },
    items: items.map((i) =>
      patch({
        id: i.id,
        mandate_id: i.mandate_id,
        amount_cents: Number(i.amount_cents),
        sequence_type: i.next_sequence_type,
        end_to_end_id: endToEndId(i.invoice_number, i.id),
      }),
    ),
  };
}

async function markGenerated(payload: unknown) {
  await as(db, owner, () => db.query("select public.sepa_mark_generated($1::jsonb)", [JSON.stringify(payload)]));
}

async function generateAndSend(remittanceId: string) {
  await markGenerated(await generatePayload(remittanceId));
  await asOwner("select public.sepa_mark_sent($1)", [remittanceId]);
}

async function settle(remittanceId: string, on = daysFromToday(0)): Promise<number> {
  return (await asOwner<{ n: number }>("select public.sepa_settle_remittance($1, $2::date) as n", [remittanceId, on])).n;
}

async function itemOf(remittanceId: string, invoiceId: string) {
  return asOwner<{ id: string; state: string; sequence_type: string | null; end_to_end_id: string | null; amount_cents: number }>(
    "select id, state, sequence_type, end_to_end_id, amount_cents from public.sepa_remittance_items_overview where remittance_id = $1 and invoice_id = $2",
    [remittanceId, invoiceId],
  );
}

async function invoiceState(invoiceId: string) {
  return asOwner<{ status: string; outstanding_cents: number }>(
    "select status, outstanding_cents from public.invoices_overview where id = $1",
    [invoiceId],
  );
}

beforeEach(async () => {
  db = await createDb();
  owner = await createUser(db, "owner@example.com");
  orgId = await createOrg(db, owner);
  const issuers = await db.query<{ id: string; kind: string }>("select id, kind from public.issuers where org_id = $1", [orgId]);
  await db.query(
    "update public.issuers set address_line = 'Carrer Major 1', postal_code = '08301', city = 'Mataró', iban = $2 where org_id = $1",
    [orgId, CREDITOR_IBAN],
  );
  const rates = await db.query<{ id: string; name: string }>("select id, name from public.tax_rates where org_id = $1", [orgId]);
  ids = {
    freelancer: issuers.rows.find((r) => r.kind === "self_employed")!.id,
    company: issuers.rows.find((r) => r.kind === "company")!.id,
    vat21: rates.rows.find((r) => r.name === "IVA 21 %")!.id,
  };
  const client = async (name: string, taxId: string) =>
    (
      await asOwner<{ id: string }>(
        `insert into public.clients (org_id, display_name, legal_name, tax_id, address_line, postal_code, city)
         values ($1, $2, $2, $3, 'Passeig Marítim 3', '08301', 'Mataró') returning id`,
        [orgId, name, taxId],
      )
    ).id;
  clientA = await client("Restaurant del Port", "B12345674");
  clientB = await client("Cafè l'Àvia", "12345678Z");
});

describe("RLS de cobros", () => {
  it("un viewer lee pero no toca; un socio no cambia los datos de acreedor; otra org no ve nada", async () => {
    await addMandate(clientA, "PORT-1");
    await saveRemittance([await issuedInvoice(clientA)]);

    const viewer = await createUser(db, "viewer@example.com");
    const partner = await createUser(db, "partner@example.com");
    await db.query(
      "insert into public.members (org_id, user_id, role, full_name, initials) values ($1, $2, 'viewer', 'Visor', 'VI'), ($1, $3, 'partner', 'Socia', 'SO')",
      [orgId, viewer, partner],
    );

    await as(db, viewer, async () => {
      for (const view of ["client_mandates_overview", "sepa_remittances_overview", "sepa_remittance_items_overview"]) {
        expect((await db.query(`select * from public.${view}`)).rows, view).toHaveLength(1);
      }
      await expect(
        db.query(
          "insert into public.client_mandates (org_id, client_id, issuer_id, reference, debtor_name, iban, signed_on) values ($1, $2, $3, 'X-1', 'X', $4, current_date)",
          [orgId, clientB, ids.freelancer, DEBTOR_IBAN],
        ),
      ).rejects.toThrow(/row-level security/);
    });
    await expect(saveRemittance([], { user: viewer })).rejects.toThrow(/Sin permiso/);

    // Los mandatos los lleva un socio; los datos de acreedor, solo un owner.
    await as(db, partner, async () => {
      await db.query(
        "insert into public.client_mandates (org_id, client_id, issuer_id, reference, debtor_name, iban, signed_on) values ($1, $2, $3, 'CAFE-1', 'Cafè', $4, current_date)",
        [orgId, clientB, ids.freelancer, DEBTOR_IBAN],
      );
      await expect(
        db.query("insert into public.sepa_creditors (org_id, issuer_id, creditor_identifier) values ($1, $2, 'ES5800012345678Z')", [
          orgId,
          ids.freelancer,
        ]),
      ).rejects.toThrow(/row-level security/);
      // Remesas y recibos se escriben solo con las RPC.
      await expect(
        db.query("insert into public.sepa_remittances (org_id, issuer_id, collection_on) values ($1, $2, current_date + 5)", [
          orgId,
          ids.freelancer,
        ]),
      ).rejects.toThrow(/permission denied/);
      await expect(db.query("update public.sepa_remittance_items set return_code = 'AM04'")).rejects.toThrow(/permission denied/);
    });

    // El servidor (service_role: cron, agentes, portal) también lee las vistas.
    await db.exec("set role service_role");
    try {
      for (const view of ["client_mandates_overview", "sepa_remittances_overview", "sepa_remittance_items_overview"]) {
        expect((await db.query(`select * from public.${view}`)).rows.length, view).toBeGreaterThan(0);
      }
    } finally {
      await db.exec("reset role");
    }

    const outsider = await createUser(db, "fuera@example.com");
    await as(db, outsider, async () => {
      for (const table of [
        "sepa_creditors",
        "client_mandates",
        "sepa_remittances",
        "sepa_remittance_items",
        "client_mandates_overview",
        "sepa_remittances_overview",
        "sepa_remittance_items_overview",
      ]) {
        expect((await db.query(`select * from public.${table}`)).rows, table).toHaveLength(0);
      }
    });
    await expect(saveRemittance([], { user: outsider })).rejects.toThrow(/Sin permiso/);
  });
});

describe("mandatos", () => {
  it("la referencia es única por acreedor (sin distinguir mayúsculas), también si está revocado", async () => {
    await addMandate(clientA, "PORT-2026");
    await expect(addMandate(clientB, "port-2026")).rejects.toMatchObject({ code: "23505" });
    // Otro acreedor (la SL) puede usar la misma referencia.
    await addMandate(clientB, "PORT-2026", { issuerId: ids.company });
    await asOwner("update public.client_mandates set revoked_at = now() where reference = 'PORT-2026' and issuer_id = $1", [ids.freelancer]);
    await expect(addMandate(clientB, "PORT-2026")).rejects.toMatchObject({ code: "23505" });
  });

  it("un solo mandato activo por cliente y acreedor; revocado, se firma otro", async () => {
    const first = await addMandate(clientA, "PORT-1");
    await expect(addMandate(clientA, "PORT-2")).rejects.toMatchObject({ code: "23505" });
    await asOwner("update public.client_mandates set revoked_at = now(), revoke_reason = 'Cambio de banco' where id = $1", [first]);
    await addMandate(clientA, "PORT-2");
    const rows = await asOwner<{ n: number }>(
      "select count(*)::int as n from public.client_mandates_overview where client_id = $1 and is_active",
      [clientA],
    );
    expect(rows.n).toBe(1);
  });

  it("normaliza el IBAN y el BIC y rechaza referencias que no son identificadores SEPA", async () => {
    const id = (
      await asOwner<{ id: string }>(
        `insert into public.client_mandates (org_id, client_id, issuer_id, reference, debtor_name, iban, bic, signed_on)
         values ($1, $2, $3, ' PORT-1 ', ' Port ', 'es79 2100 0813 6101 2345 6789', 'caix es bb', current_date) returning id`,
        [orgId, clientA, ids.freelancer],
      )
    ).id;
    expect(await one("select reference, debtor_name, iban, bic from public.client_mandates where id = $1", [id])).toEqual({
      reference: "PORT-1",
      debtor_name: "Port",
      iban: DEBTOR_IBAN,
      bic: "CAIXESBB",
    });
    for (const reference of ["CON ESPACIO", "/PORT", "PORT/", "A//B", "X".repeat(36)]) {
      await expect(addMandate(clientB, reference), reference).rejects.toMatchObject({ code: "23514" });
    }
  });

  it("la secuencia es FRST hasta que un adeudo del mandato se genera; un devuelto no cuenta", async () => {
    const mandate = await addMandate(clientA, "PORT-1");
    await confirmCreditor();
    const sequence = async () =>
      (await asOwner<{ s: string }>("select next_sequence_type as s from public.client_mandates_overview where id = $1", [mandate])).s;
    expect(await sequence()).toBe("FRST");

    const invoice = await issuedInvoice(clientA);
    const remittance = await saveRemittance([invoice]);
    // En borrador todavía no cuenta.
    expect(await sequence()).toBe("FRST");
    await generateAndSend(remittance);
    expect((await itemOf(remittance, invoice)).sequence_type).toBe("FRST");
    expect(await sequence()).toBe("RCUR");

    // Devuelto: el mandato no se ha usado con éxito, el siguiente vuelve a ser FRST.
    const item = await itemOf(remittance, invoice);
    await asOwner("select public.sepa_return_item($1, current_date, 'AM04', 'Saldo insuficiente')", [item.id]);
    expect(await sequence()).toBe("FRST");
  });

  it("un mandato usado en un fichero no cambia sus datos ni se borra: se revoca", async () => {
    const mandate = await addMandate(clientA, "PORT-1");
    await confirmCreditor();
    await markGenerated(await generatePayload(await saveRemittance([await issuedInvoice(clientA)])));
    await expectHint(asOwner("update public.client_mandates set iban = 'DE89370400440532013000' where id = $1", [mandate]), "mandate_in_use");
    await expectHint(asOwner("delete from public.client_mandates where id = $1", [mandate]), "mandate_in_use");
    await asOwner("update public.client_mandates set revoked_at = now() where id = $1", [mandate]);
  });
});

describe("remesas", () => {
  it("una factura va en una sola remesa abierta; devuelta, puede volver a presentarse", async () => {
    await addMandate(clientA, "PORT-1");
    await confirmCreditor();
    const invoice = await issuedInvoice(clientA);
    const first = await saveRemittance([invoice]);
    await expectHint(saveRemittance([invoice]), "invoice_in_open_remittance");

    await generateAndSend(first);
    await expectHint(saveRemittance([invoice]), "invoice_in_open_remittance");
    const item = await itemOf(first, invoice);
    await asOwner("select public.sepa_return_item($1, current_date, 'AM04', null)", [item.id]);
    const second = await saveRemittance([invoice]);
    expect(second).not.toBe(first);

    // Deshacer la devolución chocaría con la nueva remesa abierta.
    await expectHint(asOwner("select public.sepa_undo_return($1)", [item.id]), "invoice_in_open_remittance");
  });

  it("guardar con el mismo id es idempotente y el conjunto de facturas es completo", async () => {
    const [a, b] = [await issuedInvoice(clientA), await issuedInvoice(clientB)];
    const id = randomUUID();
    expect(await saveRemittance([a, b], { id })).toBe(id);
    expect(await saveRemittance([a, b], { id })).toBe(id);
    const count = async () =>
      (await asOwner<{ n: number }>("select count(*)::int as n from public.sepa_remittance_items where remittance_id = $1", [id])).n;
    expect(await count()).toBe(2);
    await saveRemittance([b], { id });
    expect(await count()).toBe(1);
    // En borrador, el importe es el pendiente de hoy (derivado, no guardado).
    expect(await itemOf(id, b)).toMatchObject({ amount_cents: 95_400, sequence_type: null, end_to_end_id: null });
  });

  it("solo entran facturas emitidas del emisor, con fecha de cobro futura", async () => {
    const invoice = await issuedInvoice(clientA);
    await expectHint(saveRemittance([invoice], { on: daysFromToday(0) }), "collection_date_past");
    const draft = await as(db, owner, async () =>
      (
        await one<{ id: string }>("select public.save_invoice_draft($1::jsonb) as id", [
          JSON.stringify({ header: { issuer_id: ids.freelancer, client_id: clientA }, lines: [] }),
        ])
      ).id,
    );
    await expectHint(saveRemittance([draft]), "invoice_not_collectible");
  });

  it("generar exige el ICS confirmado y que nada haya cambiado; congela mandato, importe y secuencia", async () => {
    await addMandate(clientA, "PORT-1");
    const invoice = await issuedInvoice(clientA);
    const remittance = await saveRemittance([invoice]);
    await expectHint(markGenerated(await generatePayload(remittance)), "creditor_unconfirmed");

    // Guardado pero sin confirmar, tampoco.
    await asOwner("insert into public.sepa_creditors (org_id, issuer_id, creditor_identifier, iban) values ($1, $2, $3, $4)", [
      orgId,
      ids.freelancer,
      proposeSpanishCreditorId("12345678Z"),
      CREDITOR_IBAN,
    ]);
    await expectHint(markGenerated(await generatePayload(remittance)), "creditor_unconfirmed");
    await asOwner("update public.sepa_creditors set creditor_identifier_confirmed_at = now() where issuer_id = $1", [ids.freelancer]);

    // Un importe que no es el pendiente o una secuencia que no es la derivada: no se congela nada.
    await expectHint(markGenerated(await generatePayload(remittance, (i) => ({ ...i, amount_cents: 1 }))), "remittance_changed");
    await expectHint(markGenerated(await generatePayload(remittance, (i) => ({ ...i, sequence_type: "RCUR" }))), "remittance_changed");
    await expectHint(markGenerated({ ...(await generatePayload(remittance)), items: [] }), "remittance_changed");

    await markGenerated(await generatePayload(remittance));
    const item = await itemOf(remittance, invoice);
    expect(item).toMatchObject({ state: "pending", sequence_type: "FRST", amount_cents: 95_400 });
    expect(item.end_to_end_id).toMatch(/^\d{4}-\d{4}-[0-9A-F]{8}$/);

    // Lo generado no se toca; se puede volver a borrador mientras no se haya enviado.
    await expectHint(saveRemittance([invoice], { id: remittance }), "remittance_not_draft");
    const path = await asOwner<{ p: string }>("select public.sepa_revert_to_draft($1) as p", [remittance]);
    expect(path.p).toBe(`${orgId}/${remittance}/remesa.xml`);
    expect(await itemOf(remittance, invoice)).toMatchObject({ sequence_type: null, end_to_end_id: null });
  });

  it("lo que compone el servidor (fichero y recibos) es lo que la base de datos congela", async () => {
    await addMandate(clientA, "PORT-1");
    await addMandate(clientB, "CAFE-1");
    await confirmCreditor();
    const [a, b] = [await issuedInvoice(clientA), await issuedInvoice(clientB)];
    const remittance = await saveRemittance([a, b]);

    const rows = await as(db, owner, async () =>
      (
        await db.query<{
          id: string;
          invoice_number: string;
          amount_cents: string;
          mandate_id: string;
          reference: string;
          debtor_name: string;
          iban: string;
          signed_on: Date;
          next_sequence_type: "FRST" | "RCUR";
        }>(
          `select it.id, it.invoice_number, it.amount_cents, m.id as mandate_id, m.reference, m.debtor_name, m.iban, m.signed_on, m.next_sequence_type
           from public.sepa_remittance_items_overview it
           join public.client_mandates_overview m on m.client_id = it.client_id and m.issuer_id = it.issuer_id and m.is_active
           where it.remittance_id = $1`,
          [remittance],
        )
      ).rows,
    );
    const file = composeRemittanceFile({
      remittanceId: remittance,
      collectionOn: daysFromToday(5),
      createdAt: "2026-09-26T10:15:30",
      creditor: { creditorId: proposeSpanishCreditorId("12345678Z")!, name: "Socio Autónomo Uno", iban: CREDITOR_IBAN, bic: null },
      items: rows.map((r) => ({
        itemId: r.id,
        invoiceNumber: r.invoice_number,
        amountCents: Number(r.amount_cents),
        mandate: {
          id: r.mandate_id,
          reference: r.reference,
          debtorName: r.debtor_name,
          iban: r.iban,
          bic: null,
          signedOn: r.signed_on.toISOString().slice(0, 10),
          nextSequence: r.next_sequence_type,
        },
      })),
      remittanceInfo: (number) => `Factura ${number}`,
    });
    await markGenerated({
      remittance_id: remittance,
      message_id: file.messageId,
      generated_at: new Date().toISOString(),
      file_path: `${orgId}/${remittance}/${file.messageId}.xml`,
      creditor: { creditor_id: file.creditor.creditorId, name: file.creditor.name, iban: file.creditor.iban, bic: file.creditor.bic },
      items: file.items,
    });

    const frozen = await as(db, owner, async () =>
      (await db.query<{ end_to_end_id: string; amount_cents: string }>(
        "select end_to_end_id, amount_cents from public.sepa_remittance_items where remittance_id = $1 order by end_to_end_id",
        [remittance],
      )).rows,
    );
    expect(frozen).toHaveLength(2);
    for (const item of frozen) expect(file.xml).toContain(`<EndToEndId>${item.end_to_end_id}</EndToEndId>`);
    expect(file.xml).toContain("<CtrlSum>1908.00</CtrlSum>");
    expect(file.xml).toContain("<SeqTp>FRST</SeqTp>");
  });

  it("una remesa enviada no se borra ni vuelve a borrador", async () => {
    await addMandate(clientA, "PORT-1");
    await confirmCreditor();
    const remittance = await saveRemittance([await issuedInvoice(clientA)]);
    await generateAndSend(remittance);
    await expectHint(asOwner("select public.sepa_revert_to_draft($1)", [remittance]), "remittance_locked");
    // La RLS no deja borrarla a un socio (0 filas) y el trigger tampoco al servidor.
    await as(db, owner, () => db.query("delete from public.sepa_remittances where id = $1", [remittance]));
    expect((await db.query("select 1 from public.sepa_remittances where id = $1", [remittance])).rows).toHaveLength(1);
    await db.exec("set role service_role");
    try {
      await expectHint(db.query("delete from public.sepa_remittances where id = $1", [remittance]), "remittance_locked");
    } finally {
      await db.exec("reset role");
    }
  });
});

describe("cobro y devoluciones", () => {
  async function sentRemittance() {
    await addMandate(clientA, "PORT-1");
    await addMandate(clientB, "CAFE-1");
    await confirmCreditor();
    const [a, b] = [await issuedInvoice(clientA), await issuedInvoice(clientB)];
    const remittance = await saveRemittance([a, b]);
    await generateAndSend(remittance);
    return { remittance, a, b };
  }

  const payments = async (invoiceId: string) =>
    (
      await as(db, owner, () =>
        db.query<{ amount_cents: number; method: string; reference: string }>(
          "select amount_cents, method, reference from public.payments where invoice_id = $1 order by created_at, amount_cents desc",
          [invoiceId],
        ),
      )
    ).rows.map((p) => ({ ...p, amount_cents: Number(p.amount_cents) }));

  it("cobrar crea un cobro por recibo, una sola vez, con la referencia del adeudo", async () => {
    const { remittance, a, b } = await sentRemittance();
    await expectHint(settle(remittance, daysFromToday(1)), "settle_date_invalid");
    expect(await settle(remittance)).toBe(2);
    expect(await settle(remittance)).toBe(0);

    const e2e = (await itemOf(remittance, a)).end_to_end_id;
    expect(await payments(a)).toEqual([{ amount_cents: 95_400, method: "sepa_debit", reference: e2e }]);
    expect(await payments(b)).toHaveLength(1);
    expect(await invoiceState(a)).toMatchObject({ status: "paid", outstanding_cents: 0 });
    expect((await itemOf(remittance, a)).state).toBe("collected");
    const summary = await asOwner<{ status: string; items_count: number; total_cents: number }>(
      "select status, items_count, total_cents from public.sepa_remittances_overview where id = $1",
      [remittance],
    );
    expect(summary).toEqual({ status: "settled", items_count: 2, total_cents: 190_800 });
  });

  it("solo se cobra una remesa enviada", async () => {
    await addMandate(clientA, "PORT-1");
    await confirmCreditor();
    const remittance = await saveRemittance([await issuedInvoice(clientA)]);
    await expectHint(settle(remittance), "remittance_not_sent");
    await markGenerated(await generatePayload(remittance));
    await expectHint(settle(remittance), "remittance_not_sent");
  });

  it("un recibo devuelto antes del abono no se cobra y su factura sigue pendiente", async () => {
    const { remittance, a, b } = await sentRemittance();
    const returned = await itemOf(remittance, a);
    await asOwner("select public.sepa_return_item($1, current_date, 'MD06', 'El cliente lo ha devuelto')", [returned.id]);
    expect(await settle(remittance)).toBe(1);
    expect(await payments(a)).toEqual([]);
    expect(await invoiceState(a)).toMatchObject({ outstanding_cents: 95_400 });
    expect(await invoiceState(b)).toMatchObject({ status: "paid" });
    const item = await asOwner<{ state: string; return_code: string; return_reason: string }>(
      "select state, return_code, return_reason from public.sepa_remittance_items_overview where id = $1",
      [returned.id],
    );
    expect(item).toEqual({ state: "returned", return_code: "MD06", return_reason: "El cliente lo ha devuelto" });

    // Registrada por error: deshacerla después del abono registra el cobro con la fecha de abono.
    await asOwner("select public.sepa_undo_return($1)", [returned.id]);
    expect(await invoiceState(a)).toMatchObject({ status: "paid" });
  });

  it("una devolución después del abono registra el cobro negativo; deshacerla lo borra", async () => {
    const { remittance, a } = await sentRemittance();
    await settle(remittance);
    const item = await itemOf(remittance, a);
    await expectHint(asOwner("select public.sepa_return_item($1, $2::date, 'AM04', null)", [item.id, daysFromToday(1)]), "return_date_invalid");
    await asOwner("select public.sepa_return_item($1, current_date, 'AM04', 'Saldo insuficiente')", [item.id]);
    // Repetirla no duplica nada.
    await asOwner("select public.sepa_return_item($1, current_date, 'AM04', 'Saldo insuficiente')", [item.id]);
    expect((await payments(a)).map((p) => p.amount_cents)).toEqual([95_400, -95_400]);
    expect(await invoiceState(a)).toMatchObject({ outstanding_cents: 95_400 });
    const summary = await asOwner<{ returned_count: number; returned_cents: number }>(
      "select returned_count, returned_cents from public.sepa_remittances_overview where id = $1",
      [remittance],
    );
    expect(summary).toEqual({ returned_count: 1, returned_cents: 95_400 });

    await asOwner("select public.sepa_undo_return($1)", [item.id]);
    expect((await payments(a)).map((p) => p.amount_cents)).toEqual([95_400]);
    expect(await invoiceState(a)).toMatchObject({ status: "paid" });
  });

  it("el cobro de una remesa no se borra a mano: se deshace con una devolución", async () => {
    const { remittance, a } = await sentRemittance();
    await settle(remittance);
    await expect(asOwner("delete from public.payments where invoice_id = $1", [a])).rejects.toMatchObject({ code: "23503" });
  });
});

describe("datos de acreedor", () => {
  it("normaliza el ICS y un cambio de ICS pierde la confirmación", async () => {
    await asOwner(
      "insert into public.sepa_creditors (org_id, issuer_id, creditor_identifier, creditor_identifier_confirmed_at, bic) values ($1, $2, 'es58 000 12345678z', now(), 'caix es bb xxx')",
      [orgId, ids.freelancer],
    );
    const row = async () =>
      asOwner<{ creditor_identifier: string; confirmed: boolean; by_owner: boolean; bic: string }>(
        `select creditor_identifier, creditor_identifier_confirmed_at is not null as confirmed,
                creditor_identifier_confirmed_by = $2 as by_owner, bic
         from public.sepa_creditors where issuer_id = $1`,
        [ids.freelancer, owner],
      );
    expect(await row()).toEqual({ creditor_identifier: "ES5800012345678Z", confirmed: true, by_owner: true, bic: "CAIXESBBXXX" });
    await asOwner("update public.sepa_creditors set creditor_identifier = 'ES58001-12345678Z' where issuer_id = $1", [ids.freelancer]);
    expect(await row()).toMatchObject({ creditor_identifier: "ES5800112345678Z", confirmed: false });
  });
});
