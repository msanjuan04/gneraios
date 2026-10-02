import { createHash, randomBytes, randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { as, createDb, createOrg, createUser, type Db, onboardingPayload } from "./harness";

let db: Db;
let owner: string;
let partner: string;
let viewer: string;
let intruder: string;
let orgId: string;
let otherOrgId: string;
let members: { owner: string; partner: string; viewer: string };
let clientId: string;
let vat21: string;

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0]!;
}

async function all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

/** Como el servidor que sirve el ICS: service_role (salta RLS, como el cliente con la clave secreta). */
async function asService<T>(fn: () => Promise<T>): Promise<T> {
  await db.exec("set role service_role");
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}

async function addMember(userId: string, role: "viewer" | "partner", initials: string): Promise<string> {
  return (
    await one<{ id: string }>(
      "insert into public.members (org_id, user_id, role, full_name, initials) values ($1, $2, $3, 'Socio', $4) returning id",
      [orgId, userId, role, initials],
    )
  ).id;
}

/** Hash de un token como lo calcula el servidor (el token nunca llega a la base de datos). */
function newTokenHash(): string {
  return createHash("sha256").update(randomBytes(32).toString("base64url")).digest("hex");
}

async function createFeed(user: string, scope: "mine" | "all" = "mine", org = orgId, hash = newTokenHash()): Promise<string> {
  return as(db, user, async () =>
    (await one<{ id: string }>("select public.create_calendar_feed($1, $2, $3) as id", [org, hash, scope])).id,
  );
}

async function expectHint(promise: Promise<unknown>, hint: string) {
  await expect(promise).rejects.toMatchObject({ hint });
}

async function contractWithMilestones(): Promise<{ contractId: string; lineId: string; milestones: string[] }> {
  const contractId = await as(db, owner, async () => {
    const issuer = await one<{ id: string }>("select id from public.issuers where org_id = $1 and kind = 'self_employed'", [orgId]);
    const payload = {
      client_id: clientId,
      issuer_id: issuer.id,
      title: "Web corporativa",
      signed_on: "2026-09-01",
      lines: [{ description: "Web", billing_type: "one_off", unit_price_cents: 300_000, tax_rate_id: vat21 }],
      milestones: [
        { position: 1, label: "A la firma", percent_bps: 5000, planned_on: "2026-09-01" },
        { position: 2, label: "Entrega", percent_bps: 5000, planned_on: "2026-11-15", auto: true },
      ],
    };
    return (await one<{ id: string }>("select public.create_contract($1::jsonb) as id", [JSON.stringify(payload)])).id;
  });
  const lineId = (await one<{ id: string }>("select id from public.contract_lines where contract_id = $1", [contractId])).id;
  const rows = await all<{ id: string }>("select id from public.contract_milestones where contract_id = $1 order by position", [contractId]);
  return { contractId, lineId, milestones: rows.map((r) => r.id) };
}

beforeEach(async () => {
  db = await createDb();
  owner = await createUser(db, "owner@example.com");
  partner = await createUser(db, "partner@example.com");
  viewer = await createUser(db, "viewer@example.com");
  intruder = await createUser(db, "intruder@example.com");
  orgId = await createOrg(db, owner);
  otherOrgId = await createOrg(db, intruder, onboardingPayload({ org: { name: "Otra", slug: "otra" }, invitations: [] }));
  members = {
    owner: (await one<{ id: string }>("select id from public.members where org_id = $1 and user_id = $2", [orgId, owner])).id,
    partner: await addMember(partner, "partner", "PA"),
    viewer: await addMember(viewer, "viewer", "VI"),
  };
  vat21 = (await one<{ id: string }>("select id from public.tax_rates where org_id = $1 and name = 'IVA 21 %'", [orgId])).id;
  clientId = await as(db, owner, async () =>
    (await one<{ id: string }>("insert into public.clients (org_id, display_name) values ($1, 'Clínica Dental') returning id", [orgId])).id,
  );
});

describe("citas privadas y conexión Google", () => {
  it("las citas las ven todos los miembros de la org (calendario compartido), pero solo las modifica su dueño", async () => {
    const entry = await as(db, partner, () => one<{ id: string }>(
      `insert into public.calendar_entries (org_id, member_id, title, starts_at, ends_at)
       values ($1, $2, 'Reunión privada', '2026-10-01T10:00:00Z', '2026-10-01T11:00:00Z') returning id`,
      [orgId, members.partner],
    ));
    const visible = (user: string) => as(db, user, () => all<{ id: string }>(
      "select id from public.calendar_entries where org_id = $1", [orgId],
    ));
    expect(await visible(partner)).toEqual([{ id: entry.id }]);
    expect(await visible(owner)).toEqual([{ id: entry.id }]);
    expect(await visible(viewer)).toEqual([{ id: entry.id }]);
    expect(await visible(intruder)).toEqual([]);
    expect((await as(db, owner, () => db.query("update public.calendar_entries set title = 'Invadida' where id = $1 returning id", [entry.id]))).rows).toHaveLength(0);
    await expect(as(db, partner, () => db.query(
      `insert into public.calendar_entries (org_id, member_id, title, starts_at, ends_at)
       values ($1, $2, 'Ajena', '2026-10-01T10:00:00Z', '2026-10-01T11:00:00Z')`,
      [orgId, members.owner],
    ))).rejects.toThrow();
  });

  it("la conexión expone estado propio pero nunca el token cifrado", async () => {
    await asService(() => db.query(
      "insert into public.google_calendar_connections (org_id, member_id, account_email, refresh_token_ciphertext) values ($1, $2, 'personal@example.com', 'sealed-secret')",
      [orgId, members.partner],
    ));
    const rows = await as(db, partner, () => all<{ account_email: string }>(
      "select account_email from public.google_calendar_connections where org_id = $1", [orgId],
    ));
    expect(rows).toEqual([{ account_email: "personal@example.com" }]);
    expect(await as(db, owner, () => all("select account_email from public.google_calendar_connections where org_id = $1", [orgId]))).toEqual([]);
    await expect(as(db, partner, () => db.query("select refresh_token_ciphertext from public.google_calendar_connections"))).rejects.toThrow(/permission denied/);
  });
});

describe("enlaces ICS", () => {
  it("cualquier miembro activo crea el suyo, y crear otro revoca el anterior", async () => {
    const first = await createFeed(viewer);
    const second = await createFeed(viewer, "all");
    const rows = await all<{ id: string; member_id: string; scope: string; revoked: boolean }>(
      "select id, member_id, scope, revoked_at is not null as revoked from public.calendar_feeds order by created_at, revoked_at nulls last",
    );
    expect(rows).toEqual([
      { id: first, member_id: members.viewer, scope: "mine", revoked: true },
      { id: second, member_id: members.viewer, scope: "all", revoked: false },
    ]);

    // Los de otro miembro no se tocan.
    await createFeed(partner);
    expect((await one<{ n: number }>("select count(*)::int as n from public.calendar_feeds where revoked_at is null")).n).toBe(2);
  });

  it("quien no es miembro (o ya no está activo) no crea enlaces, y el hash tiene que ser un SHA-256", async () => {
    await expectHint(createFeed(intruder), "not_a_member");
    await expectHint(createFeed(partner, "mine", otherOrgId), "not_a_member");
    await expectHint(createFeed(partner, "mine", orgId, "no-es-un-hash"), "token_invalid");
    await expectHint(createFeed(partner, "mine", orgId, "A".repeat(64)), "token_invalid");

    await db.query("update public.members set is_active = false where id = $1", [members.partner]);
    await expectHint(createFeed(partner), "not_a_member");
    await expect(as(db, null, () => db.query("select public.create_calendar_feed($1, $2)", [orgId, newTokenHash()]))).rejects.toThrow(
      /permission denied/,
    );
  });

  it("cada miembro ve los suyos; un owner, todos; nadie lee el hash ni escribe directamente", async () => {
    await createFeed(owner);
    await createFeed(partner);
    await createFeed(viewer);

    const visible = async (user: string) =>
      (await as(db, user, () => all<{ member_id: string }>("select member_id from public.calendar_feeds order by member_id"))).map(
        (r) => r.member_id,
      );
    expect(await visible(owner)).toEqual([members.owner, members.partner, members.viewer].sort());
    expect(await visible(partner)).toEqual([members.partner]);
    expect(await visible(viewer)).toEqual([members.viewer]);
    expect(await visible(intruder)).toEqual([]);

    for (const user of [owner, partner, viewer]) {
      await expect(as(db, user, () => db.query("select token_hash from public.calendar_feeds"))).rejects.toThrow(/permission denied/);
      await expect(as(db, user, () => db.query("select * from public.calendar_feeds"))).rejects.toThrow(/permission denied/);
      await expect(
        as(db, user, () =>
          db.query("insert into public.calendar_feeds (org_id, member_id, token_hash) values ($1, $2, $3)", [orgId, members.partner, newTokenHash()]),
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(as(db, user, () => db.query("update public.calendar_feeds set revoked_at = null"))).rejects.toThrow(/permission denied/);
      await expect(as(db, user, () => db.query("delete from public.calendar_feeds"))).rejects.toThrow(/permission denied/);
    }
    await expect(as(db, null, () => db.query("select id from public.calendar_feeds"))).rejects.toThrow(/permission denied/);
  });

  it("revoca el suyo cualquiera; el de otro, solo un owner", async () => {
    const partnerFeed = await createFeed(partner);
    const viewerFeed = await createFeed(viewer);

    await expectHint(as(db, viewer, () => db.query("select public.revoke_calendar_feed($1)", [partnerFeed])), "feed_forbidden");
    await expectHint(as(db, intruder, () => db.query("select public.revoke_calendar_feed($1)", [partnerFeed])), "feed_forbidden");
    await expectHint(as(db, partner, () => db.query("select public.revoke_calendar_feed($1)", [randomUUID()])), "feed_forbidden");

    await as(db, viewer, () => db.query("select public.revoke_calendar_feed($1)", [viewerFeed]));
    await as(db, owner, () => db.query("select public.revoke_calendar_feed($1)", [partnerFeed]));
    const active = await one<{ n: number }>("select count(*)::int as n from public.calendar_feeds where revoked_at is null");
    expect(active.n).toBe(0);
  });

  it("el servidor resuelve el enlace por su hash; la auditoría no guarda el hash ni cada lectura", async () => {
    const hash = newTokenHash();
    const feedId = await createFeed(partner, "mine", orgId, hash);

    const found = await asService(() =>
      one<{ id: string; org_id: string; member_id: string; scope: string }>(
        "select id, org_id, member_id, scope from public.calendar_feeds where token_hash = $1 and revoked_at is null",
        [hash],
      ),
    );
    expect(found).toEqual({ id: feedId, org_id: orgId, member_id: members.partner, scope: "mine" });

    await asService(() => db.query("update public.calendar_feeds set last_used_at = now() where id = $1", [feedId]));
    const audit = await all<{ action: string; new_data: Record<string, unknown> }>(
      "select action, new_data from public.audit_log where table_name = 'calendar_feeds' order by id",
    );
    expect(audit.map((a) => a.action)).toEqual(["insert"]);
    expect(audit[0]!.new_data).not.toHaveProperty("token_hash");
    expect(JSON.stringify(audit)).not.toContain(hash);

    await as(db, partner, () => db.query("select public.revoke_calendar_feed($1)", [feedId]));
    expect(
      (await all<{ action: string }>("select action from public.audit_log where table_name = 'calendar_feeds' order by id")).map((a) => a.action),
    ).toEqual(["insert", "update"]);
  });

  it("dar de baja a un miembro borra sus enlaces", async () => {
    await createFeed(partner);
    await db.query("delete from public.members where id = $1", [members.partner]);
    expect((await one<{ n: number }>("select count(*)::int as n from public.calendar_feeds")).n).toBe(0);
  });
});

describe("mover fechas desde el calendario", () => {
  it("un socio mueve un hito sin facturar; uno facturado ya no se mueve", async () => {
    const { lineId, milestones } = await contractWithMilestones();
    const [signing, delivery] = milestones as [string, string];

    await as(db, partner, () => db.query("select public.reschedule_milestone($1, $2::date)", [delivery, "2026-12-01"]));
    const moved = await one<{ planned_on: string; auto: boolean }>(
      "select planned_on::text, auto from public.contract_milestones where id = $1",
      [delivery],
    );
    expect(moved).toEqual({ planned_on: "2026-12-01", auto: true });

    // El primer hito ya tiene su pendiente de facturar (lo que hace el cron el día previsto).
    await db.query(
      `insert into public.billable_items (org_id, contract_line_id, source, milestone_id, description, quantity, unit_price_cents, amount_cents, billable_on)
       values ($1, $2, 'milestone', $3, 'Web · A la firma', 1, 150000, 150000, '2026-09-01')`,
      [orgId, lineId, signing],
    );
    await expectHint(as(db, partner, () => db.query("select public.reschedule_milestone($1, $2::date)", [signing, "2026-09-10"])), "milestone_billed");
    await expectHint(as(db, partner, () => db.query("select public.reschedule_milestone($1, $2::date)", [delivery, null])), "date_required");
    await expectHint(
      as(db, partner, () => db.query("select public.reschedule_milestone($1, $2::date)", [randomUUID(), "2026-09-10"])),
      "milestone_not_found",
    );
  });

  it("ni un viewer ni otra org mueven un hito", async () => {
    const { milestones } = await contractWithMilestones();
    const delivery = milestones[1]!;
    await expectHint(as(db, viewer, () => db.query("select public.reschedule_milestone($1, $2::date)", [delivery, "2026-12-01"])), "milestone_not_found");
    await expectHint(as(db, intruder, () => db.query("select public.reschedule_milestone($1, $2::date)", [delivery, "2026-12-01"])), "milestone_not_found");
    await expect(as(db, null, () => db.query("select public.reschedule_milestone($1, $2::date)", [delivery, "2026-12-01"]))).rejects.toThrow(
      /permission denied/,
    );
    const stored = await one<{ planned_on: string }>("select planned_on::text from public.contract_milestones where id = $1", [delivery]);
    expect(stored.planned_on).toBe("2026-11-15");
  });

  it("la próxima acción de un deal la mueve un socio (RLS de deals), no un viewer", async () => {
    const stage = (await one<{ id: string }>("select id from public.pipeline_stages where org_id = $1 and position = 1", [orgId])).id;
    const dealId = await as(db, partner, async () =>
      (
        await one<{ id: string }>(
          "insert into public.deals (org_id, client_id, title, stage_id, next_action, next_action_on) values ($1, $2, 'Web', $3, 'Llamar', '2026-10-01') returning id",
          [orgId, clientId, stage],
        )
      ).id,
    );
    const move = (user: string, date: string) =>
      as(db, user, () => db.query("update public.deals set next_action_on = $2 where id = $1 and org_id = $3 returning id", [dealId, date, orgId]));

    expect((await move(viewer, "2026-10-05")).rows).toHaveLength(0);
    expect((await move(intruder, "2026-10-05")).rows).toHaveLength(0);
    expect((await move(partner, "2026-10-07")).rows).toHaveLength(1);
    const stored = await one<{ next_action_on: string; stages: number }>(
      "select next_action_on::text, (select count(*)::int from public.deal_stage_history where deal_id = $1) as stages from public.deals where id = $1",
      [dealId],
    );
    // Mover la fecha no toca la etapa: el historial del embudo no cambia.
    expect(stored).toEqual({ next_action_on: "2026-10-07", stages: 1 });
  });
});
