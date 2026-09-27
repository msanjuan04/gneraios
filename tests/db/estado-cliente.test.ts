import { beforeEach, describe, expect, it } from "vitest";
import { as, createDb, createOrg, createUser, type Db } from "./harness";

// Estado del cliente marcado a mano (supabase/migrations/20260927140000_estado_cliente.sql).

let db: Db;
let owner: string;
let orgId: string;
let clientId: string;

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0]!;
}

beforeEach(async () => {
  db = await createDb();
  owner = await createUser(db, "owner@example.com");
  orgId = await createOrg(db, owner);
  clientId = (
    await as(db, owner, () => one<{ id: string }>("insert into public.clients (org_id, display_name) values ($1, 'Clínica Dental') returning id", [orgId]))
  ).id;
});

describe("estado del cliente a mano", () => {
  it("sin marcar, la vista da el calculado y ningún estado a mano", async () => {
    const row = await as(db, owner, () =>
      one<{ status: string; manual_status: string | null }>("select status, manual_status from public.clients_overview where id = $1", [clientId]),
    );
    expect(row).toEqual({ status: "lead", manual_status: null });
  });

  it("al marcarlo se apunta cuándo; al quitarlo se borra; tocar otra cosa no lo cambia", async () => {
    await as(db, owner, () => db.query("update public.clients set manual_status = 'pending_contact' where id = $1", [clientId]));
    const first = await one<{ manual_status: string; manual_status_at: string | null }>(
      "select manual_status, manual_status_at from public.clients where id = $1",
      [clientId],
    );
    expect(first.manual_status).toBe("pending_contact");
    expect(first.manual_status_at).not.toBeNull();

    await as(db, owner, () => db.query("update public.clients set city = 'Mataró' where id = $1", [clientId]));
    const same = await one<{ manual_status_at: string }>("select manual_status_at from public.clients where id = $1", [clientId]);
    expect(String(same.manual_status_at)).toBe(String(first.manual_status_at));

    // Nadie puede fijar la fecha a mano: la pone el trigger.
    await as(db, owner, () => db.query("update public.clients set manual_status_at = '2000-01-01' where id = $1", [clientId]));
    const kept = await one<{ manual_status_at: string }>("select manual_status_at from public.clients where id = $1", [clientId]);
    expect(String(kept.manual_status_at)).toBe(String(first.manual_status_at));

    await as(db, owner, () => db.query("update public.clients set manual_status = null where id = $1", [clientId]));
    const cleared = await one<{ manual_status: string | null; manual_status_at: string | null }>(
      "select manual_status, manual_status_at from public.clients where id = $1",
      [clientId],
    );
    expect(cleared).toEqual({ manual_status: null, manual_status_at: null });
  });

  it("la vista lo enseña y solo admite los estados que existen", async () => {
    await as(db, owner, () => db.query("update public.clients set manual_status = 'finished' where id = $1", [clientId]));
    const row = await as(db, owner, () => one<{ manual_status: string }>("select manual_status from public.clients_overview where id = $1", [clientId]));
    expect(row.manual_status).toBe("finished");
    await expect(as(db, owner, () => db.query("update public.clients set manual_status = 'former' where id = $1", [clientId]))).rejects.toThrow(
      /invalid input value for enum/,
    );
  });
});
