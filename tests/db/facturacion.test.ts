import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { formatInvoiceNumber } from "@/domain/invoicing/number-format";
import { computeLine } from "@/domain/tax";
import { as, createDb, createOrg, createUser, type Db, daysFromToday } from "./harness";

let db: Db;
let owner: string;
let orgId: string;
let ids: { freelancer: string; company: string; seriesF: string; vat21: string; exempt: string };
let clientId: string;

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0]!;
}

async function asOwner<T>(sql: string, params: unknown[] = []): Promise<T> {
  return as(db, owner, () => one<T>(sql, params));
}

/** Rechaza con el hint de Postgres que la app traduce a un mensaje. */
async function expectHint(promise: Promise<unknown>, hint: string) {
  await expect(promise).rejects.toMatchObject({ hint });
}


/** Línea de borrador con los importes calculados por el dominio (como hace el servidor). */
function line(
  description: string,
  quantity: string,
  unitPriceCents: number,
  opts: {
    irpfBps?: number;
    billingType?: "one_off" | "monthly" | "yearly" | "usage";
    billableItemId?: string;
    contractLineId?: string;
    periodStart?: string;
    periodEnd?: string;
  } = {},
) {
  const irpfBps = opts.irpfBps ?? 0;
  const amounts = computeLine({
    quantity,
    unitPriceCents,
    discountBps: 0,
    vatBps: 2100,
    irpfBps,
    irpfApplies: irpfBps > 0,
  });
  return {
    id: randomUUID(),
    description,
    quantity,
    unit_price_cents: unitPriceCents,
    discount_bps: 0,
    base_cents: amounts.baseCents,
    tax_rate_id: ids.vat21,
    vat_bps: 2100,
    vat_regime: "general",
    vat_cents: amounts.vatCents,
    irpf_applies: irpfBps > 0,
    irpf_cents: amounts.irpfCents,
    billing_type: opts.billingType ?? "one_off",
    period_start: opts.periodStart ?? null,
    period_end: opts.periodEnd ?? null,
    contract_line_id: opts.contractLineId ?? null,
    billable_item_id: opts.billableItemId ?? null,
  };
}

async function saveDraft(payload: Record<string, unknown>, user = owner): Promise<string> {
  return as(db, user, async () =>
    (await one<{ id: string }>("select public.save_invoice_draft($1::jsonb) as id", [JSON.stringify(payload)])).id,
  );
}

/** Borrador del autónomo (IRPF 15 %) con el ejemplo de ARCHITECTURE §7.1. */
async function exampleDraft(extra: Record<string, unknown> = {}): Promise<string> {
  return saveDraft({
    header: { issuer_id: ids.freelancer, client_id: clientId, irpf_bps: 1500, language: "es", payment_terms_days: 30 },
    lines: [line("Mantenimiento web", "1", 15_000, { irpfBps: 1500 }), line("Campaña Meta Ads", "2", 37_500, { irpfBps: 1500 })],
    ...extra,
  });
}

async function issue(invoiceId: string, issuedOn: string | null = null, user = owner) {
  return as(db, user, async () => {
    const begun = await one<{ r: { number: string | null; lifecycle: string } }>(
      "select public.issue_invoice_begin($1, $2::date) as r",
      [invoiceId, issuedOn],
    );
    await db.query("select public.issue_invoice_complete($1, $2::jsonb)", [
      invoiceId,
      JSON.stringify({ pdf_path: `${orgId}/${invoiceId}.pdf` }),
    ]);
    return begun.r;
  });
}

async function invoiceStatus(invoiceId: string) {
  return asOwner<{ status: string; outstanding_cents: number; net_total_cents: number }>(
    "select status, outstanding_cents, net_total_cents from public.invoices_overview where id = $1",
    [invoiceId],
  );
}

async function createContract(payload: Record<string, unknown>): Promise<string> {
  return as(db, owner, async () =>
    (await one<{ id: string }>("select public.create_contract($1::jsonb) as id", [JSON.stringify(payload)])).id,
  );
}

beforeEach(async () => {
  db = await createDb();
  owner = await createUser(db, "owner@example.com");
  orgId = await createOrg(db, owner);
  const issuers = await db.query<{ id: string; kind: string }>("select id, kind from public.issuers where org_id = $1", [orgId]);
  const freelancer = issuers.rows.find((r) => r.kind === "self_employed")!.id;
  const company = issuers.rows.find((r) => r.kind === "company")!.id;
  // El onboarding de prueba no trae dirección: sin ella no se puede emitir.
  await db.query(
    "update public.issuers set address_line = 'Carrer Major 1', postal_code = '08301', city = 'Mataró' where org_id = $1",
    [orgId],
  );
  const seriesF = (await one<{ id: string }>("select id from public.invoice_series where issuer_id = $1 and code = 'F'", [freelancer])).id;
  const rates = await db.query<{ id: string; name: string }>("select id, name from public.tax_rates where org_id = $1", [orgId]);
  ids = {
    freelancer,
    company,
    seriesF,
    vat21: rates.rows.find((r) => r.name === "IVA 21 %")!.id,
    exempt: rates.rows.find((r) => r.name === "Exento")!.id,
  };
  clientId = (
    await asOwner<{ id: string }>(
      `insert into public.clients (org_id, display_name, legal_name, tax_id, address_line, postal_code, city)
       values ($1, 'Restaurant del Port', 'Port Mataró SL', 'B12345674', 'Passeig Marítim 3', '08301', 'Mataró') returning id`,
      [orgId],
    )
  ).id;
});

describe("numeración sin huecos", () => {
  it("la gemela SQL formatea igual que el dominio", async () => {
    const cases: [string, number, number][] = [
      ["{yyyy}-{n:4}", 2026, 38],
      ["R{yyyy}-{n:4}", 2027, 1],
      ["F{yy}/{n}", 2026, 12_345],
      ["{n:3}-{yyyy}", 2030, 7],
      ["A-{n:2}", 2026, 1234],
      ["{yyyy}{yy}-{n:9}", 2099, 5],
    ];
    for (const [format, year, sequence] of cases) {
      const { n } = await one<{ n: string }>("select private.format_invoice_number($1, $2, $3) as n", [format, year, sequence]);
      expect(n, format).toBe(formatInvoiceNumber(format, year, sequence));
    }
  });

  it("continúa desde el último número importado y asigna el número al emitir, no antes", async () => {
    const draft = await exampleDraft();
    const preview = await asOwner<{ n: string }>("select public.invoice_next_number($1) as n", [draft]);
    const year = new Date().getUTCFullYear();
    expect(preview.n).toBe(`${year}-0038`);
    expect((await one<{ number: string | null }>("select number from public.invoices where id = $1", [draft])).number).toBeNull();

    const issued = await issue(draft);
    expect(issued.number).toBe(`${year}-0038`);
    const second = await issue(await exampleDraft());
    expect(second.number).toBe(`${year}-0039`);
  });

  it("si la emisión falla después de reservar el número, no queda hueco", async () => {
    const year = new Date().getUTCFullYear();
    expect((await issue(await exampleDraft())).number).toBe(`${year}-0038`);
    // Fecha anterior a la última de la serie: falla después del UPSERT del contador.
    const bad = await exampleDraft();
    await expectHint(issue(bad, daysFromToday(-1)), "date_before_previous");
    // También si se deshace una transacción entera que ya había emitido.
    await db.exec("begin");
    await issue(await exampleDraft());
    await db.exec("rollback");
    expect((await issue(bad)).number).toBe(`${year}-0039`);
  });

  it("emitir dos veces la misma factura devuelve el mismo número (idempotente)", async () => {
    const draft = await exampleDraft();
    const first = await issue(draft);
    const again = await as(db, owner, () =>
      one<{ r: { number: string; lifecycle: string } }>("select public.issue_invoice_begin($1) as r", [draft]),
    );
    expect(again.r).toMatchObject({ number: first.number, lifecycle: "issued" });
  });

  it("una serie con facturas emitidas ese año ya no deja fijar su último número", async () => {
    await issue(await exampleDraft());
    const year = new Date().getUTCFullYear();
    await expectHint(
      as(db, owner, () => db.query("select public.set_series_last_number($1, $2, 100)", [ids.seriesF, year])),
      "series_in_use",
    );
  });
});

describe("validaciones al emitir", () => {
  it("la base rechaza importes manipulados aunque el total de cabecera coincida", async () => {
    const draft = await exampleDraft();
    const target = (await one<{ id: string }>("select id from public.invoice_lines where invoice_id = $1 order by position limit 1", [draft])).id;
    const original = await one<{ base_cents: number; vat_cents: number; irpf_cents: number }>("select base_cents, vat_cents, irpf_cents from public.invoice_lines where id = $1", [target]);
    await db.query("update public.invoice_lines set base_cents = base_cents + 1 where id = $1", [target]);
    await db.query("update public.invoices set subtotal_cents = subtotal_cents + 1, total_cents = total_cents + 1 where id = $1", [draft]);
    await expectHint(as(db, owner, () => one("select public.issue_invoice_begin($1)", [draft])), "totals_mismatch");
    await db.query("update public.invoice_lines set base_cents = $2, vat_cents = $3, irpf_cents = $4 where id = $1", [target, original.base_cents, original.vat_cents, original.irpf_cents]);
  });

  it("la RPC de completar solo admite el PDF canónico de la factura", async () => {
    const draft = await exampleDraft();
    await as(db, owner, () => db.query("select public.issue_invoice_begin($1, $2::date)", [draft, daysFromToday(0)]));
    await expect(
      as(db, owner, () => db.query("select public.issue_invoice_complete($1, $2::jsonb)", [draft, JSON.stringify({ pdf_path: `otro-org/${draft}.pdf` })])),
    ).rejects.toMatchObject({ hint: "invoice_pdf_path_invalid" });
    await as(db, owner, () => db.query("select public.issue_invoice_complete($1, $2::jsonb)", [draft, JSON.stringify({ pdf_path: `${orgId}/${draft}.pdf` })]));
  });

  it("congela emisor y cliente, fija el vencimiento y cuadra los totales del ejemplo", async () => {
    const draft = await exampleDraft();
    const header = await one<{ subtotal_cents: number; vat_cents: number; irpf_cents: number; total_cents: number }>(
      "select subtotal_cents, vat_cents, irpf_cents, total_cents from public.invoices where id = $1",
      [draft],
    );
    expect(header).toEqual({ subtotal_cents: 90_000, vat_cents: 18_900, irpf_cents: 13_500, total_cents: 95_400 });

    await issue(draft);
    await db.query("update public.clients set address_line = 'Nueva dirección 9' where id = $1", [clientId]);
    const inv = await one<{ client_snapshot: { address_line: string; legal_name: string }; due_on: Date; issued_on: Date }>(
      "select client_snapshot, due_on, issued_on from public.invoices where id = $1",
      [draft],
    );
    expect(inv.client_snapshot).toMatchObject({ address_line: "Passeig Marítim 3", legal_name: "Port Mataró SL" });
    expect((inv.due_on.getTime() - inv.issued_on.getTime()) / 86_400_000).toBe(30);
  });

  it("bloquea fechas futuras, datos fiscales incompletos y emisores sin constituir", async () => {
    await expectHint(issue(await exampleDraft(), daysFromToday(1)), "future_date");

    await db.query("update public.clients set tax_id = null where id = $1", [clientId]);
    await expect(issue(await exampleDraft())).rejects.toMatchObject({ hint: "fiscal_data_missing", detail: "client.tax_id" });
    await db.query("update public.clients set tax_id = 'B12345674' where id = $1", [clientId]);

    // La SL del onboarding de prueba no tiene fecha de alta: aún no existe.
    const slDraft = await saveDraft({
      header: { issuer_id: ids.company, client_id: clientId },
      lines: [line("Web", "1", 100_000)],
    });
    await expectHint(issue(slDraft), "issuer_inactive");
  });

  it("desde su fecha Verifactu, un emisor con el proveedor interno no puede emitir", async () => {
    await db.query("update public.issuers set verifactu_from = $2 where id = $1", [ids.freelancer, daysFromToday(-1)]);
    await expectHint(issue(await exampleDraft()), "verifactu_required");
  });

  it("una factura sin líneas no se emite", async () => {
    const empty = await saveDraft({ header: { issuer_id: ids.freelancer, client_id: clientId }, lines: [] });
    await expectHint(issue(empty), "no_lines");
  });
});

describe("inmutabilidad", () => {
  it("nadie modifica ni borra una factura emitida ni sus líneas, tampoco service_role", async () => {
    const draft = await exampleDraft();
    await issue(draft);
    // Como el propietario de las tablas (sin RLS) y como service_role.
    for (const role of [null, "service_role"]) {
      if (role) await db.exec(`set role ${role}`);
      try {
        await expectHint(db.query("update public.invoices set notes = 'cambio' where id = $1", [draft]), "invoice_immutable");
        await expectHint(db.query("delete from public.invoices where id = $1", [draft]), "invoice_immutable");
        await expectHint(
          db.query("update public.invoice_lines set unit_price_cents = 1 where invoice_id = $1", [draft]),
          "invoice_immutable",
        );
        await expectHint(db.query("delete from public.invoice_lines where invoice_id = $1", [draft]), "invoice_immutable");
      } finally {
        await db.exec("reset role");
      }
    }
  });

  it("un socio no escribe facturas directamente: solo con las RPC", async () => {
    await expect(
      asOwner("insert into public.invoices (org_id, issuer_id, client_id) values ($1, $2, $3)", [orgId, ids.freelancer, clientId]),
    ).rejects.toThrow(/permission denied/);
    const draft = await exampleDraft();
    await expect(asOwner("update public.invoices set lifecycle = 'issued' where id = $1", [draft])).rejects.toThrow(
      /permission denied/,
    );
    // Borrar un borrador sí.
    await as(db, owner, () => db.query("delete from public.invoices where id = $1", [draft]));
    expect((await db.query("select 1 from public.invoices where id = $1", [draft])).rows).toHaveLength(0);
  });
});

describe("rectificativas y cobros", () => {
  it("anular es emitir una rectificativa total en su serie; la original queda anulada", async () => {
    const original = await exampleDraft();
    await issue(original);

    await expectHint(
      as(db, owner, () => db.query("select public.create_rectification($1, 'Error en el precio')", [original])),
      "rectifying_series_missing",
    );
    await asOwner(
      "insert into public.invoice_series (org_id, issuer_id, code, name, kind, format, is_default) values ($1, $2, 'R', 'Rectificativas', 'rectifying', 'R{yyyy}-{n:4}', true)",
      [orgId, ids.freelancer],
    );
    const rect = (
      await asOwner<{ id: string }>("select public.create_rectification($1, 'Error en el precio') as id", [original])
    ).id;
    const totals = await one<{ total_cents: number; lines: number }>(
      "select total_cents, (select count(*)::int from public.invoice_lines where invoice_id = $1) as lines from public.invoices where id = $1",
      [rect],
    );
    expect(totals).toEqual({ total_cents: -95_400, lines: 2 });

    const issued = await issue(rect);
    expect(issued.number).toBe(`R${new Date().getUTCFullYear()}-0001`);
    expect((await invoiceStatus(original)).status).toBe("voided");
    // Una segunda rectificativa total ya no tiene sentido.
    await expectHint(
      as(db, owner, () => db.query("select public.create_rectification($1, 'Otra vez')", [original])),
      "already_rectified",
    );
  });

  it("los cobros solo van a facturas emitidas; parcial = pendiente, total = cobrada; vencida por fecha", async () => {
    const draft = await exampleDraft();
    await expectHint(
      asOwner("insert into public.payments (org_id, invoice_id, amount_cents, paid_on) values ($1, $2, 1000, current_date)", [
        orgId,
        draft,
      ]),
      "payment_not_issued",
    );
    // Emitida hace 40 días a 30 días: vencida.
    await issue(draft, daysFromToday(-40));
    expect((await invoiceStatus(draft)).status).toBe("overdue");
    await asOwner("insert into public.payments (org_id, invoice_id, amount_cents, paid_on) values ($1, $2, 50000, current_date)", [
      orgId,
      draft,
    ]);
    expect(await invoiceStatus(draft)).toMatchObject({ status: "overdue", outstanding_cents: 45_400 });
    await asOwner("insert into public.payments (org_id, invoice_id, amount_cents, paid_on) values ($1, $2, 45400, current_date)", [
      orgId,
      draft,
    ]);
    expect(await invoiceStatus(draft)).toMatchObject({ status: "paid", outstanding_cents: 0 });
  });
});

describe("contratos y pendiente de facturar", () => {
  async function monthlyContract(startsOn = daysFromToday(-40)) {
    const contract = await createContract({
      client_id: clientId,
      issuer_id: ids.freelancer,
      title: "Mantenimiento",
      signed_on: startsOn,
      lines: [
        {
          description: "Mantenimiento web",
          billing_type: "monthly",
          unit_price_cents: 15_000,
          tax_rate_id: ids.vat21,
          starts_on: startsOn,
          billing_day: 1,
        },
      ],
    });
    const lineId = (await one<{ id: string }>("select id from public.contract_lines where contract_id = $1", [contract])).id;
    return { contract, lineId };
  }

  /** Lo que haría el cron para un periodo: el pendiente y un borrador que lo contiene. */
  function runPayload(lineId: string, periodStart: string, periodEnd: string, itemId = randomUUID()) {
    return {
      org_id: orgId,
      items: [
        {
          id: itemId,
          contract_line_id: lineId,
          source: "recurring",
          period_start: periodStart,
          period_end: periodEnd,
          description: "Mantenimiento web",
          quantity: "1",
          unit_price_cents: 15_000,
          amount_cents: 15_000,
          billable_on: periodStart,
        },
      ],
      drafts: [
        {
          grouping_key: "client",
          header: { issuer_id: ids.freelancer, client_id: clientId, irpf_bps: 1500 },
          lines: [
            line("Mantenimiento web", "1", 15_000, {
              irpfBps: 1500,
              billingType: "monthly",
              billableItemId: itemId,
              contractLineId: lineId,
              periodStart,
              periodEnd,
            }),
          ],
        },
      ],
    };
  }

  async function applyRun(payload: unknown) {
    await db.exec("set role service_role");
    try {
      return (await one<{ r: Record<string, unknown> }>("select public.apply_billing_run($1::jsonb) as r", [JSON.stringify(payload)])).r;
    } finally {
      await db.exec("reset role");
    }
  }

  it("los hitos tienen que sumar el 100 %", async () => {
    await expectHint(
      createContract({
        client_id: clientId,
        issuer_id: ids.freelancer,
        title: "Web",
        lines: [{ description: "Web", billing_type: "one_off", unit_price_cents: 300_000, tax_rate_id: ids.vat21 }],
        milestones: [
          { label: "Firma", percent_bps: 5000 },
          { label: "Entrega", percent_bps: 4000 },
        ],
      }),
      "milestones_total",
    );
  });

  it("con los hitos ya facturados no entra trabajo puntual nuevo, ni creándolo ni cambiando el tipo", async () => {
    const contract = await createContract({
      client_id: clientId,
      issuer_id: ids.freelancer,
      title: "Web + mantenimiento",
      signed_on: daysFromToday(-10),
      lines: [
        { description: "Web", billing_type: "one_off", unit_price_cents: 300_000, tax_rate_id: ids.vat21 },
        { description: "Mantenimiento", billing_type: "monthly", unit_price_cents: 9_000, tax_rate_id: ids.vat21, starts_on: daysFromToday(-10), billing_day: 1 },
      ],
      milestones: [{ label: "A la firma", percent_bps: 10000 }],
    });
    const web = (await one<{ id: string }>("select id from public.contract_lines where contract_id = $1 and billing_type = 'one_off'", [contract])).id;
    const monthly = (await one<{ id: string }>("select id from public.contract_lines where contract_id = $1 and billing_type = 'monthly'", [contract])).id;
    const milestone = (await one<{ id: string }>("select id from public.contract_milestones where contract_id = $1", [contract])).id;
    const itemId = randomUUID();
    await saveDraft({
      header: { issuer_id: ids.freelancer, client_id: clientId, irpf_bps: 1500 },
      new_items: [
        { id: itemId, contract_line_id: web, source: "milestone", milestone_id: milestone, description: "Web · A la firma", quantity: "1", unit_price_cents: 300_000, amount_cents: 300_000, billable_on: daysFromToday(0) },
      ],
      lines: [line("Web · A la firma", "1", 300_000, { irpfBps: 1500, billableItemId: itemId, contractLineId: web })],
    });
    await expectHint(
      asOwner("insert into public.contract_lines (org_id, contract_id, description, billing_type, unit_price_cents, tax_rate_id) values ($1, $2, 'Extra', 'one_off', 50000, $3)", [orgId, contract, ids.vat21]),
      "milestones_started",
    );
    await expectHint(
      asOwner("update public.contract_lines set billing_type = 'one_off', billing_day = null, starts_on = null where id = $1", [monthly]),
      "milestones_started",
    );
  });

  it("el cron es atómico e idempotente: repetir con datos viejos no duplica nada", async () => {
    const { lineId } = await monthlyContract();
    const summary = await applyRun(runPayload(lineId, "2026-09-01", "2026-09-30"));
    expect(summary).toMatchObject({ items_created: 1 });
    // Una segunda ejecución calculada sobre datos viejos choca con el borrador ya abierto y no aplica nada.
    await expectHint(applyRun(runPayload(lineId, "2026-09-01", "2026-09-30")), "draft_changed");
    // Y si ese borrador ya no existe, choca con el periodo ya creado.
    const draft = (await one<{ id: string }>("select id from public.invoices")).id;
    await issue(draft);
    await expectHint(applyRun(runPayload(lineId, "2026-09-01", "2026-09-30")), "item_taken");
    const counts = await one<{ items: number; drafts: number; lines: number }>(
      `select (select count(*)::int from public.billable_items) as items,
              (select count(*)::int from public.invoices) as drafts,
              (select count(*)::int from public.invoice_lines) as lines`,
    );
    expect(counts).toEqual({ items: 1, drafts: 1, lines: 1 });
  });

  it("un socio no puede ejecutar el cron", async () => {
    const { lineId } = await monthlyContract();
    await expect(
      as(db, owner, () => db.query("select public.apply_billing_run($1::jsonb)", [JSON.stringify(runPayload(lineId, "2026-09-01", "2026-09-30"))])),
    ).rejects.toThrow(/permission denied/);
  });

  it("cambiar el precio saca el periodo del borrador; ya emitido, exige una versión nueva", async () => {
    const { lineId } = await monthlyContract();
    await applyRun(runPayload(lineId, "2026-09-01", "2026-09-30"));
    const draft = (await one<{ id: string }>("select id from public.invoices")).id;

    await asOwner("update public.contract_lines set unit_price_cents = 16000 where id = $1", [lineId]);
    const after = await one<{ lines: number; items: number; total: number }>(
      `select (select count(*)::int from public.invoice_lines) as lines,
              (select count(*)::int from public.billable_items) as items,
              (select total_cents from public.invoices where id = $1) as total`,
      [draft],
    );
    expect(after).toEqual({ lines: 0, items: 0, total: 0 });

    const rerun = runPayload(lineId, "2026-09-01", "2026-09-30");
    await applyRun({ ...rerun, drafts: [{ ...rerun.drafts[0], invoice_id: draft }] });
    await issue(draft);
    await expectHint(asOwner("update public.contract_lines set unit_price_cents = 17000 where id = $1", [lineId]), "line_billed");

    // La versión nueva no puede empezar dentro de lo ya facturado.
    await expectHint(
      asOwner("select public.new_line_version($1, '2026-09-15', '{\"unit_price_cents\": 17000}'::jsonb)", [lineId]),
      "version_date_invalid",
    );
    const v2 = await asOwner<{ id: string }>(
      "select public.new_line_version($1, '2026-10-01', '{\"unit_price_cents\": 17000}'::jsonb) as id",
      [lineId],
    );
    const lines = await db.query<{ id: string; ends_on: Date | null; unit_price_cents: number; replaces_line_id: string | null }>(
      "select id, ends_on, unit_price_cents, replaces_line_id from public.contract_lines order by created_at, unit_price_cents",
    );
    expect(lines.rows.map((l) => [l.unit_price_cents, l.ends_on?.toISOString().slice(0, 10) ?? null, l.replaces_line_id])).toEqual([
      [16_000, "2026-09-30", null],
      [17_000, null, lineId],
    ]);
    expect(lines.rows[1]!.id).toBe(v2.id);
  });

  it("tras anular una factura, sus periodos vuelven a pendiente para refacturarlos", async () => {
    const { lineId } = await monthlyContract();
    await applyRun(runPayload(lineId, "2026-09-01", "2026-09-30"));
    const invoice = (await one<{ id: string }>("select id from public.invoices")).id;
    await issue(invoice);
    await expectHint(asOwner("select public.release_invoice_items($1, false)", [invoice]), "invoice_not_voided");

    await asOwner(
      "insert into public.invoice_series (org_id, issuer_id, code, name, kind, format, is_default) values ($1, $2, 'R', 'Rectificativas', 'rectifying', 'R{yyyy}-{n:4}', true)",
      [orgId, ids.freelancer],
    );
    const rect = (await asOwner<{ id: string }>("select public.create_rectification($1, 'Baja') as id", [invoice])).id;
    await issue(rect);
    expect((await asOwner<{ n: number }>("select public.release_invoice_items($1, false) as n", [invoice])).n).toBe(1);
    const state = await asOwner<{ state: string }>("select state from public.billable_items_overview");
    expect(state.state).toBe("pending");
  });

  it("el estado del cliente sigue a sus líneas: activo, pausado y ex-cliente", async () => {
    const status = async () => (await asOwner<{ status: string }>("select status from public.clients_overview where id = $1", [clientId])).status;
    expect(await status()).toBe("lead");
    const { lineId } = await monthlyContract();
    expect(await status()).toBe("active");
    await asOwner("insert into public.contract_line_pauses (org_id, line_id, starts_on) values ($1, $2, $3)", [
      orgId,
      lineId,
      daysFromToday(-5),
    ]);
    expect(await status()).toBe("paused");
    await asOwner("delete from public.contract_line_pauses where line_id = $1", [lineId]);
    await asOwner("update public.contract_lines set ends_on = $2, cancelled_on = $2 where id = $1", [lineId, daysFromToday(-1)]);
    expect(await status()).toBe("former");
  });
});

describe("RLS de facturación", () => {
  it("un viewer lee pero no factura; otra org no ve nada", async () => {
    const draft = await exampleDraft();
    await issue(draft);
    const viewer = await createUser(db, "viewer@example.com");
    await db.query(
      "insert into public.members (org_id, user_id, role, full_name, initials) values ($1, $2, 'viewer', 'Visor', 'VI')",
      [orgId, viewer],
    );
    await as(db, viewer, async () => {
      expect((await db.query("select * from public.invoices_overview")).rows).toHaveLength(1);
    });
    await expect(
      saveDraft({ header: { issuer_id: ids.freelancer, client_id: clientId }, lines: [] }, viewer),
    ).rejects.toThrow(/Sin permiso/);
    await expect(issue(await exampleDraft(), null, viewer)).rejects.toThrow(/Sin permiso/);

    const outsider = await createUser(db, "fuera@example.com");
    await as(db, outsider, async () => {
      for (const view of ["invoices", "invoice_lines", "invoices_overview", "contracts_overview", "billable_items_overview", "payments"]) {
        expect((await db.query(`select * from public.${view}`)).rows, view).toHaveLength(0);
      }
    });
  });
});
