import { beforeEach, describe, expect, it } from "vitest";
import { as, createDb, createOrg, createUser, type Db, onboardingPayload } from "./harness";

// Cuentas publicitarias y caché (supabase/migrations/20261002200000_ads_cuentas.sql).

let db: Db;
let owner: string;
let partner: string;
let viewer: string;
let orgId: string;

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0]!;
}

/** Como el servidor (service_role): el alta guarda la credencial cifrada. */
const insertAccount = (provider: string, ownerClient: string | null = null, label = "Cuenta") =>
  one<{ id: string }>(
    `insert into public.ads_accounts (org_id, provider, label, owner_client_id, external_account_id, credential_ciphertext)
     values ($1, $2::public.ads_provider, $3, $4, 'act_1', 'v1.sealed') returning id`,
    [orgId, provider, label, ownerClient],
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

describe("cuentas publicitarias", () => {
  it("los miembros ven la cuenta pero nunca la credencial cifrada", async () => {
    const { id } = await insertAccount("meta");
    const visible = await as(db, viewer, () => db.query("select id, label, provider from public.ads_accounts where id = $1", [id]));
    expect(visible.rows).toHaveLength(1);
    await expect(as(db, viewer, () => db.query("select credential_ciphertext from public.ads_accounts where id = $1", [id]))).rejects.toThrow(/permission denied/);
    await expect(as(db, partner, () => db.query("select developer_token_ciphertext from public.ads_accounts where id = $1", [id]))).rejects.toThrow(/permission denied/);
  });

  it("una conexión por plataforma y dueño: la agencia y cada cliente, por separado", async () => {
    const client = (await one<{ id: string }>("insert into public.clients (org_id, display_name) values ($1, 'Terrazea') returning id", [orgId])).id;
    await insertAccount("meta");
    await expect(insertAccount("meta")).rejects.toThrow(/ads_accounts_one_per_owner_idx/);
    await insertAccount("meta", client);
    await expect(insertAccount("meta", client, "Otra")).rejects.toThrow(/ads_accounts_one_per_owner_idx/);
    // Google y YouTube comparten la conexión de Google: una sola fila por dueño.
    await db.query(
      `insert into public.ads_accounts (org_id, provider, label, external_account_id, developer_token_ciphertext) values ($1, 'google', 'Google', '1234567890', 'v1.sealed')`,
      [orgId],
    );
    expect((await one<{ n: string }>("select count(*)::text as n from public.ads_accounts where org_id = $1", [orgId])).n).toBe("3");
  });

  it("solo Google puede nacer sin credencial (hasta conectar) y solo Google lleva developer token", async () => {
    await expect(db.query("insert into public.ads_accounts (org_id, provider, label, external_account_id) values ($1, 'meta', 'Meta', 'act_1')", [orgId])).rejects.toThrow(/check constraint/);
    await expect(db.query("insert into public.ads_accounts (org_id, provider, label, external_account_id, credential_ciphertext, developer_token_ciphertext) values ($1, 'linkedin', 'Li', '1', 'v1.x', 'v1.y')", [orgId])).rejects.toThrow(/check constraint/);
  });

  it("un socio puede quitar la cuenta (archivar); un viewer no; otra org no la ve", async () => {
    const { id } = await insertAccount("linkedin");
    expect((await as(db, viewer, () => db.query("update public.ads_accounts set archived_at = now() where id = $1 returning id", [id]))).rows).toHaveLength(0);
    expect((await as(db, partner, () => db.query("update public.ads_accounts set label = 'LinkedIn' where id = $1 returning id", [id]))).rows).toHaveLength(1);
    const stranger = await createUser(db, "stranger@example.com");
    await createOrg(db, stranger, onboardingPayload({ org: { name: "Otra", slug: "otra" }, invitations: [] }));
    expect((await as(db, stranger, () => db.query("select id from public.ads_accounts where id = $1", [id]))).rows).toHaveLength(0);
  });
});

describe("caché de cifras", () => {
  it("la escribe solo el servidor; los miembros la leen; se va con la cuenta", async () => {
    const { id } = await insertAccount("openai");
    await db.query(
      `insert into public.ads_insights (org_id, account_id, period_from, period_to, campaigns) values ($1, $2, '2026-09-05', '2026-10-02', '[{"id":"c1","name":"Marca","channel":null,"impressions":10,"clicks":1,"spend_cents":250}]')`,
      [orgId, id],
    );
    expect((await as(db, viewer, () => db.query("select campaigns from public.ads_insights where account_id = $1", [id]))).rows).toHaveLength(1);
    await expect(as(db, partner, () => db.query("update public.ads_insights set fetched_at = now() where account_id = $1", [id]))).rejects.toThrow(/permission denied/);
    await expect(db.query("insert into public.ads_insights (org_id, account_id, period_from, period_to) values ($1, $2, '2026-10-02', '2026-09-05')", [orgId, id])).rejects.toThrow(/check constraint|duplicate key/);
    await db.query("delete from public.ads_accounts where id = $1", [id]);
    expect((await db.query("select 1 from public.ads_insights where account_id = $1", [id])).rows).toHaveLength(0);
  });

  it("las campañas vinculadas a clientes apuntan a la cuenta conectada", async () => {
    const client = (await one<{ id: string }>("insert into public.clients (org_id, display_name) values ($1, 'UDB') returning id", [orgId])).id;
    const { id } = await insertAccount("openai");
    await as(db, partner, () => db.query("insert into public.ads_client_campaigns (org_id, client_id, ad_account_id, campaign_id, visible_to_client) values ($1, $2, $3, 'camp-1', true)", [orgId, client, id]));
    await expect(db.query("insert into public.ads_client_campaigns (org_id, client_id, ad_account_id, campaign_id) values ($1, $2, gen_random_uuid(), 'camp-2')", [orgId, client])).rejects.toThrow(/foreign key/);
    await db.query("delete from public.ads_accounts where id = $1", [id]);
    expect((await db.query("select 1 from public.ads_client_campaigns where ad_account_id = $1", [id])).rows).toHaveLength(0);
  });
});
