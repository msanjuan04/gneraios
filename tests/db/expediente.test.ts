import { beforeEach, describe, expect, it } from "vitest";
import { as, createDb, createOrg, createUser, type Db, onboardingPayload } from "./harness";

// Expediente de la sociedad (supabase/migrations/20261002180000_expediente_sociedad.sql).

let db: Db;
let owner: string;
let partner: string;
let viewer: string;
let orgId: string;

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0]!;
}

const SHA = "a".repeat(64);
const insertDoc = (userId: string, title = "DUE GNERAI PARTNERS, S.L.") =>
  as(db, userId, () =>
    one<{ id: string }>(
      `insert into public.org_documents (org_id, category, status, title, effective_on, storage_path, file_name, content_type, size_bytes, sha256)
       values ($1::uuid, 'constitution', 'filed', $2, '2026-10-01', $1::text || '/doc/' || $3 || '.pdf', 'DUE.pdf', 'application/pdf', 1234, $3) returning id`,
      [orgId, title, SHA],
    ),
  );

beforeEach(async () => {
  db = await createDb();
  owner = await createUser(db, "owner@example.com");
  partner = await createUser(db, "partner@example.com");
  viewer = await createUser(db, "viewer@example.com");
  orgId = await createOrg(db, owner);
  await db.query("insert into public.members (org_id, user_id, role, full_name, initials) values ($1,$2,'partner','Socio','SO')", [orgId, partner]);
  await db.query("insert into public.members (org_id, user_id, role, full_name, initials) values ($1,$2,'viewer','Gestoría','GE')", [orgId, viewer]);
});

describe("expediente de la sociedad", () => {
  it("lo suben y cambian los socios; un viewer no lo ve; archivar es de owner", async () => {
    const { id } = await insertDoc(partner);
    expect((await as(db, viewer, () => db.query("select id from public.org_documents where id = $1", [id]))).rows).toHaveLength(0);
    expect((await as(db, partner, () => db.query("select id from public.org_documents where id = $1", [id]))).rows).toHaveLength(1);
    await as(db, partner, () => db.query("update public.org_documents set status = 'registered', effective_on = '2026-10-15' where id = $1", [id]));
    expect((await one<{ status: string }>("select status from public.org_documents where id = $1", [id])).status).toBe("registered");
    expect((await as(db, partner, () => db.query("delete from public.org_documents where id = $1 returning id", [id]))).rows).toHaveLength(0);
    expect((await as(db, owner, () => db.query("delete from public.org_documents where id = $1 returning id", [id]))).rows).toHaveLength(1);
  });

  it("el fichero de un documento no se cambia (ruta, huella, tamaño): otro fichero es otro documento", async () => {
    const { id } = await insertDoc(partner);
    await expect(as(db, partner, () => db.query("update public.org_documents set sha256 = $2 where id = $1", [id, "b".repeat(64)]))).rejects.toMatchObject({ hint: "org_document_file_immutable" });
    await expect(as(db, partner, () => db.query("update public.org_documents set storage_path = $2 where id = $1", [id, `${orgId}/otro.pdf`]))).rejects.toMatchObject({ hint: "org_document_file_immutable" });
  });

  it("la ruta tiene que ser de la org y la huella un SHA-256", async () => {
    await expect(
      as(db, partner, () => db.query(
        `insert into public.org_documents (org_id, title, storage_path, file_name, content_type, size_bytes, sha256)
         values ($1::uuid, 'Fuera', 'otra-org/doc.pdf', 'x.pdf', 'application/pdf', 1, $2)`, [orgId, SHA])),
    ).rejects.toThrow(/check constraint/);
    await expect(
      as(db, partner, () => db.query(
        `insert into public.org_documents (org_id, title, storage_path, file_name, content_type, size_bytes, sha256)
         values ($1::uuid, 'Mal hash', $1::text || '/doc.pdf', 'x.pdf', 'application/pdf', 1, 'zz')`, [orgId])),
    ).rejects.toThrow(/check constraint/);
  });

  it("otra organización no ve ni toca el expediente", async () => {
    const { id } = await insertDoc(partner);
    const stranger = await createUser(db, "stranger@example.com");
    await createOrg(db, stranger, onboardingPayload({ org: { name: "Otra", slug: "otra" }, invitations: [] }));
    expect((await as(db, stranger, () => db.query("select id from public.org_documents where id = $1", [id]))).rows).toHaveLength(0);
    expect((await as(db, stranger, () => db.query("update public.org_documents set title = 'x' where id = $1 returning id", [id]))).rows).toHaveLength(0);
  });
});
