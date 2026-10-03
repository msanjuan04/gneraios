import { beforeEach, describe, expect, it } from "vitest";
import { as, createDb, createOrg, createUser, type Db, onboardingPayload } from "./harness";

// Buzón conectado y copia de los mensajes (supabase/migrations/20261003170000_correo.sql). Lo que se
// comprueba aquí: la contraseña cifrada no la puede leer nadie, los mensajes solo los escribe el
// servidor, y cada mensaje queda atado a su cuenta y a su cliente de la misma org.

let db: Db;
let owner: string;
let partner: string;
let viewer: string;
let orgId: string;
let accountId: string;

const SEALED = `iv.${"A".repeat(60)}`;

const addAccount = () =>
  db.query<{ id: string }>(
    `insert into public.mail_accounts (org_id, address, imap_host, smtp_host, username, password_ciphertext)
     values ($1, 'info@gnerai.com', 'imap.ionos.es', 'smtp.ionos.es', 'info@gnerai.com', $2) returning id`,
    [orgId, SEALED],
  );

const addMessage = (overrides: { uid?: number; folder?: string; clientId?: string | null; seen?: boolean } = {}) =>
  db.query<{ id: string }>(
    `insert into public.mail_messages (org_id, account_id, folder, uid, thread_key, direction, from_address, subject, body_text, snippet, sent_at, seen, client_id)
     values ($1, $2, $3, $4, 'hilo-1', 'incoming', 'nadia@example.com', 'Propuesta', 'Hola', 'Hola', now(), $5, $6) returning id`,
    [orgId, accountId, overrides.folder ?? "INBOX", overrides.uid ?? 1, overrides.seen ?? false, overrides.clientId ?? null],
  );

beforeEach(async () => {
  db = await createDb();
  owner = await createUser(db, "owner@example.com");
  partner = await createUser(db, "partner@example.com");
  viewer = await createUser(db, "viewer@example.com");
  orgId = await createOrg(db, owner);
  await db.query("insert into public.members (org_id, user_id, role, full_name, initials) values ($1,$2,'partner','Socio','SO')", [orgId, partner]);
  await db.query("insert into public.members (org_id, user_id, role, full_name, initials) values ($1,$2,'viewer','Gestoría','GE')", [orgId, viewer]);
  accountId = (await addAccount()).rows[0]!.id;
});

describe("el buzón conectado", () => {
  it("un socio ve los datos de conexión pero no la contraseña cifrada", async () => {
    const visible = await as(db, partner, () => db.query("select address, imap_host, username from public.mail_accounts where org_id = $1", [orgId]));
    expect(visible.rows).toHaveLength(1);
    await expect(as(db, partner, () => db.query("select password_ciphertext from public.mail_accounts where org_id = $1", [orgId]))).rejects.toThrow(
      /permission denied/i,
    );
  });

  it("un viewer no ve el buzón", async () => {
    const rows = await as(db, viewer, () => db.query("select address from public.mail_accounts where org_id = $1", [orgId]));
    expect(rows.rows).toHaveLength(0);
  });

  it("solo hay una cuenta por dirección y org", async () => {
    await expect(addAccount()).rejects.toThrow(/duplicate key|unique/i);
  });

  it("la dirección se guarda en minúsculas y con formato de correo", async () => {
    await expect(
      db.query(
        `insert into public.mail_accounts (org_id, address, imap_host, smtp_host, username, password_ciphertext)
         values ($1, 'Info@GNERAI.com', 'imap.ionos.es', 'smtp.ionos.es', 'x@y.es', $2)`,
        [orgId, SEALED],
      ),
    ).rejects.toThrow(/check constraint/i);
  });
});

describe("los mensajes", () => {
  it("los lee un socio y no un viewer, y nadie los escribe desde la sesión", async () => {
    await addMessage();
    expect((await as(db, partner, () => db.query("select subject from public.mail_messages where org_id = $1", [orgId]))).rows).toHaveLength(1);
    expect((await as(db, viewer, () => db.query("select subject from public.mail_messages where org_id = $1", [orgId]))).rows).toHaveLength(0);
    await expect(
      as(db, partner, () =>
        db.query(
          `insert into public.mail_messages (org_id, account_id, folder, uid, thread_key, direction, from_address, sent_at)
           values ($1, $2, 'INBOX', 99, 'h', 'incoming', 'x@y.es', now())`,
          [orgId, accountId],
        ),
      ),
    ).rejects.toThrow(/permission denied|row-level security/i);
  });

  it("el mismo UID no entra dos veces en la misma carpeta, pero sí en otra", async () => {
    await addMessage({ uid: 7 });
    await expect(addMessage({ uid: 7 })).rejects.toThrow(/duplicate key|unique/i);
    expect((await addMessage({ uid: 7, folder: "Sent" })).rows).toHaveLength(1);
  });

  it("solo se enlaza a un cliente de la misma org y borrar la cuenta se lleva sus mensajes", async () => {
    const otherOwner = await createUser(db, "otra@example.com");
    const otherOrg = await createOrg(db, otherOwner, onboardingPayload({ org: { name: "Otra", slug: "otra" }, invitations: [] }));
    const foreign = await db.query<{ id: string }>(
      "insert into public.clients (org_id, display_name) values ($1, 'De otra org') returning id",
      [otherOrg],
    );
    await expect(addMessage({ clientId: foreign.rows[0]!.id })).rejects.toThrow(/foreign key/i);

    const mine = await db.query<{ id: string }>("insert into public.clients (org_id, display_name) values ($1, 'Nadia') returning id", [orgId]);
    await addMessage({ uid: 11, clientId: mine.rows[0]!.id });
    await db.query("delete from public.mail_accounts where id = $1", [accountId]);
    expect((await db.query("select id from public.mail_messages where org_id = $1", [orgId])).rows).toHaveLength(0);
  });

  it("archivar el cliente no borra nada, y borrarlo solo suelta el enlace", async () => {
    const mine = await db.query<{ id: string }>("insert into public.clients (org_id, display_name) values ($1, 'Nadia') returning id", [orgId]);
    await addMessage({ uid: 12, clientId: mine.rows[0]!.id });
    await db.query("delete from public.clients where id = $1", [mine.rows[0]!.id]);
    const row = await db.query<{ client_id: string | null }>("select client_id from public.mail_messages where org_id = $1", [orgId]);
    expect(row.rows[0]!.client_id).toBeNull();
  });
});
