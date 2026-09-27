import { beforeEach, describe, expect, it } from "vitest";
import { as, createDb, createOrg, createUser, type Db } from "./harness";

// Entrada con código (supabase/migrations/20260926370000_codigos_acceso.sql): las tablas solo las
// toca el servidor; ningún usuario, ni con sesión ni sin ella, las lee ni las escribe.

let db: Db;
let owner: string;
let orgId: string;

const HASH = "scrypt$32768$8$1$c2FsdA$aGFzaA";
const HEX = "a".repeat(64);

beforeEach(async () => {
  db = await createDb();
  owner = await createUser(db, "owner@example.com");
  orgId = await createOrg(db, owner);
  await db.query("insert into public.access_codes (user_id, code_hash, created_by) values ($1, $2, $1)", [owner, HASH]);
  await db.query("insert into public.trusted_devices (user_id, device_hash, label, confirmed_at) values ($1, $2, 'Mac · Safari', now())", [owner, HEX]);
  await db.query("insert into public.access_code_attempts (ip_hash, user_id, ok) values ($1, $2, true)", [HEX, owner]);
});

describe("códigos de acceso y dispositivos de confianza", () => {
  for (const table of ["access_codes", "trusted_devices", "access_code_attempts"]) {
    it(`${table}: ni el propio usuario ni un anónimo la leen o la escriben`, async () => {
      for (const user of [owner, null]) {
        await expect(as(db, user, () => db.query(`select * from public.${table}`))).rejects.toThrow(/permission denied/);
        await expect(as(db, user, () => db.query(`delete from public.${table}`))).rejects.toThrow(/permission denied/);
      }
    });
  }

  it("un usuario no puede darse de alta un código ni un dispositivo", async () => {
    await expect(
      as(db, owner, () => db.query("insert into public.access_codes (user_id, code_hash) values ($1, $2)", [owner, HASH])),
    ).rejects.toThrow(/permission denied/);
    await expect(
      as(db, owner, () =>
        db.query("insert into public.trusted_devices (user_id, device_hash, confirmed_at) values ($1, $2, now())", [owner, "b".repeat(64)]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("solo se guarda un hash scrypt, nunca el código en claro", async () => {
    await expect(db.query("update public.access_codes set code_hash = '12345678' where user_id = $1", [owner])).rejects.toThrow(
      /access_codes_code_hash_check/,
    );
  });

  it("del dispositivo solo se guarda el SHA-256 del token, uno por usuario y dispositivo", async () => {
    await expect(
      db.query("insert into public.trusted_devices (user_id, device_hash) values ($1, 'token-en-claro')", [owner]),
    ).rejects.toThrow(/trusted_devices_device_hash_check/);
    await expect(db.query("insert into public.trusted_devices (user_id, device_hash) values ($1, $2)", [owner, HEX])).rejects.toThrow(
      /trusted_devices_user_device_idx/,
    );
    // El mismo ordenador puede ser de confianza para otro socio.
    const partner = await createUser(db, "partner@example.com");
    await db.query("insert into public.trusted_devices (user_id, device_hash) values ($1, $2)", [partner, HEX]);
  });

  it("el aviso de dispositivo nuevo es un tipo de notificación", async () => {
    await db.query(
      "insert into public.notifications (org_id, kind, params, href, dedupe_key) values ($1, 'new_device', $2, '/settings/team', 'new_device:1')",
      [orgId, JSON.stringify({ member: "Hugo", device: "iPhone · Safari" })],
    );
    const { rows } = await as(db, owner, () => db.query<{ kind: string }>("select kind from public.notifications"));
    expect(rows.map((r) => r.kind)).toContain("new_device");
  });

  it("al borrar la cuenta se van su código, sus dispositivos y sus intentos", async () => {
    const gone = await createUser(db, "gone@example.com");
    await db.query("insert into public.access_codes (user_id, code_hash) values ($1, $2)", [gone, HASH]);
    await db.query("insert into public.trusted_devices (user_id, device_hash) values ($1, $2)", [gone, HEX]);
    await db.query("insert into public.access_code_attempts (ip_hash, user_id, ok) values ($1, $2, false)", [HEX, gone]);
    await db.query("delete from auth.users where id = $1", [gone]);
    for (const table of ["access_codes", "trusted_devices", "access_code_attempts"]) {
      const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from public.${table} where user_id = $1`, [gone]);
      expect(rows[0]!.n).toBe(0);
    }
  });
});
