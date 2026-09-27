import { beforeEach, describe, expect, it } from "vitest";
import { as, createDb, createOrg, createUser, type Db } from "./harness";

let db: Db;
let owner: string;
let partner: string;
let orgId: string;
let partnerMember: string;

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0]!;
}

async function clientsSeen(user: string, aal?: "aal1" | "aal2"): Promise<number> {
  return as(db, user, async () => (await one<{ n: number }>("select count(*)::int as n from public.clients")).n, aal ? { aal } : {});
}

beforeEach(async () => {
  db = await createDb();
  owner = await createUser(db, "owner@example.com");
  partner = await createUser(db, "partner@example.com");
  orgId = await createOrg(db, owner);
  partnerMember = (
    await one<{ id: string }>(
      "insert into public.members (org_id, user_id, role, full_name, initials) values ($1, $2, 'partner', 'Socio', 'PA') returning id",
      [orgId, partner],
    )
  ).id;
  await as(db, owner, () => db.query("insert into public.clients (org_id, display_name) values ($1, 'Clínica Dental')", [orgId]));
});

describe("verificación en dos pasos exigida por la org", () => {
  it("sin exigirla, una sesión de un solo paso ve lo suyo como siempre", async () => {
    expect(await clientsSeen(partner)).toBe(1);
    expect(await clientsSeen(partner, "aal1")).toBe(1);
  });

  it("exigida, una sesión sin el segundo paso no ve ni toca nada; con él, sí", async () => {
    await as(db, owner, () => db.query("update public.orgs set require_mfa = true where id = $1", [orgId]), { aal: "aal2" });
    expect(await clientsSeen(partner, "aal1")).toBe(0);
    expect(await clientsSeen(partner)).toBe(0);
    expect(await clientsSeen(partner, "aal2")).toBe(1);
    await expect(
      as(db, partner, () => db.query("insert into public.clients (org_id, display_name) values ($1, 'Otra')", [orgId]), { aal: "aal1" }),
    ).rejects.toThrow(/row-level security/);
  });

  it("no se puede activar desde una sesión que no ha pasado el segundo paso (nadie se queda fuera)", async () => {
    await expect(
      as(db, owner, () => db.query("update public.orgs set require_mfa = true where id = $1", [orgId]), { aal: "aal1" }),
    ).rejects.toMatchObject({ hint: "mfa_required_to_enable" });
    // El servidor (sin JWT de usuario) sí puede.
    await db.query("update public.orgs set require_mfa = true where id = $1", [orgId]);
    expect((await one<{ require_mfa: boolean }>("select require_mfa from public.orgs where id = $1", [orgId])).require_mfa).toBe(true);
  });

  it("un owner cierra las sesiones de un miembro; un socio no puede", async () => {
    await db.query("insert into auth.sessions (user_id) values ($1), ($1)", [partner]);
    await expect(
      as(db, partner, () => db.query("select public.revoke_member_sessions($1, $2)", [orgId, partnerMember])),
    ).rejects.toMatchObject({ hint: "owner_required" });
    const closed = await as(db, owner, async () =>
      (await one<{ n: number }>("select public.revoke_member_sessions($1, $2) as n", [orgId, partnerMember])).n,
    );
    expect(closed).toBe(2);
    expect((await one<{ n: number }>("select count(*)::int as n from auth.sessions")).n).toBe(0);
  });
});
