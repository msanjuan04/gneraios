import { beforeEach, describe, expect, it } from "vitest";
import { as, createDb, createOrg, createUser, type Db, onboardingPayload } from "./harness";

// Bóveda de contraseñas con una sola contraseña de equipo (supabase/migrations/20261003100000 y
// 20261003150000). Lo que se guarda aquí ya viene cifrado del navegador: estos tests comprueban
// quién puede leer y escribir qué, y que lo guardado no permite abrir nada por sí solo.

let db: Db;
let owner: string;
let partner: string;
let viewer: string;
let orgId: string;

const SEALED = `iv.${"A".repeat(60)}`;

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0]!;
}

const createVault = (user: string) =>
  as(db, user, () =>
    db.query(
      `insert into public.vault_settings (org_id, kdf_salt, kdf_iterations, verifier, rotated_by)
       values ($1, $2, 600000, $3, private.current_member_id($1)) returning org_id`,
      [orgId, "S".repeat(24), SEALED],
    ),
  );

const addItem = (user: string) =>
  as(db, user, () => db.query("insert into public.vault_items (org_id, ciphertext) values ($1, $2) returning id", [orgId, SEALED]));

beforeEach(async () => {
  db = await createDb();
  owner = await createUser(db, "owner@example.com");
  partner = await createUser(db, "partner@example.com");
  viewer = await createUser(db, "viewer@example.com");
  orgId = await createOrg(db, owner);
  await db.query("insert into public.members (org_id, user_id, role, full_name, initials) values ($1,$2,'partner','Socio','SO')", [orgId, partner]);
  await db.query("insert into public.members (org_id, user_id, role, full_name, initials) values ($1,$2,'viewer','Gestoría','GE')", [orgId, viewer]);
});

describe("la contraseña del equipo", () => {
  it("la crea cualquier socio y solo hay una por organización", async () => {
    expect((await createVault(partner)).rows).toHaveLength(1);
    await expect(createVault(owner)).rejects.toThrow(/duplicate key|unique/i);
  });

  it("un viewer ni la crea ni ve sus parámetros", async () => {
    await createVault(owner);
    await expect(createVault(viewer)).rejects.toThrow(/row-level security|duplicate key|unique/i);
    expect((await as(db, viewer, () => db.query("select kdf_salt from public.vault_settings where org_id = $1", [orgId]))).rows).toHaveLength(0);
  });

  it("lo guardado no incluye la contraseña: solo la sal, las iteraciones y una prueba cifrada", async () => {
    await createVault(owner);
    const row = await one<{ kdf_salt: string; kdf_iterations: number; verifier: string }>(
      "select kdf_salt, kdf_iterations, verifier from public.vault_settings where org_id = $1",
      [orgId],
    );
    expect(row.kdf_iterations).toBeGreaterThanOrEqual(100_000);
    expect(row.verifier).toBe(SEALED);
    // Nada legible: el verificador es un texto cifrado como cualquier otro.
    expect(row.verifier).not.toMatch(/contraseñ|password/i);
  });

  it("cambiarla es cosa de socios y queda apuntado quién y cuándo", async () => {
    await createVault(owner);
    expect(
      (await as(db, partner, () =>
        db.query("update public.vault_settings set kdf_salt = $2, verifier = $3, rotated_at = now(), rotated_by = private.current_member_id($1) where org_id = $1 returning rotated_by", [orgId, "T".repeat(24), SEALED]),
      )).rows,
    ).toHaveLength(1);
    expect((await as(db, viewer, () => db.query("update public.vault_settings set kdf_salt = $2 where org_id = $1 returning org_id", [orgId, "U".repeat(24)]))).rows).toHaveLength(0);
  });
});

describe("los secretos", () => {
  it("los ven y los escriben los socios; un viewer no", async () => {
    await createVault(owner);
    await addItem(owner);
    expect((await as(db, partner, () => db.query("select id from public.vault_items where org_id = $1", [orgId]))).rows).toHaveLength(1);
    expect((await as(db, viewer, () => db.query("select id from public.vault_items where org_id = $1", [orgId]))).rows).toHaveLength(0);
    await expect(addItem(viewer)).rejects.toThrow(/row-level security/);
  });

  it("solo un owner los borra; un socio los archiva", async () => {
    await createVault(owner);
    const { rows } = await addItem(owner);
    const id = (rows[0] as { id: string }).id;
    expect((await as(db, partner, () => db.query("delete from public.vault_items where id = $1 returning id", [id]))).rows).toHaveLength(0);
    expect((await as(db, partner, () => db.query("update public.vault_items set archived_at = now() where id = $1 returning id", [id]))).rows).toHaveLength(1);
    expect((await as(db, owner, () => db.query("delete from public.vault_items where id = $1 returning id", [id]))).rows).toHaveLength(1);
  });

  it("otra organización no ve nada, aunque tenga su propia bóveda", async () => {
    await createVault(owner);
    await addItem(owner);
    const stranger = await createUser(db, "stranger@example.com");
    await createOrg(db, stranger, onboardingPayload({ org: { name: "Otra", slug: "otra" }, invitations: [] }));
    await as(db, stranger, async () => {
      for (const table of ["vault_settings", "vault_items"]) {
        expect((await db.query(`select * from public.${table}`)).rows, table).toHaveLength(0);
      }
    });
  });

  it("el texto cifrado tiene que parecerlo (no se cuela una contraseña en claro de dos letras)", async () => {
    await createVault(owner);
    await expect(as(db, owner, () => db.query("insert into public.vault_items (org_id, ciphertext) values ($1, 'hola')", [orgId]))).rejects.toThrow(/check constraint/);
  });
});
