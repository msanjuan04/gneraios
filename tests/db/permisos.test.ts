import { beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "./harness";

// Permisos mínimos (migración 20261003210000): la seguridad por filas es una capa, y los permisos de
// tabla son la otra. `anon` (sin sesión) no necesita nada en `public` y `authenticated` no necesita
// TRUNCATE, REFERENCES ni TRIGGER (RLS no limita TRUNCATE).

let db: Db;
beforeAll(async () => {
  db = await createDb();
});

async function rows<T>(sql: string): Promise<T[]> {
  const { rows } = await db.query<T>(sql);
  return rows;
}

describe("permisos de tabla", () => {
  it("anon no tiene ningún permiso sobre las tablas de public", async () => {
    const grants = await rows<{ table_name: string; privilege_type: string }>(
      "select table_name, privilege_type from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public'",
    );
    expect(grants).toEqual([]);
  });

  it("authenticated no puede TRUNCATE, REFERENCES ni TRIGGER en ninguna tabla de public", async () => {
    const grants = await rows<{ table_name: string; privilege_type: string }>(
      "select table_name, privilege_type from information_schema.role_table_grants where grantee = 'authenticated' and table_schema = 'public' and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')",
    );
    expect(grants).toEqual([]);
  });

  it("anon no puede ejecutar ninguna función de public", async () => {
    const fns = await rows<{ proname: string }>(
      "select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'execute')",
    );
    expect(fns).toEqual([]);
  });

  it("las tablas con datos de la empresa siguen siendo legibles para quien tiene sesión", async () => {
    const grants = await rows<{ privilege_type: string }>(
      "select privilege_type from information_schema.role_table_grants where grantee = 'authenticated' and table_schema = 'public' and table_name = 'clients' and privilege_type = 'SELECT'",
    );
    expect(grants).toHaveLength(1);
  });
});

describe("registro de auditoría", () => {
  it("quien tiene sesión no puede escribir ni borrar el registro (solo los triggers lo escriben)", async () => {
    const grants = await rows<{ privilege_type: string }>(
      "select privilege_type from information_schema.role_table_grants where grantee = 'authenticated' and table_schema = 'public' and table_name = 'audit_log' and privilege_type in ('INSERT', 'UPDATE', 'DELETE')",
    );
    expect(grants).toEqual([]);
  });

  it("la auditoría no guarda columnas cifradas", async () => {
    const { rows: out } = await db.query<{ stripped: unknown }>(
      `select private.audit_strip_secrets('{"id":"1","address":"a@b.com","password_ciphertext":"v1.x","refresh_token_encrypted":"y","label":"ok"}'::jsonb) as stripped`,
    );
    expect(out[0]!.stripped).toEqual({ id: "1", address: "a@b.com", label: "ok" });
  });

  it("el cambio de la última sincronización del buzón no genera una fila de auditoría", async () => {
    const triggers = await rows<{ def: string }>(
      "select pg_get_triggerdef(oid) as def from pg_trigger where tgrelid = 'public.mail_accounts'::regclass and tgname = 'audit'",
    );
    expect(triggers).toHaveLength(1);
    expect(triggers[0]!.def).toContain("UPDATE OF");
    expect(triggers[0]!.def).not.toContain("last_sync_at");
  });
});
