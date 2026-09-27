import { beforeEach, describe, expect, it } from "vitest";
import { as, createDb, createOrg, createUser, type Db, onboardingPayload } from "./harness";

// Coste interno por hora (member_costs): lo leen los socios, lo escribe un owner, un viewer no lo
// ve y otra org tampoco. El coste que toca a cada registro de horas se deriva en TS
// (src/domain/profitability/costs.ts); aquí, las barreras y los invariantes.

let db: Db;
let owner: string;
let partner: string;
let viewer: string;
let intruder: string;
let orgId: string;
let otherOrgId: string;
let members: { owner: string; partner: string; viewer: string; intruder: string };

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0]!;
}

async function all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

async function addMember(userId: string, role: "viewer" | "partner", initials: string): Promise<string> {
  return (
    await one<{ id: string }>(
      "insert into public.members (org_id, user_id, role, full_name, initials) values ($1, $2, $3, 'Socio', $4) returning id",
      [orgId, userId, role, initials],
    )
  ).id;
}

async function addCost(user: string, values: { member?: string; cents?: number; from?: string; org?: string } = {}): Promise<string> {
  return as(db, user, async () =>
    (
      await one<{ id: string }>(
        "insert into public.member_costs (org_id, member_id, hourly_cost_cents, valid_from) values ($1, $2, $3, $4) returning id",
        [values.org ?? orgId, values.member ?? members.partner, values.cents ?? 3500, values.from ?? "2026-01-01"],
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
  members = {
    owner: (await one<{ id: string }>("select id from public.members where org_id = $1 and user_id = $2", [orgId, owner])).id,
    partner: await addMember(partner, "partner", "PA"),
    viewer: await addMember(viewer, "viewer", "VI"),
    intruder: (await one<{ id: string }>("select id from public.members where org_id = $1", [otherOrgId])).id,
  };
});

describe("coste interno por hora (member_costs)", () => {
  it("un owner lo escribe; los socios lo leen; un viewer y otra org no ven nada; anon, ni la tabla", async () => {
    await addCost(owner, { member: members.partner, cents: 3200, from: "2026-01-01" });
    await addCost(owner, { member: members.partner, cents: 3600, from: "2026-07-01" });
    await addCost(owner, { member: members.owner, cents: 4000, from: "2026-01-01" });

    const read = (user: string) =>
      as(db, user, () => all<{ cents: number }>("select hourly_cost_cents as cents from public.member_costs order by valid_from, hourly_cost_cents"));
    expect(await read(owner)).toEqual([{ cents: 3200 }, { cents: 4000 }, { cents: 3600 }]);
    expect(await read(partner)).toHaveLength(3);
    // Un viewer ve las horas, pero no lo que cuestan.
    expect(await read(viewer)).toEqual([]);
    expect(await read(intruder)).toEqual([]);
    await expect(as(db, null, () => db.query("select id from public.member_costs"))).rejects.toThrow(/permission denied/);
  });

  it("ni un socio ni un viewer lo escriben (ni altas, ni cambios, ni bajas)", async () => {
    const id = await addCost(owner);
    await expect(addCost(partner, { from: "2026-02-01" })).rejects.toThrow(/row-level security/);
    await expect(addCost(viewer, { from: "2026-02-01" })).rejects.toThrow(/row-level security/);

    // Sin permiso, el UPDATE y el DELETE no encuentran la fila: no cambian nada.
    await as(db, partner, () => db.query("update public.member_costs set hourly_cost_cents = 1 where id = $1", [id]));
    await as(db, partner, () => db.query("delete from public.member_costs where id = $1", [id]));
    await as(db, viewer, () => db.query("delete from public.member_costs where id = $1", [id]));
    expect((await one<{ cents: number }>("select hourly_cost_cents as cents from public.member_costs where id = $1", [id])).cents).toBe(3500);

    // El owner sí lo corrige y lo borra.
    await as(db, owner, () => db.query("update public.member_costs set hourly_cost_cents = 3700 where id = $1", [id]));
    expect((await one<{ cents: number }>("select hourly_cost_cents as cents from public.member_costs where id = $1", [id])).cents).toBe(3700);
    await as(db, owner, () => db.query("delete from public.member_costs where id = $1", [id]));
    expect(await all("select id from public.member_costs")).toEqual([]);
  });

  it("otra org no escribe en esta, ni con sus miembros ni con los de aquí", async () => {
    // El owner de otra org no es owner aquí.
    await expect(addCost(intruder, { member: members.partner })).rejects.toThrow(/row-level security/);
    // Un miembro de otra org no sirve (FK compuesta con la org).
    await expect(addCost(owner, { member: members.intruder })).rejects.toMatchObject({ code: "23503" });
    // Y en su propia org no puede usar a los miembros de esta.
    await expect(addCost(intruder, { org: otherOrgId, member: members.partner })).rejects.toMatchObject({ code: "23503" });
    // En su org, con los suyos, sí.
    await addCost(intruder, { org: otherOrgId, member: members.intruder });
    expect(await as(db, owner, () => all("select id from public.member_costs"))).toEqual([]);
  });

  it("uno por persona y día (guardar otro el mismo día es corregirlo); importes enteros de 0 a 1.000 €/h", async () => {
    await addCost(owner, { from: "2026-03-01", cents: 3000 });
    await expect(addCost(owner, { from: "2026-03-01", cents: 3100 })).rejects.toMatchObject({ code: "23505" });
    // Lo que hace la app: upsert por (org, miembro, día).
    await as(db, owner, () =>
      db.query(
        `insert into public.member_costs (org_id, member_id, hourly_cost_cents, valid_from) values ($1, $2, 3100, '2026-03-01')
         on conflict (org_id, member_id, valid_from) do update set hourly_cost_cents = excluded.hourly_cost_cents`,
        [orgId, members.partner],
      ),
    );
    expect(await all("select hourly_cost_cents::int as cents from public.member_costs")).toEqual([{ cents: 3100 }]);

    // Otra persona el mismo día, u otro día de la misma persona: sin problema.
    await addCost(owner, { member: members.owner, from: "2026-03-01" });
    await addCost(owner, { from: "2026-04-01" });

    await addCost(owner, { from: "2026-05-01", cents: 0 });
    await addCost(owner, { from: "2026-06-01", cents: 100_000 });
    await expect(addCost(owner, { from: "2026-07-01", cents: -1 })).rejects.toMatchObject({ code: "23514" });
    await expect(addCost(owner, { from: "2026-07-01", cents: 100_001 })).rejects.toMatchObject({ code: "23514" });
    await expect(addCost(owner, { from: "1999-12-31" })).rejects.toMatchObject({ code: "23514" });
  });

  it("se audita, y la auditoría (con los importes) solo la leen los owners", async () => {
    const id = await addCost(owner, { cents: 3300 });
    await as(db, owner, () => db.query("update public.member_costs set hourly_cost_cents = 3400 where id = $1", [id]));
    const audit = await as(db, owner, () =>
      all<{ action: string }>("select action from public.audit_log where table_name = 'member_costs' and record_id = $1 order by id", [id]),
    );
    expect(audit.map((a) => a.action)).toEqual(["insert", "update"]);
    for (const user of [partner, viewer]) {
      expect(await as(db, user, () => all("select id from public.audit_log where table_name = 'member_costs'"))).toEqual([]);
    }
  });

  it("created_by es quien lo guarda y updated_at se mueve al corregirlo", async () => {
    const id = await addCost(owner);
    const before = await one<{ created_by: string; updated_at: string }>(
      "select created_by, updated_at::text from public.member_costs where id = $1",
      [id],
    );
    expect(before.created_by).toBe(owner);
    await as(db, owner, () => db.query("update public.member_costs set hourly_cost_cents = 3900 where id = $1", [id]));
    const after = await one<{ updated_at: string }>("select updated_at::text from public.member_costs where id = $1", [id]);
    expect(after.updated_at >= before.updated_at).toBe(true);
  });
});
