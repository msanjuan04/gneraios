import { beforeEach, describe, expect, it } from "vitest";
import { as, createDb, createOrg, createUser, type Db, onboardingPayload } from "./harness";

// Bóveda de contraseñas (supabase/migrations/20261003100000_contrasenas.sql). Lo que se guarda aquí
// ya viene cifrado del navegador: estos tests comprueban quién puede leer y escribir qué.

let db: Db;
let owner: string;
let partner: string;
let viewer: string;
let orgId: string;
let ownerMember: string;
let partnerMember: string;

const KEY = "A".repeat(400);
const WRAPPED = "B".repeat(344);

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0]!;
}

const memberId = async (userId: string) =>
  (await one<{ id: string }>("select id from public.members where org_id = $1 and user_id = $2", [orgId, userId])).id;

/** Registra el par de claves de un miembro, como hace la app al crear su contraseña maestra. */
const registerKeys = (user: string) =>
  as(db, user, () =>
    db.query(
      `insert into public.vault_keys (org_id, member_id, public_key, private_key_ciphertext, kdf_salt, kdf_iterations)
       values ($1, private.current_member_id($1), $2, $3, $4, 600000)`,
      [orgId, KEY, `iv.${"C".repeat(200)}`, "D".repeat(24)],
    ),
  );

const grant = (user: string, member: string) =>
  as(db, user, () =>
    db.query("insert into public.vault_grants (org_id, member_id, wrapped_key, granted_by) values ($1, $2, $3, private.current_member_id($1)) returning member_id", [orgId, member, WRAPPED]),
  );

const addItem = (user: string) =>
  as(db, user, () => db.query("insert into public.vault_items (org_id, ciphertext) values ($1, $2) returning id", [orgId, `iv.${"E".repeat(60)}`]));

beforeEach(async () => {
  db = await createDb();
  owner = await createUser(db, "owner@example.com");
  partner = await createUser(db, "partner@example.com");
  viewer = await createUser(db, "viewer@example.com");
  orgId = await createOrg(db, owner);
  await db.query("insert into public.members (org_id, user_id, role, full_name, initials) values ($1,$2,'partner','Socio','SO')", [orgId, partner]);
  await db.query("insert into public.members (org_id, user_id, role, full_name, initials) values ($1,$2,'viewer','Gestoría','GE')", [orgId, viewer]);
  ownerMember = await memberId(owner);
  partnerMember = await memberId(partner);
});

describe("claves de cada miembro", () => {
  it("cada uno registra solo las suyas; los socios ven las públicas de los demás", async () => {
    await registerKeys(owner);
    // Nadie puede colar una clave a nombre de otro.
    await expect(
      as(db, partner, () =>
        db.query(
          `insert into public.vault_keys (org_id, member_id, public_key, private_key_ciphertext, kdf_salt, kdf_iterations)
           values ($1, $2, $3, 'iv.x', 'sal', 600000)`,
          [orgId, ownerMember, KEY],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    // Un socio sí ve la pública del otro: la necesita para darle acceso.
    expect((await as(db, partner, () => db.query("select public_key from public.vault_keys where org_id = $1", [orgId]))).rows).toHaveLength(1);
    // Un viewer no pinta nada en la bóveda.
    expect((await as(db, viewer, () => db.query("select public_key from public.vault_keys where org_id = $1", [orgId]))).rows).toHaveLength(0);
  });

  it("se puede cambiar la contraseña maestra (reescribir la clave privada cifrada), pero solo la propia", async () => {
    await registerKeys(owner);
    await registerKeys(partner);
    const otra = `iv.${"F".repeat(200)}`;
    expect(
      (await as(db, owner, () => db.query("update public.vault_keys set private_key_ciphertext = $2 where member_id = $1 returning member_id", [ownerMember, otra]))).rows,
    ).toHaveLength(1);
    expect(
      (await as(db, owner, () => db.query("update public.vault_keys set private_key_ciphertext = $2 where member_id = $1 returning member_id", [partnerMember, otra]))).rows,
    ).toHaveLength(0);
  });
});

describe("quién tiene la llave", () => {
  it("el primero crea la bóveda; después solo reparte quien ya tiene acceso", async () => {
    await registerKeys(owner);
    await registerKeys(partner);
    // El socio no puede darse acceso a sí mismo cuando la bóveda aún no existe... sí puede: es el primero.
    expect((await grant(partner, partnerMember)).rows).toHaveLength(1);
    // Ahora que existe, el owner (sin sobre) no puede dárselo a sí mismo.
    await expect(grant(owner, ownerMember)).rejects.toThrow(/row-level security/);
    // Quien tiene la llave sí reparte.
    expect((await grant(partner, ownerMember)).rows).toHaveLength(1);
  });

  it("un owner quita el acceso a cualquiera; cada uno puede renunciar al suyo", async () => {
    await registerKeys(owner);
    await registerKeys(partner);
    await grant(owner, ownerMember);
    await grant(owner, partnerMember);
    expect((await as(db, partner, () => db.query("delete from public.vault_grants where member_id = $1 returning member_id", [ownerMember]))).rows).toHaveLength(0);
    expect((await as(db, partner, () => db.query("delete from public.vault_grants where member_id = $1 returning member_id", [partnerMember]))).rows).toHaveLength(1);
    expect((await as(db, owner, () => db.query("delete from public.vault_grants where member_id = $1 returning member_id", [ownerMember]))).rows).toHaveLength(1);
  });
});

describe("los secretos", () => {
  it("solo los lee y escribe quien tiene sobre", async () => {
    await registerKeys(owner);
    await registerKeys(partner);
    await grant(owner, ownerMember);
    await addItem(owner);

    expect((await as(db, owner, () => db.query("select id from public.vault_items where org_id = $1", [orgId]))).rows).toHaveLength(1);
    // El socio tiene claves pero no sobre: no ve ni los textos cifrados.
    expect((await as(db, partner, () => db.query("select id from public.vault_items where org_id = $1", [orgId]))).rows).toHaveLength(0);
    await expect(addItem(partner)).rejects.toThrow(/row-level security/);
    // Con el sobre, ya.
    await grant(owner, partnerMember);
    expect((await as(db, partner, () => db.query("select id from public.vault_items where org_id = $1", [orgId]))).rows).toHaveLength(1);
  });

  it("otra organización no ve nada, aunque su gente tenga bóveda", async () => {
    await registerKeys(owner);
    await grant(owner, ownerMember);
    await addItem(owner);
    const stranger = await createUser(db, "stranger@example.com");
    await createOrg(db, stranger, onboardingPayload({ org: { name: "Otra", slug: "otra" }, invitations: [] }));
    await as(db, stranger, async () => {
      for (const table of ["vault_keys", "vault_grants", "vault_items"]) {
        expect((await db.query(`select * from public.${table}`)).rows, table).toHaveLength(0);
      }
    });
  });

  it("el texto cifrado tiene que parecerlo (no se cuela una contraseña en claro de dos letras)", async () => {
    await registerKeys(owner);
    await grant(owner, ownerMember);
    await expect(as(db, owner, () => db.query("insert into public.vault_items (org_id, ciphertext) values ($1, 'hola')", [orgId]))).rejects.toThrow(/check constraint/);
  });
});
