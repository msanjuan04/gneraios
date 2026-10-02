import { beforeEach, describe, expect, it } from "vitest";
import { as, createDb, createOrg, createUser, type Db } from "./harness";

let db: Db;
let owner: string;
let partner: string;
let viewer: string;
let orgId: string;
let clientId: string;

async function one<T>(sql: string, params: unknown[] = []) { return (await db.query<T>(sql, params)).rows[0]!; }

beforeEach(async () => {
  db = await createDb();
  owner = await createUser(db, "owner@example.com");
  partner = await createUser(db, "partner@example.com");
  viewer = await createUser(db, "viewer@example.com");
  orgId = await createOrg(db, owner);
  await db.query("insert into public.members (org_id, user_id, role, full_name, initials) values ($1,$2,'partner','Socio','SO'),($1,$3,'viewer','Lectura','LE')", [orgId, partner, viewer]);
  clientId = (await as(db, owner, () => one<{ id: string }>("insert into public.clients (org_id, display_name) values ($1,'Cliente existente') returning id", [orgId]))).id;
});

describe("solicitudes al cliente", () => {
  it("guarda autor como usuario y permite crear una respuesta ya recibida", async () => {
    const request = await as(db, partner, () => one<{ created_by: string; status: string; received_at: string }>(
      `insert into public.client_requests (org_id, client_id, kind, title, status, response, created_by)
       values ($1,$2,'other','Material ya recibido','received','Entregado por email',$3)
       returning created_by, status, received_at`, [orgId, clientId, partner],
    ));
    expect(request.created_by).toBe(partner);
    expect(request.status).toBe("received");
    expect(request.received_at).toBeTruthy();
  });

  it("exige respuesta o archivo recibido, conserva historia y limita escritura a socios", async () => {
    const request = await as(db, partner, () => one<{ id: string }>(
      `insert into public.client_requests (org_id, client_id, kind, title, requested_at, due_on)
       values ($1,$2,'questionnaire','Cuestionario inicial','2026-09-01','2026-09-10') returning id`, [orgId, clientId],
    ));
    expect((await as(db, viewer, () => db.query("select title from public.client_requests where id = $1", [request.id]))).rows).toEqual([{ title: "Cuestionario inicial" }]);
    expect((await as(db, viewer, () => db.query("update public.client_requests set status = 'received', response = 'completo' where id = $1 returning id", [request.id]))).rows).toHaveLength(0);
    await expect(as(db, partner, () => db.query("update public.client_requests set created_by = $2 where id = $1", [request.id, owner]))).rejects.toMatchObject({ hint: "client_request_identity_immutable" });
    await expect(as(db, partner, () => db.query("update public.client_requests set status = 'received' where id = $1", [request.id]))).rejects.toMatchObject({ hint: "client_request_response_required" });
    await as(db, partner, () => db.query("update public.client_requests set status = 'received', response = 'Respuesta registrada' where id = $1", [request.id]));
    await expect(as(db, partner, () => db.query("update public.client_requests set response = 'reescrita' where id = $1", [request.id]))).rejects.toMatchObject({ hint: "client_request_closed" });
    expect((await one<{ count: number }>("select count(*)::int as count from public.audit_log where table_name = 'client_requests' and record_id = $1", [request.id])).count).toBe(2);
  });

  it("solo enlaza archivos del mismo cliente y disponibles", async () => {
    const request = await as(db, partner, () => one<{ id: string }>("insert into public.client_requests (org_id, client_id, kind, title, requested_at) values ($1,$2,'material','Logotipo','2026-09-01') returning id", [orgId, clientId]));
    const file = await as(db, partner, () => one<{ id: string }>("insert into public.client_files (org_id, client_id, kind, title, url) values ($1,$2,'link','Drive','https://drive.google.com/example') returning id", [orgId, clientId]));
    await as(db, partner, () => db.query("update public.client_requests set status = 'received', client_file_id = $2 where id = $1", [request.id, file.id]));
    expect((await one<{ title: string; status: string }>("select r.title, r.status from public.client_requests r where r.id = $1", [request.id]))).toEqual({ title: "Logotipo", status: "received" });
  });
});
