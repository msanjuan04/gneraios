import { createHash, randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { addDays } from "@/domain/dates/civil-date";
import { lineBaseCents } from "@/domain/metrics/mrr";
import { as, createDb, createOrg, createUser, type Db, onboardingPayload } from "./harness";

let db: Db;
let owner: string;
let orgId: string;
let today: string;
let ids: { freelancer: string; vat21: string; irpf15: string };
let clientId: string;
let dealId: string;
let stages: Record<string, string>;

type BillingType = "one_off" | "monthly" | "yearly" | "usage";
type PlanItem = { label: string; percent_bps: number; when: "on_accept" | "on_delivery" | "date"; planned_on?: string | null };

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0]!;
}

async function all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

async function asOwner<T>(sql: string, params: unknown[] = []): Promise<T> {
  return as(db, owner, () => one<T>(sql, params));
}

/** Rechaza con el hint de Postgres que la app traduce a un mensaje. */
async function expectHint(promise: Promise<unknown>, hint: string) {
  await expect(promise).rejects.toMatchObject({ hint });
}

/** Línea con su base calculada por el dominio, como hace el servidor al guardar. */
function line(
  description: string,
  billingType: BillingType,
  unitPriceCents: number,
  opts: { quantity?: string; discountBps?: number; startsOn?: string | null; endsOn?: string | null; billingDay?: number | null } = {},
) {
  const quantity = opts.quantity ?? "1";
  const discountBps = opts.discountBps ?? 0;
  return {
    id: randomUUID(),
    description,
    billing_type: billingType,
    quantity,
    unit_price_cents: unitPriceCents,
    discount_bps: discountBps,
    tax_rate_id: ids.vat21,
    irpf_applies: true,
    starts_on: opts.startsOn ?? null,
    ends_on: opts.endsOn ?? null,
    billing_day: opts.billingDay ?? null,
    prorate_first: true,
    base_cents: lineBaseCents({ quantity, unitPriceCents, discountBps }),
  };
}

const HALF: PlanItem[] = [
  { label: "Inicio del proyecto", percent_bps: 5000, when: "on_accept" },
  { label: "Entrega final", percent_bps: 5000, when: "on_delivery" },
];

function header(extra: Record<string, unknown> = {}) {
  return {
    client_id: clientId,
    deal_id: dealId,
    issuer_id: ids.freelancer,
    title: "Web corporativa y mantenimiento",
    language: "es",
    notes: null,
    payment_plan: HALF,
    ...extra,
  };
}

async function saveQuote(payload: Record<string, unknown> & { lines?: unknown[] }, user = owner): Promise<string> {
  // Como el servidor: cada línea con su posición en la lista.
  const lines = (payload.lines ?? []).map((l, position) => ({ position, ...(l as object) }));
  return as(db, user, async () =>
    (await one<{ id: string }>("select public.save_quote($1::jsonb) as id", [JSON.stringify({ ...payload, lines })])).id,
  );
}

/** Web (one-off), mantenimiento (mensual), hosting (anual) y campañas (por uso), con 50/50. */
async function exampleQuote(extra: { header?: Record<string, unknown>; lines?: unknown[] } = {}): Promise<string> {
  return saveQuote({
    header: header(extra.header),
    lines: extra.lines ?? [
      line("Web corporativa", "one_off", 300_000),
      line("Mantenimiento web", "monthly", 15_000),
      line("Hosting y dominio", "yearly", 24_000),
      line("Campaña Meta Ads", "usage", 37_500),
    ],
  });
}

async function finalize(quoteId: string, user = owner) {
  return as(db, user, async () =>
    (await one<{ r: { number: string; status: string; issued_on: string; valid_until: string } }>(
      "select public.finalize_quote($1) as r",
      [quoteId],
    )).r,
  );
}

async function accept(quoteId: string, user = owner): Promise<string> {
  return as(db, user, async () => (await one<{ id: string }>("select public.accept_quote($1) as id", [quoteId])).id);
}

async function quoteRow(quoteId: string) {
  return one<{ status: string; number: string | null; contract_id: string | null; accepted_at: Date | null }>(
    "select status, number, contract_id, accepted_at from public.quotes where id = $1",
    [quoteId],
  );
}

async function dealStage(): Promise<string> {
  return (await one<{ name: string }>("select s.name from public.deals d join public.pipeline_stages s on s.id = d.stage_id where d.id = $1", [dealId])).name;
}

async function counts() {
  return one<{ contracts: number; lines: number; milestones: number; issuers: number }>(
    `select (select count(*)::int from public.contracts) as contracts,
            (select count(*)::int from public.contract_lines) as lines,
            (select count(*)::int from public.contract_milestones) as milestones,
            (select count(*)::int from public.contract_issuers) as issuers`,
  );
}

beforeEach(async () => {
  db = await createDb();
  owner = await createUser(db, "owner@example.com");
  orgId = await createOrg(db, owner);
  today = (await one<{ d: string }>("select private.org_today($1)::text as d", [orgId])).d;
  const freelancer = (await one<{ id: string }>("select id from public.issuers where org_id = $1 and kind = 'self_employed'", [orgId])).id;
  const rates = await all<{ id: string; name: string }>("select id, name from public.tax_rates where org_id = $1", [orgId]);
  ids = {
    freelancer,
    vat21: rates.find((r) => r.name === "IVA 21 %")!.id,
    irpf15: rates.find((r) => r.name === "IRPF 15 %")!.id,
  };
  stages = Object.fromEntries(
    (await all<{ id: string; name: string }>("select id, name from public.pipeline_stages where org_id = $1", [orgId])).map((s) => [s.name, s.id]),
  );
  clientId = (
    await asOwner<{ id: string }>(
      `insert into public.clients (org_id, display_name, legal_name, tax_id, address_line, postal_code, city)
       values ($1, 'Restaurant del Port', 'Port Mataró SL', 'B12345674', 'Passeig Marítim 3', '08301', 'Mataró') returning id`,
      [orgId],
    )
  ).id;
  dealId = (
    await asOwner<{ id: string }>(
      "insert into public.deals (org_id, client_id, title, stage_id, est_one_off_cents, est_mrr_cents) values ($1, $2, 'Web nueva', $3, 300000, 15000) returning id",
      [orgId, clientId, stages["Propuesta enviada"]],
    )
  ).id;
});

describe("guardar y listar", () => {
  it("guarda cabecera y líneas; el listado suma las bases por tipo, sin mezclar", async () => {
    const quote = await exampleQuote({
      lines: [
        line("Web corporativa", "one_off", 300_000),
        line("Fotografía", "one_off", 45_000, { quantity: "2", discountBps: 1000 }),
        line("Mantenimiento web", "monthly", 15_000),
        line("SEO local", "monthly", 20_000),
        line("Hosting y dominio", "yearly", 24_000),
        line("Campaña Meta Ads", "usage", 37_500),
      ],
    });
    const overview = await asOwner<Record<string, unknown>>(
      "select state, number, lines_count, one_off_cents, monthly_cents, yearly_cents, usage_lines_count, client_name, deal_title from public.quotes_overview where id = $1",
      [quote],
    );
    expect(overview).toEqual({
      state: "draft",
      number: null,
      lines_count: 6,
      // 3.000 + 2 × 450 − 10 %
      one_off_cents: 381_000,
      monthly_cents: 35_000,
      yearly_cents: 24_000,
      usage_lines_count: 1,
      client_name: "Restaurant del Port",
      deal_title: "Web nueva",
    });
  });

  it("guardar es un conjunto completo: lo que no viene se borra y lo que viene se actualiza", async () => {
    const web = line("Web corporativa", "one_off", 300_000);
    const quote = await saveQuote({ header: header(), lines: [web, line("Mantenimiento", "monthly", 15_000)] });
    const { updated_at } = await one<{ updated_at: string }>("select updated_at::text from public.quotes where id = $1", [quote]);
    await saveQuote({
      quote_id: quote,
      expected_updated_at: updated_at,
      header: header({ title: "Web corporativa" }),
      lines: [{ ...web, unit_price_cents: 320_000, base_cents: 320_000 }],
    });
    const lines = await all<{ id: string; base_cents: number }>("select id, base_cents from public.quote_lines where quote_id = $1", [quote]);
    expect(lines).toEqual([{ id: web.id, base_cents: 320_000 }]);
    // Con la versión vieja, alguien ha guardado entre medias.
    await expectHint(saveQuote({ quote_id: quote, expected_updated_at: updated_at, header: header(), lines: [] }), "quote_changed");
  });

  it("el plan de pagos es obligatorio con líneas puntuales y suma exactamente el 100 %", async () => {
    const web = () => [line("Web", "one_off", 100_000)];
    await expectHint(saveQuote({ header: header({ payment_plan: [] }), lines: web() }), "payment_plan_required");
    await expectHint(
      saveQuote({
        header: header({ payment_plan: [{ label: "Inicio", percent_bps: 5000, when: "on_accept" }, { label: "Fin", percent_bps: 4000, when: "on_delivery" }] }),
        lines: web(),
      }),
      "payment_plan_total",
    );
    await expectHint(
      saveQuote({
        header: header({ payment_plan: [{ label: "Fin", percent_bps: 5000, when: "on_delivery" }, { label: "Inicio", percent_bps: 5000, when: "on_accept" }] }),
        lines: web(),
      }),
      "payment_plan_order",
    );
    await expectHint(
      saveQuote({ header: header({ payment_plan: [{ label: "Pago", percent_bps: 10_000, when: "date" }] }), lines: web() }),
      "payment_plan_invalid",
    );
    await expectHint(
      saveQuote({ header: header({ payment_plan: [{ label: "Pago", percent_bps: 10_000, when: "date", planned_on: "2026-02-30" }] }), lines: web() }),
      "payment_plan_invalid",
    );
    // Sin nada puntual, el plan no hace falta.
    const recurring = await saveQuote({ header: header({ payment_plan: [] }), lines: [line("Mantenimiento", "monthly", 15_000)] });
    expect((await quoteRow(recurring)).status).toBe("draft");
  });

  it("no admite fechas futuras, un deal de otro cliente ni un impuesto que no sea IVA", async () => {
    await expectHint(exampleQuote({ header: { issued_on: addDays(today, 1) } }), "quote_future_date");
    const other = (
      await asOwner<{ id: string }>("insert into public.clients (org_id, display_name) values ($1, 'Otro') returning id", [orgId])
    ).id;
    await expect(exampleQuote({ header: { client_id: other } })).rejects.toMatchObject({ code: "23503" });
    await expectHint(
      saveQuote({ header: header(), lines: [{ ...line("Web", "one_off", 100_000), tax_rate_id: ids.irpf15 }] }),
      "vat_rate_required",
    );
  });
});

describe("numeración", () => {
  it("numera al enviar, correlativo por org y año; reenviar no cambia el número", async () => {
    const year = today.slice(0, 4);
    const first = await exampleQuote();
    expect((await quoteRow(first)).number).toBeNull();
    const sent = await finalize(first);
    expect(sent).toMatchObject({ number: `P${year}-0001`, status: "sent", issued_on: today });
    // Validez por defecto de la org: 30 días.
    expect(sent.valid_until).toBe(addDays(today, 30));
    expect((await finalize(first)).number).toBe(`P${year}-0001`);
    expect((await finalize(await exampleQuote())).number).toBe(`P${year}-0002`);

    // Otra org tiene su propio contador.
    const other = await createUser(db, "otra@example.com");
    const otherOrg = await createOrg(db, other, onboardingPayload({ org: { name: "Otra", slug: "otra" }, invitations: [] }));
    const otherClient = (
      await as(db, other, () => one<{ id: string }>("insert into public.clients (org_id, display_name) values ($1, 'Cliente') returning id", [otherOrg]))
    ).id;
    const otherIssuer = (await one<{ id: string }>("select id from public.issuers where org_id = $1 and kind = 'self_employed'", [otherOrg])).id;
    const otherVat = (await one<{ id: string }>("select id from public.tax_rates where org_id = $1 and name = 'IVA 21 %'", [otherOrg])).id;
    const otherQuote = await saveQuote(
      {
        header: { client_id: otherClient, issuer_id: otherIssuer, title: "Web", language: "es", payment_plan: [] },
        lines: [{ ...line("Mantenimiento", "monthly", 15_000), tax_rate_id: otherVat }],
      },
      other,
    );
    expect((await finalize(otherQuote, other)).number).toBe(`P${year}-0001`);
  });

  it("sin líneas, o con la validez ya pasada, no se envía ni gasta número", async () => {
    const year = today.slice(0, 4);
    const empty = await saveQuote({ header: header({ payment_plan: [] }), lines: [] });
    await expectHint(finalize(empty), "quote_no_lines");
    const late = await exampleQuote({ header: { valid_until: addDays(today, -1), issued_on: addDays(today, -10) } });
    await expectHint(finalize(late), "quote_validity_past");
    expect((await finalize(await exampleQuote())).number).toBe(`P${year}-0001`);
  });
});

describe("aceptar en un clic", () => {
  it("crea el contrato con emisor, líneas e hitos, enlaza el presupuesto y gana el deal", async () => {
    const planned = addDays(today, 45);
    const quote = await exampleQuote({
      header: {
        payment_plan: [
          { label: "Inicio del proyecto", percent_bps: 4000, when: "on_accept" },
          { label: "Fase intermedia", percent_bps: 3000, when: "date", planned_on: planned },
          { label: "Entrega final", percent_bps: 3000, when: "on_delivery" },
        ],
      },
      lines: [
        line("Web corporativa", "one_off", 300_000),
        line("Mantenimiento web", "monthly", 15_000),
        line("Hosting y dominio", "yearly", 24_000, { startsOn: addDays(today, 10) }),
        line("Campaña Meta Ads", "usage", 37_500),
      ],
    });
    await finalize(quote);
    const contractId = await accept(quote);

    const contract = await one<Record<string, unknown>>(
      "select client_id, deal_id, title, signed_on::text as signed_on from public.contracts where id = $1",
      [contractId],
    );
    expect(contract).toEqual({ client_id: clientId, deal_id: dealId, title: "Web corporativa y mantenimiento", signed_on: today });
    expect(
      await all("select issuer_id, valid_from::text as valid_from from public.contract_issuers where contract_id = $1", [contractId]),
    ).toEqual([{ issuer_id: ids.freelancer, valid_from: today }]);

    const lines = await all<Record<string, unknown>>(
      `select description, billing_type, unit_price_cents, starts_on::text as starts_on, billing_day
       from public.contract_lines where contract_id = $1 order by position`,
      [contractId],
    );
    expect(lines).toEqual([
      { description: "Web corporativa", billing_type: "one_off", unit_price_cents: 300_000, starts_on: null, billing_day: null },
      // Sin fecha, empieza con el contrato; el día de facturación es el de la org.
      { description: "Mantenimiento web", billing_type: "monthly", unit_price_cents: 15_000, starts_on: today, billing_day: 1 },
      { description: "Hosting y dominio", billing_type: "yearly", unit_price_cents: 24_000, starts_on: addDays(today, 10), billing_day: null },
      { description: "Campaña Meta Ads", billing_type: "usage", unit_price_cents: 37_500, starts_on: today, billing_day: null },
    ]);
    // Cada línea del presupuesto sabe qué línea de contrato salió de ella.
    const linked = await one<{ n: number }>(
      `select count(*)::int as n from public.quote_lines ql
       join public.contract_lines cl on cl.id = ql.contract_line_id and cl.description = ql.description
       where ql.quote_id = $1`,
      [quote],
    );
    expect(linked.n).toBe(4);

    const milestones = await all<Record<string, unknown>>(
      "select position, label, percent_bps, planned_on::text as planned_on, auto from public.contract_milestones where contract_id = $1 order by position",
      [contractId],
    );
    expect(milestones).toEqual([
      { position: 0, label: "Inicio del proyecto", percent_bps: 4000, planned_on: today, auto: true },
      { position: 1, label: "Fase intermedia", percent_bps: 3000, planned_on: planned, auto: true },
      { position: 2, label: "Entrega final", percent_bps: 3000, planned_on: null, auto: false },
    ]);

    const row = await quoteRow(quote);
    expect(row).toMatchObject({ status: "accepted", contract_id: contractId });
    expect(row.accepted_at).not.toBeNull();
    expect((await asOwner<{ state: string }>("select state from public.quotes_overview where id = $1", [quote])).state).toBe("accepted");

    // El deal pasa a la primera etapa ganada y el trigger deja el historial.
    expect(await dealStage()).toBe("Ganado");
    const history = await all<{ from_stage_id: string | null; to_stage_id: string; changed_by: string | null }>(
      "select from_stage_id, to_stage_id, changed_by from public.deal_stage_history where deal_id = $1 order by id",
      [dealId],
    );
    expect(history.at(-1)).toEqual({ from_stage_id: stages["Propuesta enviada"], to_stage_id: stages.Ganado, changed_by: owner });
  });

  it("un borrador se acepta directamente: se numera en la misma transacción", async () => {
    const quote = await exampleQuote({ lines: [line("Mantenimiento", "monthly", 15_000)], header: { payment_plan: [] } });
    const contractId = await accept(quote);
    const row = await quoteRow(quote);
    expect(row).toMatchObject({ status: "accepted", number: `P${today.slice(0, 4)}-0001`, contract_id: contractId });
    // Sin nada puntual no hay hitos.
    expect((await counts()).milestones).toBe(0);
  });

  it("si algo falla a mitad, no queda nada: ni contrato, ni número, ni deal movido", async () => {
    const quote = await exampleQuote();
    // El IVA deja de serlo después de guardar: el alta de las líneas del contrato falla.
    await db.query("update public.tax_rates set kind = 'irpf', regime = null, is_default = false where id = $1", [ids.vat21]);
    await expectHint(accept(quote), "vat_rate_required");

    expect(await counts()).toEqual({ contracts: 0, lines: 0, milestones: 0, issuers: 0 });
    expect(await quoteRow(quote)).toMatchObject({ status: "draft", number: null, contract_id: null });
    expect(await dealStage()).toBe("Propuesta enviada");
    expect((await one<{ n: number }>("select count(*)::int as n from public.quote_lines where quote_id = $1 and contract_line_id is not null", [quote])).n).toBe(0);

    await db.query("update public.tax_rates set kind = 'vat', regime = 'general', is_default = true where id = $1", [ids.vat21]);
    await accept(quote);
    // El número que se deshizo no deja hueco.
    expect((await quoteRow(quote)).number).toBe(`P${today.slice(0, 4)}-0001`);
    expect(await counts()).toMatchObject({ contracts: 1, lines: 4, milestones: 2, issuers: 1 });
  });

  it("un deal ya ganado no retrocede; uno perdido pasa a ganado y pierde el motivo", async () => {
    await db.query("update public.deals set stage_id = $2 where id = $1", [dealId, stages.Activo]);
    await accept(await exampleQuote());
    expect(await dealStage()).toBe("Activo");

    const reason = (await one<{ id: string }>("select id from public.loss_reasons where org_id = $1 limit 1", [orgId])).id;
    await db.query("update public.deals set stage_id = $2, loss_reason_id = $3 where id = $1", [dealId, stages.Perdido, reason]);
    await accept(await exampleQuote());
    expect(await dealStage()).toBe("Ganado");
    expect((await one<{ loss_reason_id: string | null }>("select loss_reason_id from public.deals where id = $1", [dealId])).loss_reason_id).toBeNull();
  });

  it("una línea que termina antes de empezar el contrato no deja aceptar", async () => {
    const quote = await exampleQuote({
      header: { payment_plan: [] },
      lines: [line("Campaña de verano", "monthly", 50_000, { endsOn: addDays(today, -1) })],
    });
    await expectHint(accept(quote), "quote_line_dates");
  });
});

describe("congelado tras aceptar", () => {
  it("nadie cambia la cabecera ni las líneas, tampoco service_role", async () => {
    const quote = await exampleQuote();
    const contractId = await accept(quote);
    for (const role of [null, "service_role"]) {
      if (role) await db.exec(`set role ${role}`);
      try {
        await expectHint(db.query("update public.quotes set title = 'Otro' where id = $1", [quote]), "quote_frozen");
        await expectHint(db.query("update public.quotes set status = 'rejected', rejected_at = now() where id = $1", [quote]), "quote_frozen");
        await expectHint(db.query("delete from public.quotes where id = $1", [quote]), "quote_not_draft");
        await expectHint(db.query("update public.quote_lines set unit_price_cents = 1 where quote_id = $1", [quote]), "quote_frozen");
        await expectHint(db.query("delete from public.quote_lines where quote_id = $1", [quote]), "quote_frozen");
        await expectHint(
          db.query(
            "insert into public.quote_lines (org_id, quote_id, description, billing_type, unit_price_cents, tax_rate_id, base_cents) values ($1, $2, 'Extra', 'one_off', 100, $3, 100)",
            [orgId, quote, ids.vat21],
          ),
          "quote_frozen",
        );
      } finally {
        await db.exec("reset role");
      }
    }
    await expectHint(saveQuote({ quote_id: quote, header: header(), lines: [] }), "quote_frozen");
    await expectHint(as(db, owner, () => db.query("select public.reject_quote($1)", [quote])), "quote_frozen");
    await expectHint(accept(quote), "quote_already_accepted");

    // Borrar una línea del contrato sin facturar solo quita el enlace del presupuesto.
    const monthly = (await one<{ id: string }>("select id from public.contract_lines where contract_id = $1 and billing_type = 'monthly'", [contractId])).id;
    await asOwner("delete from public.contract_lines where id = $1 returning id", [monthly]);
    const lines = await all<{ description: string; linked: boolean }>(
      "select description, contract_line_id is not null as linked from public.quote_lines where quote_id = $1 order by position",
      [quote],
    );
    expect(lines.filter((l) => !l.linked).map((l) => l.description)).toEqual(["Mantenimiento web"]);
    expect((await quoteRow(quote)).status).toBe("accepted");
  });
});

describe("rechazar, caducar y borrar", () => {
  it("rechaza un enviado; un borrador no; aceptar después lo recupera", async () => {
    const quote = await exampleQuote();
    await expectHint(as(db, owner, () => db.query("select public.reject_quote($1)", [quote])), "quote_not_sent");
    await finalize(quote);
    await as(db, owner, () => db.query("select public.reject_quote($1, 'Se va de presupuesto')", [quote]));
    expect(
      await asOwner("select q.status, q.rejection_reason, v.state from public.quotes q join public.quotes_overview v on v.id = q.id where q.id = $1", [quote]),
    ).toEqual({ status: "rejected", rejection_reason: "Se va de presupuesto", state: "rejected" });
    await expectHint(saveQuote({ quote_id: quote, header: header(), lines: [] }), "quote_not_editable");

    await accept(quote);
    expect(await asOwner("select status, rejected_at, rejection_reason from public.quotes where id = $1", [quote])).toEqual({
      status: "accepted",
      rejected_at: null,
      rejection_reason: null,
    });
  });

  it("un enviado con la validez vencida sale caducado; un borrador, no", async () => {
    const sent = await exampleQuote();
    await finalize(sent);
    const draft = await exampleQuote({ header: { valid_until: addDays(today, 1) } });
    // Como si se hubiera enviado hace dos meses.
    await db.query("update public.quotes set issued_on = $2, valid_until = $3 where id = $1", [sent, addDays(today, -60), addDays(today, -30)]);
    const states = await all<{ id: string; state: string }>("select id, state from public.quotes_overview");
    expect(Object.fromEntries(states.map((s) => [s.id, s.state]))).toEqual({ [sent]: "expired", [draft]: "draft" });
  });

  it("solo se borran los borradores (con sus líneas)", async () => {
    const draft = await exampleQuote();
    const sent = await exampleQuote();
    await finalize(sent);
    await as(db, owner, () => db.query("delete from public.quotes where id = any($1::uuid[])", [[draft, sent]]));
    expect((await all<{ id: string }>("select id from public.quotes")).map((q) => q.id)).toEqual([sent]);
    expect((await one<{ n: number }>("select count(*)::int as n from public.quote_lines where quote_id = $1", [draft])).n).toBe(0);
  });

  it("los emails del presupuesto van a outbound_emails con su plantilla", async () => {
    const quote = await exampleQuote();
    await finalize(quote);
    await asOwner(
      `insert into public.outbound_emails (org_id, quote_id, client_id, template, language, to_emails, subject, body, status, sent_at,
        quote_document_snapshot, quote_pdf_snapshot, quote_pdf_sha256)
       values ($1, $2, $3, 'quote', 'es', '{cliente@example.com}', 'Presupuesto', 'Hola', 'sent', now(),
        '{"title":"Propuesta"}'::jsonb, decode('504446', 'hex'), repeat('a', 64)) returning id`,
      [orgId, quote, clientId],
    );
    const invoice = (
      await as(db, owner, () =>
        one<{ id: string }>("select public.save_invoice_draft($1::jsonb) as id", [
          JSON.stringify({ header: { issuer_id: ids.freelancer, client_id: clientId }, lines: [] }),
        ]),
      )
    ).id;
    await expect(
      asOwner(
        `insert into public.outbound_emails (org_id, quote_id, invoice_id, template, subject, body)
         values ($1, $2, $3, 'quote', 'Presupuesto', 'Hola') returning id`,
        [orgId, quote, invoice],
      ),
    ).rejects.toThrow(/outbound_emails_one_document_check/);
  });
});

describe("RLS de presupuestos", () => {
  it("otra org no ve nada ni puede tocarlo", async () => {
    const quote = await exampleQuote();
    await finalize(quote);
    const outsider = await createUser(db, "fuera@example.com");
    await as(db, outsider, async () => {
      for (const table of ["quotes", "quote_lines", "quotes_overview"]) {
        expect((await db.query(`select * from public.${table}`)).rows, table).toHaveLength(0);
      }
    });
    await expect(finalize(quote, outsider)).rejects.toThrow(/Sin permiso/);
    await expect(accept(quote, outsider)).rejects.toThrow(/Sin permiso/);
    await expect(saveQuote({ quote_id: quote, header: header(), lines: [] }, outsider)).rejects.toThrow(/Sin permiso/);
    await expect(saveQuote({ header: header(), lines: [] }, outsider)).rejects.toThrow(/Sin permiso/);
    expect((await quoteRow(quote)).status).toBe("sent");
  });

  it("un viewer lee pero no escribe; un socio tampoco escribe las tablas sin las RPC", async () => {
    const quote = await exampleQuote();
    await finalize(quote);
    const draft = await exampleQuote();
    const viewer = await createUser(db, "viewer@example.com");
    await db.query("insert into public.members (org_id, user_id, role, full_name, initials) values ($1, $2, 'viewer', 'Visor', 'VI')", [orgId, viewer]);

    await as(db, viewer, async () => {
      expect((await db.query("select * from public.quotes_overview")).rows).toHaveLength(2);
      expect((await db.query("select * from public.quote_lines where quote_id = $1", [quote])).rows).toHaveLength(4);
      // Borrar no falla, pero la RLS no le deja ver ninguna fila que borrar.
      await db.query("delete from public.quotes where id = $1", [draft]);
    });
    expect((await quoteRow(draft)).status).toBe("draft");
    await expect(saveQuote({ header: header(), lines: [] }, viewer)).rejects.toThrow(/Sin permiso/);
    await expect(finalize(draft, viewer)).rejects.toThrow(/Sin permiso/);
    await expect(accept(quote, viewer)).rejects.toThrow(/Sin permiso/);
    await expect(as(db, viewer, () => db.query("select public.reject_quote($1)", [quote]))).rejects.toThrow(/Sin permiso/);
    expect(await counts()).toMatchObject({ contracts: 0 });

    await expect(
      asOwner("insert into public.quotes (org_id, client_id, issuer_id, title) values ($1, $2, $3, 'Directo') returning id", [
        orgId,
        clientId,
        ids.freelancer,
      ]),
    ).rejects.toThrow(/permission denied/);
    await expect(asOwner("update public.quotes set title = 'Directo' where id = $1 returning id", [draft])).rejects.toThrow(/permission denied/);
    await expect(asOwner("delete from public.quote_lines where quote_id = $1 returning id", [draft])).rejects.toThrow(/permission denied/);
  });
});

describe("copia exacta del presupuesto enviado", () => {
  it("exige snapshot antes de marcar enviado y no permite reescribirlo", async () => {
    const quote = await exampleQuote();
    await finalize(quote);
    const bytes = Buffer.from("%PDF exact proposal version");
    const hash = createHash("sha256").update(bytes).digest("hex");
    await expect(asOwner(
      `insert into public.outbound_emails (org_id, quote_id, client_id, template, language, to_emails, subject, body, status, sent_at)
       values ($1, $2, $3, 'quote', 'es', array['cliente@example.com'], 'Propuesta', 'Texto', 'sent', now())`,
      [orgId, quote, clientId],
    )).rejects.toMatchObject({ hint: "quote_snapshot_required" });

    const sent = await asOwner<{ id: string }>(
      `insert into public.outbound_emails (org_id, quote_id, client_id, template, language, to_emails, subject, body, status,
        quote_document_snapshot, quote_pdf_snapshot, quote_pdf_sha256)
       values ($1, $2, $3, 'quote', 'es', array['cliente@example.com'], 'Propuesta', 'Texto', 'pending_approval',
        '{"title":"Propuesta congelada"}'::jsonb, decode($4, 'hex'), $5) returning id`,
      [orgId, quote, clientId, bytes.toString("hex"), hash],
    );
    await asOwner("update public.outbound_emails set status = 'sent', sent_at = now() where id = $1", [sent.id]);
    await expect(asOwner("update public.outbound_emails set quote_pdf_sha256 = repeat('0', 64) where id = $1", [sent.id]))
      .rejects.toMatchObject({ hint: "quote_snapshot_immutable" });
    const stored = await one<{ hash: string; bytes: string }>("select quote_pdf_sha256 as hash, encode(quote_pdf_snapshot, 'hex') as bytes from public.outbound_emails where id = $1", [sent.id]);
    expect(stored).toEqual({ hash, bytes: bytes.toString("hex") });
  });

  it("guarda envíos manuales aparte del email y no permite alterar la evidencia", async () => {
    const quote = await exampleQuote();
    await finalize(quote);
    const bytes = Buffer.from("%PDF manual proposal");
    const hash = createHash("sha256").update(bytes).digest("hex");
    const version = await asOwner<{ id: string }>(
      `insert into public.quote_sent_versions (org_id, quote_id, method, recipient, note, document_snapshot, pdf_snapshot, pdf_sha256)
       values ($1, $2, 'whatsapp', '+34600000000', 'Se envió por WhatsApp', '{"title":"Propuesta enviada"}', decode($3, 'hex'), $4) returning id`,
      [orgId, quote, bytes.toString("hex"), hash],
    );
    await expect((async () => db.query("update public.quote_sent_versions set note = 'alterado' where id = $1", [version.id])))
      .rejects.toMatchObject({ hint: "quote_snapshot_immutable" });
    const outsider = await createUser(db, "version-outsider@example.com");
    await as(db, outsider, async () => expect((await db.query("select * from public.quote_sent_versions")).rows).toHaveLength(0));
    const stored = await one<{ method: string; recipient: string; hash: string; pdf: string }>(
      "select method, recipient, pdf_sha256 as hash, encode(pdf_snapshot, 'hex') as pdf from public.quote_sent_versions where id = $1", [version.id],
    );
    expect(stored).toEqual({ method: "whatsapp", recipient: "+34600000000", hash, pdf: bytes.toString("hex") });
  });
});
