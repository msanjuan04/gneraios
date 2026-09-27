import { beforeEach, describe, expect, it } from "vitest";
import { as, createDb, createOrg, createUser, type Db, onboardingPayload } from "./harness";

let db: Db;
let owner: string;
let partner: string;
let intruder: string;
let orgId: string;
let otherOrgId: string;
let members: { owner: string; partner: string };

const KEY = "B".repeat(87);
const AUTH = "a".repeat(22);

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0]!;
}

async function register(user: string, endpoint: string, org = orgId): Promise<string> {
  return as(db, user, async () =>
    (
      await one<{ id: string }>("select public.register_push_subscription($1, $2, $3, $4, 'Safari iOS') as id", [
        org,
        endpoint,
        KEY,
        AUTH,
      ])
    ).id,
  );
}

beforeEach(async () => {
  db = await createDb();
  owner = await createUser(db, "owner@example.com");
  partner = await createUser(db, "partner@example.com");
  intruder = await createUser(db, "intruder@example.com");
  orgId = await createOrg(db, owner);
  otherOrgId = await createOrg(db, intruder, onboardingPayload({ org: { name: "Otra", slug: "otra" }, invitations: [] }));
  members = {
    owner: (await one<{ id: string }>("select id from public.members where org_id = $1 and user_id = $2", [orgId, owner])).id,
    partner: (
      await one<{ id: string }>(
        "insert into public.members (org_id, user_id, role, full_name, initials) values ($1, $2, 'partner', 'Socio', 'PA') returning id",
        [orgId, partner],
      )
    ).id,
  };
});

describe("suscripciones push", () => {
  it("cada miembro da de alta su dispositivo y solo ve los suyos", async () => {
    await register(owner, "https://push.example/owner");
    await register(partner, "https://push.example/partner");

    const seen = await as(db, partner, async () =>
      (await db.query<{ member_id: string; endpoint: string }>("select member_id, endpoint from public.push_subscriptions")).rows,
    );
    expect(seen).toEqual([{ member_id: members.partner, endpoint: "https://push.example/partner" }]);

    // Las claves del navegador no se leen desde el cliente.
    await expect(as(db, partner, () => db.query("select p256dh from public.push_subscriptions"))).rejects.toThrow(/permission denied/);
    // Ni se escribe directamente.
    await expect(
      as(db, partner, () =>
        db.query("insert into public.push_subscriptions (org_id, member_id, endpoint, p256dh, auth_secret) values ($1, $2, 'https://x', $3, $4)", [
          orgId,
          members.partner,
          KEY,
          AUTH,
        ]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("el mismo navegador pasa al último miembro que se suscribe y reinicia los fallos", async () => {
    const first = await register(owner, "https://push.example/shared");
    await db.query("update public.push_subscriptions set failure_count = 3 where id = $1", [first]);
    const second = await register(partner, "https://push.example/shared");
    expect(second).toBe(first);
    const row = await one<{ member_id: string; failure_count: number }>(
      "select member_id, failure_count from public.push_subscriptions where id = $1",
      [first],
    );
    expect(row).toEqual({ member_id: members.partner, failure_count: 0 });
  });

  it("quien no es miembro no se suscribe, y el endpoint tiene que ser https", async () => {
    await expect(register(intruder, "https://push.example/i")).rejects.toMatchObject({ hint: "not_a_member" });
    await expect(register(partner, "https://push.example/p", otherOrgId)).rejects.toMatchObject({ hint: "not_a_member" });
    await expect(register(partner, "http://push.example/p")).rejects.toThrow(/check constraint/);
  });

  it("dar de baja solo borra el dispositivo propio", async () => {
    await register(owner, "https://push.example/owner");
    await as(db, partner, () => db.query("select public.unregister_push_subscription($1, 'https://push.example/owner')", [orgId]));
    expect((await one<{ n: number }>("select count(*)::int as n from public.push_subscriptions")).n).toBe(1);
    await as(db, owner, () => db.query("select public.unregister_push_subscription($1, 'https://push.example/owner')", [orgId]));
    expect((await one<{ n: number }>("select count(*)::int as n from public.push_subscriptions")).n).toBe(0);
  });
});
