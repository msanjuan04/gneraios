import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { addDays } from "@/domain/dates/civil-date";
import { lineBaseCents } from "@/domain/metrics/mrr";
import { hashPortalToken, newPortalToken, sha256Hex } from "@/server/portal/token";
import { as, createDb, createOrg, createUser, type Db } from "./harness";

let db: Db;
let owner: string;
let orgId: string;
let today: string;
let ids: { freelancer: string; vat21: string };
let clientId: string;
let dealId: string;
let ownerMember: string;
let stages: Record<string, string>;

type LinkRow = { id: string; kind: string; expires_at: Date; revoked_at: Date | null; view_count: number; last_viewed_at: Date | null };

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

/** Como el servidor con la clave secreta: rol service_role y sin usuario en el JWT. */
async function asService<T>(fn: () => Promise<T>): Promise<T> {
  await db.exec("set role service_role");
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}

async function expectHint(promise: Promise<unknown>, hint: string) {
  await expect(promise).rejects.toMatchObject({ hint });
}

function line(description: string, billingType: "one_off" | "monthly", unitPriceCents: number) {
  return {
    id: randomUUID(),
    description,
    billing_type: billingType,
    quantity: "1",
    unit_price_cents: unitPriceCents,
    discount_bps: 0,
    tax_rate_id: ids.vat21,
    irpf_applies: true,
    starts_on: null,
    ends_on: null,
    billing_day: null,
    prorate_first: true,
    base_cents: lineBaseCents({ quantity: "1", unitPriceCents, discountBps: 0 }),
  };
}

/** Presupuesto enviado: web (3.000 €, 50 % a la aceptación y 50 % a la entrega) y mantenimiento mensual. */
async function sentQuote(opts: { client?: string; deal?: string | null; validUntil?: string } = {}): Promise<string> {
  const lines = [line("Web corporativa", "one_off", 300_000), line("Mantenimiento web", "monthly", 15_000)].map((l, position) => ({
    position,
    ...l,
  }));
  const quote = await as(db, owner, async () =>
    (
      await one<{ id: string }>("select public.save_quote($1::jsonb) as id", [
        JSON.stringify({
          header: {
            client_id: opts.client ?? clientId,
            deal_id: opts.deal === undefined ? dealId : opts.deal,
            issuer_id: ids.freelancer,
            title: "Web corporativa y mantenimiento",
            language: "ca",
            valid_until: opts.validUntil ?? addDays(today, 30),
            payment_plan: [
              { label: "Inici del projecte", percent_bps: 5000, when: "on_accept" },
              { label: "Lliurament final", percent_bps: 5000, when: "on_delivery" },
            ],
          },
          lines,
        }),
      ])
    ).id,
  );
  await as(db, owner, () => db.query("select public.finalize_quote($1)", [quote]));
  return quote;
}

/** Crea un enlace como `user` y devuelve el token (lo único que ve el cliente). */
async function createLink(kind: "quote" | "client", target: string, user = owner): Promise<{ token: string; id: string }> {
  const { token, hash } = newPortalToken();
  const { r } = await as(db, user, () =>
    one<{ r: { id: string } }>("select public.create_public_link($1, $2, $3) as r", [kind, target, hash]),
  );
  return { token, id: r.id };
}

async function linkRow(id: string): Promise<LinkRow> {
  return one<LinkRow>("select id, kind, expires_at, revoked_at, view_count, last_viewed_at from public.public_links where id = $1", [id]);
}

async function quoteVersion(quoteId: string): Promise<string> {
  return (await one<{ v: string }>("select updated_at::text as v from public.quotes where id = $1", [quoteId])).v;
}

function evidence(extra: Record<string, unknown> = {}) {
  const pdf = sha256Hex("pdf-bytes");
  return {
    signer_name: "Laura Puig",
    signer_email: " Laura@Example.com ",
    signature: "Laura Puig",
    consent_text: "He llegit i accepto el pressupost.",
    locale: "ca",
    ip_address: "203.0.113.7",
    forwarded_for: "203.0.113.7, 10.0.0.1",
    user_agent: "Mozilla/5.0 (Macintosh)",
    pdf_sha256: pdf,
    pdf_path: `${orgId}/quote/${pdf}.pdf`,
    ...extra,
  };
}

async function portalAccept(token: string, quoteId: string, version?: string, extra: Record<string, unknown> = {}): Promise<string> {
  const v = version ?? (await quoteVersion(quoteId));
  return asService(async () =>
    (
      await one<{ id: string }>("select public.portal_accept_quote($1, $2, $3::timestamptz, $4::jsonb) as id", [
        hashPortalToken(token),
        quoteId,
        v,
        JSON.stringify(evidence(extra)),
      ])
    ).id,
  );
}

async function portalLink(token: string, track = false, viewer: string | null = null) {
  return asService(async () =>
    (await one<{ r: Record<string, unknown> }>("select public.portal_link($1, $2, $3) as r", [hashPortalToken(token), track, viewer])).r,
  );
}

async function counts() {
  return one<{ contracts: number; acceptances: number; accepted_notifications: number }>(
    `select (select count(*)::int from public.contracts) as contracts,
            (select count(*)::int from public.quote_acceptances) as acceptances,
            (select count(*)::int from public.notifications where kind = 'quote_accepted') as accepted_notifications`,
  );
}

async function dealStage(): Promise<string> {
  return (await one<{ name: string }>("select s.name from public.deals d join public.pipeline_stages s on s.id = d.stage_id where d.id = $1", [dealId])).name;
}

beforeEach(async () => {
  db = await createDb();
  owner = await createUser(db, "owner@example.com");
  orgId = await createOrg(db, owner);
  today = (await one<{ d: string }>("select private.org_today($1)::text as d", [orgId])).d;
  ids = {
    freelancer: (await one<{ id: string }>("select id from public.issuers where org_id = $1 and kind = 'self_employed'", [orgId])).id,
    vat21: (await one<{ id: string }>("select id from public.tax_rates where org_id = $1 and name = 'IVA 21 %'", [orgId])).id,
  };
  ownerMember = (await one<{ id: string }>("select id from public.members where org_id = $1 and user_id = $2", [orgId, owner])).id;
  stages = Object.fromEntries(
    (await all<{ id: string; name: string }>("select id, name from public.pipeline_stages where org_id = $1", [orgId])).map((s) => [s.name, s.id]),
  );
  clientId = (
    await asOwner<{ id: string }>(
      `insert into public.clients (org_id, display_name, legal_name, tax_id, address_line, postal_code, city, owner_member_id, preferred_language)
       values ($1, 'Restaurant del Port', 'Port Mataró SL', 'B12345674', 'Passeig Marítim 3', '08301', 'Mataró', $2, 'ca') returning id`,
      [orgId, ownerMember],
    )
  ).id;
  dealId = (
    await asOwner<{ id: string }>(
      "insert into public.deals (org_id, client_id, title, stage_id) values ($1, $2, 'Web nova', $3) returning id",
      [orgId, clientId, stages["Propuesta enviada"]],
    )
  ).id;
});

describe("tokens", () => {
  it("solo se guarda el hash del token, y ningún miembro puede leerlo", async () => {
    const quote = await sentQuote();
    const { token, id } = await createLink("quote", quote);
    const row = await one<{ token_hash: string; raw: string }>("select token_hash, to_jsonb(l)::text as raw from public.public_links l where id = $1", [id]);
    expect(row.token_hash).toBe(hashPortalToken(token));
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.raw).not.toContain(token);

    // El hash tampoco se lee con la sesión de un miembro (ni con un select *).
    await expect(asOwner("select token_hash from public.public_links")).rejects.toThrow(/permission denied/);
    await expect(asOwner("select * from public.public_links")).rejects.toThrow(/permission denied/);
    const visible = await asOwner<{ view_count: number; kind: string }>("select kind, view_count from public.public_links where id = $1", [id]);
    expect(visible).toEqual({ kind: "quote", view_count: 0 });
    // Y la auditoría no lo guarda.
    const audit = await one<{ raw: string }>("select coalesce(string_agg(new_data::text, ''), '') as raw from public.audit_log where table_name = 'public_links'");
    expect(audit.raw).not.toContain(row.token_hash);
  });

  it("el acceso público solo existe para el servidor: ni anon ni un miembro llaman a las RPC portal_*", async () => {
    const quote = await sentQuote();
    const { token } = await createLink("quote", quote);
    const hash = hashPortalToken(token);
    await expect(as(db, null, () => db.query("select * from public.public_links"))).rejects.toThrow(/permission denied/);
    await expect(as(db, null, () => db.query("select * from public.quote_acceptances"))).rejects.toThrow(/permission denied/);
    await expect(as(db, null, () => db.query("select public.portal_link($1)", [hash]))).rejects.toThrow(/permission denied/);
    await expect(as(db, owner, () => db.query("select public.portal_link($1)", [hash]))).rejects.toThrow(/permission denied/);
    await expect(
      as(db, owner, () => db.query("select public.portal_accept_quote($1, $2, now(), '{}'::jsonb)", [hash, quote])),
    ).rejects.toThrow(/permission denied/);
    await expect(as(db, null, () => db.query("select public.create_public_link('quote', $1, $2)", [quote, sha256Hex("x")]))).rejects.toThrow(
      /permission denied/,
    );
  });

  it("resuelve el enlace vivo; uno revocado, caducado o desconocido no sirve para nada", async () => {
    const quote = await sentQuote();
    const { token, id } = await createLink("quote", quote);
    expect(await portalLink(token)).toMatchObject({ status: "active", kind: "quote", quote_id: quote, org_id: orgId });
    expect(await portalLink(newPortalToken().token)).toEqual({ status: "unknown" });

    await as(db, owner, () => db.query("select public.revoke_public_link($1)", [id]));
    expect(await portalLink(token)).toMatchObject({ status: "revoked" });
    await expectHint(portalAccept(token, quote), "portal_link_invalid");

    const again = await createLink("quote", quote);
    await db.query("update public.public_links set expires_at = now() - interval '1 minute' where id = $1", [again.id]);
    expect(await portalLink(again.token)).toMatchObject({ status: "expired" });
    await expectHint(portalAccept(again.token, quote), "portal_link_invalid");
    await expectHint(
      asService(() => db.query("select public.portal_reject_quote($1, $2, null)", [hashPortalToken(again.token), quote])),
      "portal_link_invalid",
    );
    expect((await counts()).contracts).toBe(0);
  });

  it("crear otro enlace revoca el anterior: un enlace vivo por destino", async () => {
    const quote = await sentQuote();
    const first = await createLink("quote", quote);
    const second = await createLink("quote", quote);
    expect((await linkRow(first.id)).revoked_at).not.toBeNull();
    expect((await linkRow(second.id)).revoked_at).toBeNull();
    expect(await portalLink(first.token)).toMatchObject({ status: "revoked" });
    expect(await portalLink(second.token)).toMatchObject({ status: "active" });
  });

  it("se comparten presupuestos enviados y vigentes, y clientes no archivados", async () => {
    const draft = await as(db, owner, async () =>
      (
        await one<{ id: string }>("select public.save_quote($1::jsonb) as id", [
          JSON.stringify({ header: { client_id: clientId, issuer_id: ids.freelancer, title: "Borrador", language: "es", payment_plan: [] }, lines: [] }),
        ])
      ).id,
    );
    await expectHint(createLink("quote", draft), "portal_quote_draft");
    const quote = await sentQuote();
    await db.query("update public.quotes set issued_on = $2::date - 40, valid_until = $2::date - 1 where id = $1", [quote, today]);
    await expectHint(createLink("quote", quote), "portal_quote_expired");

    const viewer = await createUser(db, "viewer@example.com");
    await db.query("insert into public.members (org_id, user_id, role, full_name, initials) values ($1, $2, 'viewer', 'Visor', 'VI')", [orgId, viewer]);
    await expect(createLink("client", clientId, viewer)).rejects.toThrow(/Sin permiso/);
    const outsider = await createUser(db, "fuera@example.com");
    await expect(createLink("client", clientId, outsider)).rejects.toThrow(/Sin permiso/);

    await db.query("update public.clients set archived_at = now() where id = $1", [clientId]);
    await expectHint(createLink("client", clientId), "portal_client_archived");
  });

  it("la caducidad sigue a la validez del presupuesto; el portal dura un año y se renueva", async () => {
    const quote = await sentQuote();
    const { id } = await createLink("quote", quote);
    const expected = (valid: string) =>
      one<{ t: Date }>("select (($1::date + 31)::timestamp at time zone 'Europe/Madrid') as t", [valid]).then((r) => r.t.getTime());
    expect((await linkRow(id)).expires_at.getTime()).toBe(await expected(addDays(today, 30)));

    // Ampliar la validez amplía el enlace (lo mantiene un trigger).
    await db.query("update public.quotes set valid_until = $2 where id = $1", [quote, addDays(today, 60)]);
    expect((await linkRow(id)).expires_at.getTime()).toBe(await expected(addDays(today, 60)));
    await expectHint(as(db, owner, () => db.query("select public.renew_public_link($1)", [id])), "portal_link_follows_quote");

    const portal = await createLink("client", clientId);
    const before = (await linkRow(portal.id)).expires_at.getTime();
    expect(before - Date.now()).toBeGreaterThan(364 * 86_400_000);
    await db.query("update public.public_links set expires_at = now() - interval '1 day' where id = $1", [portal.id]);
    await as(db, owner, () => db.query("select public.renew_public_link($1)", [portal.id]));
    expect(await portalLink(portal.token)).toMatchObject({ status: "active", kind: "client", client_id: clientId });

    await as(db, owner, () => db.query("select public.revoke_public_link($1)", [portal.id]));
    await expectHint(as(db, owner, () => db.query("select public.renew_public_link($1)", [portal.id])), "portal_link_revoked");
  });

  it("cuenta las visitas del cliente, pero no las de los miembros de la org", async () => {
    const { token, id } = await createLink("client", clientId);
    await portalLink(token, true, owner);
    expect((await linkRow(id)).view_count).toBe(0);
    await portalLink(token, true, null);
    await portalLink(token, true, randomUUID());
    const row = await linkRow(id);
    expect(row.view_count).toBe(2);
    expect(row.last_viewed_at).not.toBeNull();
    // Sin pedirlo (las descargas, las acciones) no cuenta.
    await portalLink(token, false, null);
    expect((await linkRow(id)).view_count).toBe(2);
  });

  it("limita los intentos por enlace y acción en una ventana", async () => {
    const { token } = await createLink("client", clientId);
    const hit = (action: string) =>
      asService(async () => (await one<{ ok: boolean }>("select public.portal_hit($1, $2, 3, 3600) as ok", [hashPortalToken(token), action])).ok);
    expect([await hit("quote"), await hit("quote"), await hit("quote"), await hit("quote")]).toEqual([true, true, true, false]);
    expect(await hit("request")).toBe(true);
    // La ventana vencida vuelve a empezar.
    await db.query("update private.public_link_hits set window_started_at = now() - interval '2 hours' where action = 'quote'");
    expect(await hit("quote")).toBe(true);
    // Un token desconocido no pasa.
    expect(
      await asService(async () => (await one<{ ok: boolean }>("select public.portal_hit($1, 'quote', 3, 3600) as ok", [sha256Hex("nada")])).ok),
    ).toBe(false);
  });
});

describe("aceptación online", () => {
  it("crea el contrato y gana el deal una sola vez, con la evidencia y el aviso: repetirlo no duplica nada", async () => {
    const quote = await sentQuote();
    const { token, id: linkId } = await createLink("quote", quote);
    const version = await quoteVersion(quote);

    const contract = await portalAccept(token, quote, version);
    const accepted = await one<{ status: string; contract_id: string }>("select status, contract_id from public.quotes where id = $1", [quote]);
    expect(accepted).toEqual({ status: "accepted", contract_id: contract });
    expect(await dealStage()).toBe("Ganado");
    const lines = await all<{ billing_type: string }>("select billing_type from public.contract_lines where contract_id = $1 order by position", [contract]);
    expect(lines.map((l) => l.billing_type)).toEqual(["one_off", "monthly"]);
    const milestones = await all<{ position: number; planned_on: string | null; auto: boolean }>(
      "select position, planned_on::text, auto from public.contract_milestones where contract_id = $1 order by position",
      [contract],
    );
    expect(milestones).toEqual([
      { position: 0, planned_on: today, auto: true },
      { position: 1, planned_on: null, auto: false },
    ]);

    // Evidencia: quién, cuándo, desde dónde y qué documento exacto.
    const proof = await one<Record<string, unknown>>(
      "select link_id, signer_name, signer_email, signature, locale::text, ip_address, user_agent, quote_number, quote_version::text, pdf_sha256 from public.quote_acceptances where quote_id = $1",
      [quote],
    );
    expect(proof).toMatchObject({
      link_id: linkId,
      signer_name: "Laura Puig",
      signer_email: "laura@example.com",
      signature: "Laura Puig",
      locale: "ca",
      ip_address: "203.0.113.7",
      user_agent: "Mozilla/5.0 (Macintosh)",
      quote_number: expect.stringMatching(/^P\d{4}-0001$/),
      quote_version: version,
      pdf_sha256: sha256Hex("pdf-bytes"),
    });
    // Lo hizo el socio que compartió el enlace (auditoría y autoría del contrato).
    expect((await one<{ created_by: string }>("select created_by from public.contracts where id = $1", [contract])).created_by).toBe(owner);

    const notice = await one<{ member_id: string; params: Record<string, string>; href: string }>(
      "select member_id, params, href from public.notifications where kind = 'quote_accepted'",
    );
    expect(notice).toMatchObject({
      member_id: ownerMember,
      href: `/quotes/${quote}`,
      params: { client: "Restaurant del Port", title: "Web corporativa y mantenimiento", signer: "Laura Puig" },
    });

    // Doble envío: el segundo ve el aceptado y no hace nada.
    await expectHint(portalAccept(token, quote, version), "quote_already_accepted");
    expect(await counts()).toEqual({ contracts: 1, acceptances: 1, accepted_notifications: 1 });

    // La evidencia no se toca, ni con la clave de servidor.
    await expectHint(asService(() => db.query("update public.quote_acceptances set signer_name = 'Otra' where quote_id = $1", [quote])), "acceptance_immutable");
    await expectHint(asService(() => db.query("delete from public.quote_acceptances where quote_id = $1", [quote])), "acceptance_immutable");
  });

  it("solo se acepta la versión que vio el cliente, abierta y vigente", async () => {
    const quote = await sentQuote();
    const { token } = await createLink("quote", quote);
    const seen = await quoteVersion(quote);
    await db.query("update public.quotes set notes = 'Cambio de última hora' where id = $1", [quote]);
    await expectHint(portalAccept(token, quote, seen), "portal_quote_changed");

    await db.query("update public.quotes set valid_until = $2::date - 1, issued_on = $2::date - 10 where id = $1", [quote, today]);
    await expectHint(portalAccept(token, quote), "portal_quote_expired");
    expect((await counts()).contracts).toBe(0);
  });

  it("el portal del cliente acepta sus presupuestos, y ningún enlace llega a los de otro cliente", async () => {
    const quote = await sentQuote();
    const portal = await createLink("client", clientId);
    const other = (
      await asOwner<{ id: string }>("insert into public.clients (org_id, display_name) values ($1, 'Otro cliente') returning id", [orgId])
    ).id;
    const foreign = await sentQuote({ client: other, deal: null });
    const quoteLink = await createLink("quote", quote);

    await expectHint(portalAccept(portal.token, foreign), "portal_quote_not_found");
    await expectHint(portalAccept(quoteLink.token, foreign), "portal_quote_not_found");
    const contract = await portalAccept(portal.token, quote);
    expect((await one<{ link_id: string }>("select link_id from public.quote_acceptances where quote_id = $1", [quote])).link_id).toBe(portal.id);
    expect((await one<{ client_id: string }>("select client_id from public.contracts where id = $1", [contract])).client_id).toBe(clientId);
  });

  it("si el socio que compartió el enlace ya no es socio, no se acepta (accept_quote vuelve a comprobar su rol)", async () => {
    const partner = await createUser(db, "socio@example.com");
    await db.query("insert into public.members (org_id, user_id, role, full_name, initials) values ($1, $2, 'partner', 'Socio', 'SO')", [orgId, partner]);
    const quote = await sentQuote();
    const { token } = await createLink("quote", quote, partner);
    await db.query("update public.members set role = 'viewer' where user_id = $1", [partner]);
    await expect(portalAccept(token, quote)).rejects.toThrow(/Sin permiso/);
    expect(await counts()).toEqual({ contracts: 0, acceptances: 0, accepted_notifications: 0 });
  });

  it("prepara el borrador del primer hito solo para lo aceptado desde ese enlace", async () => {
    const quote = await sentQuote();
    const { token } = await createLink("quote", quote);
    const contract = await portalAccept(token, quote);
    const web = (await one<{ id: string }>("select id from public.contract_lines where contract_id = $1 and billing_type = 'one_off'", [contract])).id;
    const first = (await one<{ id: string }>("select id from public.contract_milestones where contract_id = $1 and position = 0", [contract])).id;
    const itemId = randomUUID();
    const draft = (items: unknown[], lines: unknown[] = [invoiceLine(itemId, web)]) => ({
      header: { issuer_id: ids.freelancer, client_id: clientId, irpf_bps: 1500, language: "ca", payment_terms_days: 30 },
      new_items: items,
      lines,
    });
    const item = { id: itemId, contract_line_id: web, source: "milestone", milestone_id: first, description: "Web · Inici", quantity: "1", unit_price_cents: 150_000, amount_cents: 150_000, billable_on: today };
    const save = (token_: string, payload: unknown) =>
      asService(async () => (await one<{ id: string }>("select public.portal_save_invoice_draft($1, $2::jsonb) as id", [hashPortalToken(token_), JSON.stringify(payload)])).id);

    // Nada que no sea un hito de este contrato, ni líneas sueltas, ni otro enlace.
    await expectHint(save(token, draft([{ ...item, source: "usage", milestone_id: null }])), "portal_draft_forbidden");
    await expectHint(save(token, draft([item], [invoiceLine(itemId, web), invoiceLine(null, null)])), "portal_draft_forbidden");
    const other = await createLink("client", clientId);
    await expectHint(save(other.token, draft([item])), "portal_draft_forbidden");

    const invoice = await save(token, draft([item]));
    const row = await one<{ lifecycle: string; total_cents: number; created_by: string }>(
      "select lifecycle, total_cents, created_by from public.invoices where id = $1",
      [invoice],
    );
    // 1.500 € + 21 % IVA − 15 % IRPF.
    expect(row).toEqual({ lifecycle: "draft", total_cents: 159_000, created_by: owner });
    expect((await one<{ n: number }>("select count(*)::int as n from public.billable_items where milestone_id = $1", [first])).n).toBe(1);
  });

  it("rechazar deja el motivo y avisa; repetirlo no hace nada y ya no se puede aceptar", async () => {
    const quote = await sentQuote();
    const { token } = await createLink("quote", quote);
    const reject = () =>
      asService(() => db.query("select public.portal_reject_quote($1, $2, $3)", [hashPortalToken(token), quote, "  Nos quedamos con otra opción  "]));
    await reject();
    await reject();
    const row = await one<{ status: string; rejection_reason: string }>("select status, rejection_reason from public.quotes where id = $1", [quote]);
    expect(row).toEqual({ status: "rejected", rejection_reason: "Nos quedamos con otra opción" });
    const notices = await all<{ params: Record<string, string> }>("select params from public.notifications where kind = 'quote_rejected'");
    expect(notices).toHaveLength(1);
    expect(notices[0]!.params).toMatchObject({ reason: "Nos quedamos con otra opción", client: "Restaurant del Port" });
    await expectHint(portalAccept(token, quote), "portal_quote_closed");
  });
});

describe("pedir algo desde el portal", () => {
  it("crea un deal en la primera etapa abierta con la fuente «Portal», la nota y el aviso a su responsable", async () => {
    const { token } = await createLink("client", clientId);
    const request = (payload: Record<string, unknown>) =>
      asService(async () => (await one<{ id: string }>("select public.portal_create_request($1, $2::jsonb) as id", [hashPortalToken(token), JSON.stringify(payload)])).id);

    const deal = await request({ subject: "Nueva sección de carta", description: "Queremos añadir la carta de vinos.", urgent: true });
    const row = await one<{ stage: string; source: string; owner_member_id: string; next_action_on: string | null; created_by: string | null }>(
      `select s.name as stage, a.name as source, d.owner_member_id, d.next_action_on::text, d.created_by
       from public.deals d join public.pipeline_stages s on s.id = d.stage_id join public.acquisition_sources a on a.id = d.source_id
       where d.id = $1`,
      [deal],
    );
    expect(row).toEqual({ stage: "Lead", source: "Portal", owner_member_id: ownerMember, next_action_on: today, created_by: null });
    const note = await one<{ kind: string; title: string; body: string; client_visible: boolean; member_id: string | null }>(
      "select kind, title, body, client_visible, member_id from public.activities where deal_id = $1",
      [deal],
    );
    expect(note).toEqual({ kind: "note", title: "Nueva sección de carta", body: "Queremos añadir la carta de vinos.", client_visible: false, member_id: null });
    const notice = await one<{ member_id: string; href: string; params: Record<string, string> }>(
      "select member_id, href, params from public.notifications where kind = 'portal_request'",
    );
    expect(notice).toEqual({
      member_id: ownerMember,
      href: `/pipeline?deal=${deal}`,
      params: { client: "Restaurant del Port", subject: "Nueva sección de carta", urgent: "yes" },
    });

    // La segunda petición reutiliza la fuente; sin urgencia no hay fecha.
    const second = await request({ subject: "Cambiar horario", description: "Abrimos los lunes." });
    expect((await one<{ n: number }>("select count(*)::int as n from public.acquisition_sources where org_id = $1 and name = 'Portal'", [orgId])).n).toBe(1);
    expect((await one<{ next_action_on: string | null }>("select next_action_on::text from public.deals where id = $1", [second])).next_action_on).toBeNull();

    await expectHint(request({ subject: "", description: "x" }), "portal_request_invalid");
    const quoteLink = await createLink("quote", await sentQuote());
    await expectHint(
      asService(() => db.query("select public.portal_create_request($1, $2::jsonb)", [hashPortalToken(quoteLink.token), JSON.stringify({ subject: "a", description: "b" })])),
      "portal_link_invalid",
    );
  });
});

describe("ajustes, entregables y actividades visibles", () => {
  it("nada es visible para el cliente hasta que el socio lo marca", async () => {
    const activity = await asOwner<{ client_visible: boolean }>(
      "insert into public.activities (org_id, client_id, kind, title) values ($1, $2, 'note', 'Llamada') returning client_visible",
      [orgId, clientId],
    );
    expect(activity.client_visible).toBe(false);
  });

  it("los ajustes del portal son de los socios y las secciones solo guardan sí o no", async () => {
    await asOwner("insert into public.client_portal_settings (org_id, client_id, sections, next_steps) values ($1, $2, $3, 'Revisar textos') returning id", [
      orgId,
      clientId,
      JSON.stringify({ progress: true, web_data: false }),
    ]);
    await expect(
      asOwner("update public.client_portal_settings set sections = $2 where client_id = $1 returning id", [clientId, JSON.stringify({ progress: "yes" })]),
    ).rejects.toThrow(/check/);
    const viewer = await createUser(db, "viewer@example.com");
    await db.query("insert into public.members (org_id, user_id, role, full_name, initials) values ($1, $2, 'viewer', 'Visor', 'VI')", [orgId, viewer]);
    const seen = await as(db, viewer, () => all("select next_steps from public.client_portal_settings"));
    expect(seen).toEqual([{ next_steps: "Revisar textos" }]);
    const updated = await as(db, viewer, () => all("update public.client_portal_settings set next_steps = 'x' returning id"));
    expect(updated).toHaveLength(0);
  });

  it("un entregable es un fichero en la carpeta del cliente o un enlace http(s)", async () => {
    const id = randomUUID();
    await asOwner(
      "insert into public.client_files (id, org_id, client_id, kind, title, storage_path, file_name) values ($1, $2, $3, 'file', 'Logo', $4, 'logo.svg') returning id",
      [id, orgId, clientId, `${orgId}/${clientId}/${id}/logo.svg`],
    );
    await asOwner("insert into public.client_files (org_id, client_id, kind, title, url) values ($1, $2, 'link', 'Figma', 'https://figma.com/file/abc') returning id", [
      orgId,
      clientId,
    ]);
    await expect(
      asOwner("insert into public.client_files (org_id, client_id, kind, title, storage_path, file_name) values ($1, $2, 'file', 'Fuera', 'otra-org/x.pdf', 'x.pdf') returning id", [
        orgId,
        clientId,
      ]),
    ).rejects.toThrow(/check/);
    await expect(
      asOwner("insert into public.client_files (org_id, client_id, kind, title, url) values ($1, $2, 'link', 'Script', 'javascript:alert(1)') returning id", [
        orgId,
        clientId,
      ]),
    ).rejects.toThrow(/check/);
    const outsider = await createUser(db, "fuera@example.com");
    expect(await as(db, outsider, () => all("select id from public.client_files"))).toHaveLength(0);
  });
});

/** Línea de factura del hito (base 1.500 €, IVA 21 %, IRPF 15 %). */
function invoiceLine(billableItemId: string | null, contractLineId: string | null) {
  return {
    id: randomUUID(),
    position: 0,
    description: "Web · Inici",
    quantity: "1",
    unit_price_cents: 150_000,
    discount_bps: 0,
    base_cents: 150_000,
    tax_rate_id: ids.vat21,
    vat_bps: 2100,
    vat_regime: "general",
    vat_cents: 31_500,
    irpf_applies: true,
    irpf_cents: 22_500,
    billing_type: "one_off",
    contract_line_id: contractLineId,
    billable_item_id: billableItemId,
  };
}
