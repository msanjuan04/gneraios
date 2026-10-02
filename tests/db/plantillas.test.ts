import { beforeEach, describe, expect, it } from "vitest";
import { as, createDb, createOrg, createUser, type Db, onboardingPayload } from "./harness";

// Plantillas de presupuesto (supabase/migrations/20261002160000_plantillas_presupuesto.sql).

let db: Db;
let owner: string;
let partner: string;
let viewer: string;
let orgId: string;

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0]!;
}

const LINES = JSON.stringify([
  { description: "Web corporativa", billing_type: "one_off", quantity: 1, unit_price_cents: 180_000, discount_bps: 0, tax_rate_id: null, irpf_applies: true, billing_day: null },
  { description: "Mantenimiento", billing_type: "monthly", quantity: 1, unit_price_cents: 6_000, discount_bps: 0, tax_rate_id: null, irpf_applies: true, billing_day: null },
]);

const insertTemplate = (userId: string, name = "Web corporativa desde 1.800 €") =>
  as(db, userId, () =>
    one<{ id: string }>(
      "insert into public.quote_templates (org_id, name, category, summary, lines) values ($1, $2, 'web', 'Diseño, desarrollo y puesta en marcha', $3::jsonb) returning id",
      [orgId, name, LINES],
    ),
  );

beforeEach(async () => {
  db = await createDb();
  owner = await createUser(db, "owner@example.com");
  partner = await createUser(db, "partner@example.com");
  viewer = await createUser(db, "viewer@example.com");
  orgId = await createOrg(db, owner);
  await db.query("insert into public.members (org_id, user_id, role, full_name, initials) values ($1,$2,'partner','Socio','SO')", [orgId, partner]);
  await db.query("insert into public.members (org_id, user_id, role, full_name, initials) values ($1,$2,'viewer','Lectura','LE')", [orgId, viewer]);
});

describe("plantillas de presupuesto", () => {
  it("un socio las crea y cambia; cualquier miembro las lee; un viewer no escribe", async () => {
    const { id } = await insertTemplate(partner);
    expect((await as(db, viewer, () => db.query("select name from public.quote_templates where id = $1", [id]))).rows).toHaveLength(1);
    await expect(insertTemplate(viewer, "Otra")).rejects.toThrow(/row-level security/);
    const updated = await as(db, viewer, () => db.query("update public.quote_templates set summary = 'x' where id = $1 returning id", [id]));
    expect(updated.rows).toHaveLength(0);
    await as(db, owner, () => db.query("update public.quote_templates set category = 'ads' where id = $1", [id]));
    expect((await one<{ category: string }>("select category from public.quote_templates where id = $1", [id])).category).toBe("ads");
  });

  it("no admite dos plantillas vivas con el mismo nombre (sin distinguir mayúsculas) ni líneas vacías", async () => {
    await insertTemplate(partner, "Marketing mensual");
    await expect(insertTemplate(partner, "  marketing MENSUAL ")).rejects.toThrow(/duplicate key|unique/);
    await expect(
      as(db, partner, () => db.query("insert into public.quote_templates (org_id, name, lines) values ($1, 'Vacía', '[]'::jsonb)", [orgId])),
    ).rejects.toThrow(/check constraint/);
    // Archivada, el nombre queda libre.
    await as(db, partner, () => db.query("update public.quote_templates set archived_at = now() where org_id = $1 and name = 'Marketing mensual'", [orgId]));
    await expect(insertTemplate(partner, "Marketing mensual")).resolves.toBeDefined();
  });

  it("cada uso suma uno y una plantilla usada no se borra, solo se archiva", async () => {
    const { id } = await insertTemplate(partner);
    await as(db, partner, () => db.query("select public.quote_template_used($1)", [id]));
    await as(db, viewer, () => db.query("select public.quote_template_used($1)", [id])); // sin rol de socio: no suma
    expect((await one<{ uses_count: number }>("select uses_count from public.quote_templates where id = $1", [id])).uses_count).toBe(1);
    expect((await as(db, partner, () => db.query("delete from public.quote_templates where id = $1 returning id", [id]))).rows).toHaveLength(0);
    await as(db, partner, () => db.query("update public.quote_templates set archived_at = now() where id = $1", [id]));
    expect((await one<{ archived: boolean }>("select archived_at is not null as archived from public.quote_templates where id = $1", [id])).archived).toBe(true);
  });

  it("otra organización no ve ni toca las plantillas", async () => {
    const { id } = await insertTemplate(partner);
    const stranger = await createUser(db, "stranger@example.com");
    await createOrg(db, stranger, onboardingPayload({ org: { name: "Otra agencia", slug: "otra" }, invitations: [] }));
    expect((await as(db, stranger, () => db.query("select id from public.quote_templates where id = $1", [id]))).rows).toHaveLength(0);
    expect((await as(db, stranger, () => db.query("update public.quote_templates set name = 'x' where id = $1 returning id", [id]))).rows).toHaveLength(0);
  });
});
