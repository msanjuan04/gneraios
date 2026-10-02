import { beforeEach, describe, expect, it } from "vitest";
import { as, createDb, createOrg, createUser, type Db } from "./harness";

let db: Db;
let owner: string;
let partner: string;
let viewer: string;
let orgId: string;
let memberId: string;

async function one<T>(sql: string, params: unknown[] = []) {
  return (await db.query<T>(sql, params)).rows[0]!;
}

beforeEach(async () => {
  db = await createDb();
  owner = await createUser(db, "owner@example.com");
  partner = await createUser(db, "partner@example.com");
  viewer = await createUser(db, "viewer@example.com");
  orgId = await createOrg(db, owner);
  memberId = (await one<{ id: string }>("select id from public.members where org_id = $1 and user_id = $2", [orgId, owner])).id;
  await db.query("insert into public.members (org_id, user_id, role, full_name, initials) values ($1,$2,'partner','Socio','SO')", [orgId, partner]);
  await db.query("insert into public.members (org_id, user_id, role, full_name, initials) values ($1,$2,'viewer','Lectura','LE')", [orgId, viewer]);
});

describe("movimientos internos de socios", () => {
  it("permite registrar, limita aprobación a owner y bloquea reescritura después de aprobar", async () => {
    await expect(as(db, partner, () => db.query(
      `insert into public.partner_movements (org_id, member_id, kind, status, amount_cents, effective_on)
       values ($1, $2, 'partner_loan', 'paid', 125000, '2026-09-01')`, [orgId, memberId],
    ))).rejects.toMatchObject({ hint: "partner_movement_transition" });
    const record = await as(db, partner, () => one<{ id: string }>(
      `insert into public.partner_movements (org_id, member_id, kind, amount_cents, effective_on, notes)
       values ($1, $2, 'partner_loan', 125000, '2026-09-01', 'Préstamo pendiente de revisar') returning id`, [orgId, memberId],
    ));
    // Información societaria: la leen los socios; un viewer (gestoría, colaborador) no la ve.
    expect((await as(db, viewer, () => db.query("select id from public.partner_movements where id = $1", [record.id]))).rows).toHaveLength(0);
    expect((await as(db, owner, () => db.query("select id from public.partner_movements where id = $1", [record.id]))).rows).toHaveLength(1);
    await expect(as(db, owner, () => db.query("update public.partner_movements set created_by = $2 where id = $1", [record.id, owner]))).rejects.toMatchObject({ hint: "partner_movement_identity_immutable" });
    expect((await as(db, partner, () => db.query("update public.partner_movements set status = 'approved' where id = $1 returning id", [record.id]))).rows).toHaveLength(0);
    await expect(as(db, owner, () => db.query("update public.partner_movements set status = 'paid' where id = $1", [record.id]))).rejects.toMatchObject({ hint: "partner_movement_transition" });
    await as(db, owner, () => db.query("update public.partner_movements set status = 'approved' where id = $1", [record.id]));
    await expect(as(db, owner, () => db.query("update public.partner_movements set amount_cents = 200000 where id = $1", [record.id]))).rejects.toMatchObject({ hint: "partner_movement_immutable" });
    await as(db, owner, () => db.query("update public.partner_movements set status = 'paid' where id = $1", [record.id]));
    await expect(as(db, owner, () => db.query("update public.partner_movements set status = 'void' where id = $1", [record.id]))).rejects.toMatchObject({ hint: "partner_movement_immutable" });
    expect((await one<{ count: number }>("select count(*)::int as count from public.audit_log where table_name = 'partner_movements' and record_id = $1", [record.id])).count).toBe(3);
  });
});
