import { beforeEach, describe, expect, it } from "vitest";
import { as, createDb, createOrg, createUser, type Db, onboardingPayload } from "./harness";

// Cobros sin factura (supabase/migrations/20260927160000_cobros_sin_factura.sql).

let db: Db;
let owner: string;
let viewer: string;
let orgId: string;
let clientId: string;
let otherClientId: string;

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0]!;
}

const insertReceipt = (userId: string, values: { client?: string; amount?: number; concept?: string; project?: string | null; reference?: string | null }) =>
  as(db, userId, () =>
    one<{ id: string; concept: string; reference: string | null }>(
      `insert into public.client_receipts (org_id, client_id, received_on, amount_cents, concept, project_id, reference)
       values ($1, $2, '2026-09-20', $3, $4, $5, $6) returning id, concept, reference`,
      [orgId, values.client ?? clientId, values.amount ?? 60_000, values.concept ?? "Mantenimiento de septiembre", values.project ?? null, values.reference ?? null],
    ),
  );

beforeEach(async () => {
  db = await createDb();
  owner = await createUser(db, "owner@example.com");
  viewer = await createUser(db, "viewer@example.com");
  orgId = await createOrg(db, owner);
  await db.query("insert into public.members (org_id, user_id, role, full_name, initials) values ($1, $2, 'viewer', 'Gestoría', 'GE')", [orgId, viewer]);
  clientId = (await as(db, owner, () => one<{ id: string }>("insert into public.clients (org_id, display_name) values ($1, 'Clínica Dental') returning id", [orgId]))).id;
  otherClientId = (await as(db, owner, () => one<{ id: string }>("insert into public.clients (org_id, display_name) values ($1, 'Tallers Rius') returning id", [orgId]))).id;
});

describe("cobros sin factura", () => {
  it("un socio los registra con los textos limpios y cualquier miembro los ve", async () => {
    const row = await insertReceipt(owner, { concept: "  Web corporativa  ", reference: "   " });
    expect(row.concept).toBe("Web corporativa");
    expect(row.reference).toBeNull();
    const seen = await as(db, viewer, () => db.query("select id from public.client_receipts where client_id = $1", [clientId]));
    expect(seen.rows).toHaveLength(1);
  });

  it("un viewer no puede registrarlos ni borrarlos", async () => {
    await expect(insertReceipt(viewer, {})).rejects.toThrow(/row-level security/);
    const { id } = await insertReceipt(owner, {});
    const deleted = await as(db, viewer, () => db.query("delete from public.client_receipts where id = $1 returning id", [id]));
    expect(deleted.rows).toHaveLength(0);
  });

  it("no admite importes a 0 ni conceptos vacíos; en negativo es una devolución", async () => {
    await expect(insertReceipt(owner, { amount: 0 })).rejects.toThrow(/check constraint/);
    await expect(insertReceipt(owner, { concept: "   " })).rejects.toThrow(/check constraint/);
    await expect(insertReceipt(owner, { amount: -5_000, concept: "Devolución parcial" })).resolves.toBeDefined();
  });

  it("el proyecto tiene que ser del mismo cliente", async () => {
    const project = (await as(db, owner, () => one<{ id: string }>("insert into public.projects (org_id, client_id, name) values ($1, $2, 'Web') returning id", [orgId, clientId]))).id;
    await expect(insertReceipt(owner, { project })).resolves.toBeDefined();
    await expect(insertReceipt(owner, { client: otherClientId, project })).rejects.toMatchObject({ hint: "receipt_project_client" });
  });

  it("no se cuela en otra org", async () => {
    const stranger = await createUser(db, "otra@example.com");
    const otherOrg = await createOrg(db, stranger, onboardingPayload({ org: { name: "Otra", slug: "otra" }, invitations: [] }));
    await expect(
      as(db, stranger, () =>
        db.query(
          "insert into public.client_receipts (org_id, client_id, received_on, amount_cents, concept) values ($1, $2, '2026-09-20', 1000, 'x')",
          [otherOrg, clientId],
        ),
      ),
    ).rejects.toThrow(/foreign key/);
    const seen = await as(db, stranger, () => db.query("select id from public.client_receipts"));
    expect(seen.rows).toHaveLength(0);
  });
});
