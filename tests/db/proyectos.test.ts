import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { addDays } from "@/domain/dates/civil-date";
import { isProjectOverdue, type ProjectStatus } from "@/domain/projects";
import { computeLine } from "@/domain/tax";
import { as, createDb, createOrg, createUser, type Db, onboardingPayload } from "./harness";

let db: Db;
let owner: string;
let partner: string;
let viewer: string;
let intruder: string;
let orgId: string;
let otherOrgId: string;
let members: { owner: string; partner: string; viewer: string };
let clientId: string;
let otherClientId: string;
let today: string;
let ids: { freelancer: string; vat21: string };

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0]!;
}

async function all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

/** Rechaza con el hint de Postgres que la app traduce a un mensaje. */
async function expectHint(promise: Promise<unknown>, hint: string) {
  await expect(promise).rejects.toMatchObject({ hint });
}

const day = (offset: number) => addDays(today, offset);

async function addMember(userId: string, role: "viewer" | "partner", initials: string): Promise<string> {
  return (
    await one<{ id: string }>(
      "insert into public.members (org_id, user_id, role, full_name, initials) values ($1, $2, $3, 'Socio', $4) returning id",
      [orgId, userId, role, initials],
    )
  ).id;
}

async function createClient(name: string, n: number): Promise<string> {
  return as(db, owner, async () =>
    (
      await one<{ id: string }>(
        `insert into public.clients (org_id, display_name, legal_name, tax_id, address_line, postal_code, city)
         values ($1, $2, $2, $3, 'Carrer Major 1', '08301', 'Mataró') returning id`,
        [orgId, name, `B1234567${n}`],
      )
    ).id,
  );
}

async function createProject(values: Record<string, unknown> = {}, user = partner): Promise<string> {
  const row = { org_id: orgId, client_id: clientId, name: "Web corporativa", kind: "web", status: "active", ...values };
  const columns = Object.keys(row);
  return as(db, user, async () =>
    (
      await one<{ id: string }>(
        `insert into public.projects (${columns.join(", ")}) values (${columns.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
        Object.values(row),
      )
    ).id,
  );
}

let position = 0;
async function createTask(projectId: string, values: Record<string, unknown> = {}, user = partner): Promise<string> {
  position += 1024;
  const row = { org_id: orgId, project_id: projectId, title: "Tarea", position, ...values };
  const columns = Object.keys(row);
  return as(db, user, async () =>
    (
      await one<{ id: string }>(
        `insert into public.project_tasks (${columns.join(", ")}) values (${columns.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
        Object.values(row),
      )
    ).id,
  );
}

async function logTime(projectId: string, values: Record<string, unknown> = {}, user = partner): Promise<string> {
  const row = { org_id: orgId, member_id: members.partner, project_id: projectId, worked_on: today, minutes: 60, ...values };
  const columns = Object.keys(row);
  return as(db, user, async () =>
    (
      await one<{ id: string }>(
        `insert into public.time_entries (${columns.join(", ")}) values (${columns.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
        Object.values(row),
      )
    ).id,
  );
}

async function createContract(client = clientId): Promise<{ contractId: string; lines: string[] }> {
  const contractId = await as(db, owner, async () =>
    (
      await one<{ id: string }>("select public.create_contract($1::jsonb) as id", [
        JSON.stringify({
          client_id: client,
          issuer_id: ids.freelancer,
          title: "Web + mantenimiento",
          signed_on: day(-60),
          lines: [
            { position: 0, description: "Web", billing_type: "one_off", unit_price_cents: 300_000, tax_rate_id: ids.vat21 },
            {
              position: 1,
              description: "Mantenimiento",
              billing_type: "monthly",
              unit_price_cents: 9_000,
              tax_rate_id: ids.vat21,
              starts_on: day(-60),
              billing_day: 1,
            },
          ],
        }),
      ])
    ).id,
  );
  const lines = await all<{ id: string }>("select id from public.contract_lines where contract_id = $1 order by position", [contractId]);
  return { contractId, lines: lines.map((l) => l.id) };
}

function draftLine(unitPriceCents: number, contractLineId: string | null) {
  const amounts = computeLine({ quantity: "1", unitPriceCents, discountBps: 0, vatBps: 2100, irpfBps: 0, irpfApplies: false });
  return {
    id: randomUUID(),
    description: "Servicio",
    quantity: "1",
    unit_price_cents: unitPriceCents,
    discount_bps: 0,
    base_cents: amounts.baseCents,
    tax_rate_id: ids.vat21,
    vat_bps: 2100,
    vat_regime: "general",
    vat_cents: amounts.vatCents,
    irpf_applies: false,
    irpf_cents: 0,
    billing_type: "one_off",
    contract_line_id: contractLineId,
  };
}

async function draftInvoice(lines: [number, string | null][], client = clientId): Promise<string> {
  return as(db, owner, async () =>
    (
      await one<{ id: string }>("select public.save_invoice_draft($1::jsonb) as id", [
        JSON.stringify({
          header: { issuer_id: ids.freelancer, client_id: client, irpf_bps: 0, payment_terms_days: 30 },
          lines: lines.map(([cents, line]) => draftLine(cents, line)),
        }),
      ])
    ).id,
  );
}

async function completeIssue(invoiceId: string, issuedOn: string) {
  await as(db, owner, async () => {
    await db.query("select public.issue_invoice_begin($1, $2::date)", [invoiceId, issuedOn]);
    await db.query("select public.issue_invoice_complete($1, $2::jsonb)", [invoiceId, JSON.stringify({ pdf_path: `${orgId}/${invoiceId}.pdf` })]);
  });
}

async function issueInvoice(lines: [number, string | null][], issuedOn: string, client = clientId): Promise<string> {
  const id = await draftInvoice(lines, client);
  await completeIssue(id, issuedOn);
  return id;
}

async function overview(projectId: string, user = viewer) {
  return as(db, user, () =>
    one<Record<string, unknown>>(
      "select *, revenue_cents::text as revenue, last_worked_on::text as last_worked from public.projects_overview where id = $1",
      [projectId],
    ),
  );
}

beforeEach(async () => {
  db = await createDb();
  owner = await createUser(db, "owner@example.com");
  partner = await createUser(db, "partner@example.com");
  viewer = await createUser(db, "viewer@example.com");
  intruder = await createUser(db, "intruder@example.com");
  orgId = await createOrg(db, owner);
  otherOrgId = await createOrg(db, intruder, onboardingPayload({ org: { name: "Otra", slug: "otra" }, invitations: [] }));
  members = {
    owner: (await one<{ id: string }>("select id from public.members where org_id = $1 and user_id = $2", [orgId, owner])).id,
    partner: await addMember(partner, "partner", "PA"),
    viewer: await addMember(viewer, "viewer", "VI"),
  };
  // Dirección para poder emitir y la fecha Verifactu lejos (los tests emiten con fechas relativas a hoy).
  await db.query(
    "update public.issuers set address_line = 'Carrer Major 1', postal_code = '08301', city = 'Mataró', verifactu_from = '2099-01-01' where org_id = $1",
    [orgId],
  );
  const freelancer = (await one<{ id: string }>("select id from public.issuers where org_id = $1 and kind = 'self_employed'", [orgId])).id;
  await db.query(
    "insert into public.invoice_series (org_id, issuer_id, code, name, kind, format, is_default) values ($1, $2, 'R', 'Rectificativas', 'rectifying', 'R{yyyy}-{n:4}', true)",
    [orgId, freelancer],
  );
  ids = {
    freelancer,
    vat21: (await one<{ id: string }>("select id from public.tax_rates where org_id = $1 and name = 'IVA 21 %'", [orgId])).id,
  };
  today = (await one<{ d: string }>("select private.org_today($1)::text as d", [orgId])).d;
  clientId = await createClient("Clínica Dental Mar Blau", 1);
  otherClientId = await createClient("Hotel Llevant", 2);
});

describe("proyectos", () => {
  it("cualquier miembro los lee; solo un socio los crea y los cambia; otra org no ve nada; no se borran", async () => {
    const projectId = await createProject();

    expect(await as(db, viewer, () => all("select name from public.projects"))).toEqual([{ name: "Web corporativa" }]);
    expect(await as(db, intruder, () => all("select id from public.projects"))).toEqual([]);
    expect(await as(db, intruder, () => all("select id from public.projects_overview"))).toEqual([]);

    await expect(createProject({ name: "Del viewer" }, viewer)).rejects.toThrow(/row-level security/);
    await expect(createProject({ org_id: orgId }, intruder)).rejects.toThrow(/row-level security/);

    // Un viewer no cambia nada (la RLS no le deja ver la fila para actualizarla).
    await as(db, viewer, () => db.query("update public.projects set name = 'Cambiado' where id = $1", [projectId]));
    await as(db, partner, () => db.query("delete from public.projects where id = $1", [projectId]));
    expect((await one<{ name: string }>("select name from public.projects where id = $1", [projectId])).name).toBe("Web corporativa");

    await as(db, partner, () => db.query("update public.projects set status = 'paused', archived_at = now() where id = $1", [projectId]));
    expect(await one("select status, archived_at is not null as archived from public.projects where id = $1", [projectId])).toEqual({
      status: "paused",
      archived: true,
    });

    await expect(as(db, null, () => db.query("select id from public.projects"))).rejects.toThrow(/permission denied/);
    await expect(as(db, null, () => db.query("select id from public.projects_overview"))).rejects.toThrow(/permission denied/);
  });

  it("el contrato tiene que ser del cliente; un proyecto interno no tiene contrato ni portal", async () => {
    const { contractId } = await createContract();
    await createProject({ contract_id: contractId });
    await expect(createProject({ client_id: otherClientId, contract_id: contractId })).rejects.toMatchObject({ code: "23503" });
    await expect(createProject({ client_id: null, contract_id: contractId })).rejects.toMatchObject({ code: "23514" });
    await expect(createProject({ client_id: null, portal_visible: true })).rejects.toMatchObject({ code: "23514" });
    await expect(createProject({ starts_on: day(10), due_on: day(5) })).rejects.toMatchObject({ code: "23514" });
    await createProject({ client_id: null, kind: "internal", name: "Web propia" });
  });

  it("un cliente, un contrato o un socio de otra org no sirven", async () => {
    const foreignClient = await as(db, intruder, async () =>
      (await one<{ id: string }>("insert into public.clients (org_id, display_name) values ($1, 'Ajeno') returning id", [otherOrgId])).id,
    );
    const foreignMember = (await one<{ id: string }>("select id from public.members where org_id = $1", [otherOrgId])).id;
    await expect(createProject({ client_id: foreignClient })).rejects.toMatchObject({ code: "23503" });
    await expect(createProject({ owner_member_id: foreignMember })).rejects.toMatchObject({ code: "23503" });
  });
});

describe("tareas", () => {
  it("las lleva un socio; un viewer solo las lee; no se cuelan en proyectos de otra org", async () => {
    const projectId = await createProject();
    const taskId = await createTask(projectId, { assignee_member_id: members.viewer });
    expect(await as(db, viewer, () => all("select id from public.project_tasks"))).toEqual([{ id: taskId }]);
    await expect(createTask(projectId, {}, viewer)).rejects.toThrow(/row-level security/);
    await as(db, viewer, () => db.query("delete from public.project_tasks where id = $1", [taskId]));
    expect(await all("select id from public.project_tasks")).toHaveLength(1);

    const foreignProject = await as(db, intruder, async () =>
      (await one<{ id: string }>("insert into public.projects (org_id, name) values ($1, 'Ajeno') returning id", [otherOrgId])).id,
    );
    await expect(createTask(foreignProject, { org_id: orgId })).rejects.toMatchObject({ code: "23503" });

    await as(db, partner, () => db.query("delete from public.project_tasks where id = $1", [taskId]));
    expect(await all("select id from public.project_tasks")).toHaveLength(0);
  });

  it("completed_at se pone al terminar, se conserva mientras sigue hecha y se quita al reabrir", async () => {
    const projectId = await createProject();
    const taskId = await createTask(projectId);
    const stamp = () => one<{ status: string; completed_at: string | null }>("select status, completed_at::text from public.project_tasks where id = $1", [taskId]);
    expect((await stamp()).completed_at).toBeNull();

    await as(db, partner, () => db.query("update public.project_tasks set status = 'done' where id = $1", [taskId]));
    const done = await stamp();
    expect(done.completed_at).not.toBeNull();

    // Cambiar otra cosa (o intentar tocar la fecha a mano) no mueve el suceso.
    await as(db, partner, () =>
      db.query("update public.project_tasks set title = 'Otra', completed_at = '2020-01-01' where id = $1", [taskId]),
    );
    expect((await stamp()).completed_at).toBe(done.completed_at);

    await as(db, partner, () => db.query("update public.project_tasks set status = 'doing', completed_at = now() where id = $1", [taskId]));
    expect(await stamp()).toEqual({ status: "doing", completed_at: null });

    // Nace hecha: también se fecha.
    const born = await createTask(projectId, { status: "done" });
    expect((await one<{ c: string | null }>("select completed_at::text as c from public.project_tasks where id = $1", [born])).c).not.toBeNull();
  });

  it("app.task_completed_at fecha el suceso hacia atrás (importaciones y demo)", async () => {
    const projectId = await createProject();
    const taskId = await createTask(projectId);
    await db.query("select set_config('app.task_completed_at', '2026-05-04T10:00:00+02:00', false)");
    try {
      await db.query("update public.project_tasks set status = 'done' where id = $1", [taskId]);
    } finally {
      await db.query("select set_config('app.task_completed_at', '', false)");
    }
    const row = await one<{ at: string }>("select to_char(completed_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') as at from public.project_tasks where id = $1", [taskId]);
    expect(row.at).toBe("2026-05-04 08:00");
  });

  it("una tarea no cambia de proyecto", async () => {
    const a = await createProject();
    const b = await createProject({ name: "SEO" });
    const taskId = await createTask(a);
    await expectHint(as(db, partner, () => db.query("update public.project_tasks set project_id = $2 where id = $1", [taskId, b])), "task_project_fixed");
  });

  it("reordenar tarjetas no llena la auditoría; cambiar de estado, sí", async () => {
    const projectId = await createProject();
    const taskId = await createTask(projectId);
    const audited = () =>
      all<{ action: string }>("select action from public.audit_log where table_name = 'project_tasks' and record_id = $1 order by id", [taskId]);
    await as(db, partner, () => db.query("update public.project_tasks set position = 512 where id = $1", [taskId]));
    expect((await audited()).map((a) => a.action)).toEqual(["insert"]);
    await as(db, partner, () => db.query("update public.project_tasks set status = 'review', position = 256 where id = $1", [taskId]));
    expect((await audited()).map((a) => a.action)).toEqual(["insert", "update"]);
  });
});

describe("horas", () => {
  it("cada socio registra y corrige las suyas; un owner, las de cualquiera; un viewer, ninguna; todos las leen", async () => {
    const projectId = await createProject();
    const mine = await logTime(projectId);
    const ownerEntry = await logTime(projectId, { member_id: members.owner }, owner);

    // Un socio no escribe horas de otro.
    await expect(logTime(projectId, { member_id: members.owner })).rejects.toThrow(/row-level security/);
    await as(db, partner, () => db.query("update public.time_entries set minutes = 5 where id = $1", [ownerEntry]));
    await as(db, partner, () => db.query("delete from public.time_entries where id = $1", [ownerEntry]));
    expect((await one<{ minutes: number }>("select minutes from public.time_entries where id = $1", [ownerEntry])).minutes).toBe(60);
    // Tampoco se las pasa a otro.
    await expect(as(db, partner, () => db.query("update public.time_entries set member_id = $2 where id = $1", [mine, members.owner]))).rejects.toThrow(
      /row-level security/,
    );

    // Las suyas, sí.
    await as(db, partner, () => db.query("update public.time_entries set minutes = 90, note = 'Maquetación' where id = $1", [mine]));
    expect((await one<{ minutes: number }>("select minutes from public.time_entries where id = $1", [mine])).minutes).toBe(90);

    // Un owner corrige (y registra) las de cualquiera.
    await as(db, owner, () => db.query("update public.time_entries set minutes = 30 where id = $1", [mine]));
    await logTime(projectId, { member_id: members.partner, minutes: 15 }, owner);
    expect((await one<{ minutes: number }>("select minutes from public.time_entries where id = $1", [mine])).minutes).toBe(30);

    // Un viewer lee todas, pero no registra ni las suyas.
    expect(await as(db, viewer, () => all("select id from public.time_entries"))).toHaveLength(3);
    await expect(logTime(projectId, { member_id: members.viewer }, viewer)).rejects.toThrow(/row-level security/);
    expect(await as(db, intruder, () => all("select id from public.time_entries"))).toEqual([]);

    await as(db, partner, () => db.query("delete from public.time_entries where id = $1", [mine]));
    expect(await all("select id from public.time_entries")).toHaveLength(2);
  });

  it("la tarea tiene que ser del proyecto; borrar la tarea no borra las horas", async () => {
    const a = await createProject();
    const b = await createProject({ name: "SEO" });
    const taskOfB = await createTask(b);
    await expectHint(logTime(a, { task_id: taskOfB }), "task_not_in_project");

    const taskOfA = await createTask(a);
    const entry = await logTime(a, { task_id: taskOfA });
    await expectHint(as(db, partner, () => db.query("update public.time_entries set task_id = $2 where id = $1", [entry, taskOfB])), "task_not_in_project");

    await as(db, partner, () => db.query("delete from public.project_tasks where id = $1", [taskOfA]));
    expect(await one("select task_id, minutes from public.time_entries where id = $1", [entry])).toEqual({ task_id: null, minutes: 60 });
  });

  it("un proyecto archivado no admite horas nuevas; un registro es como mucho un día", async () => {
    const projectId = await createProject();
    const entry = await logTime(projectId);
    await as(db, partner, () => db.query("update public.projects set archived_at = now() where id = $1", [projectId]));
    await expectHint(logTime(projectId), "project_archived");
    // Lo ya registrado se puede corregir.
    await as(db, partner, () => db.query("update public.time_entries set minutes = 45 where id = $1", [entry]));

    const other = await createProject({ name: "Otro" });
    await expect(logTime(other, { minutes: 1441 })).rejects.toMatchObject({ code: "23514" });
    await expect(logTime(other, { minutes: 0 })).rejects.toMatchObject({ code: "23514" });
    // Sin minutos solo puede estar un temporizador en marcha (con su inicio).
    await expect(logTime(other, { minutes: null })).rejects.toMatchObject({ code: "23514" });
  });
});

describe("temporizador", () => {
  const running = () => all<{ member_id: string; project_id: string }>("select member_id, project_id from public.time_entries where minutes is null");

  it("uno en marcha por miembro: arrancar otro para el anterior", async () => {
    const a = await createProject();
    const b = await createProject({ name: "SEO" });
    const taskOfB = await createTask(b);

    const first = await as(db, partner, async () => (await one<{ id: string }>("select public.start_timer($1) as id", [a])).id);
    const second = await as(db, partner, async () => (await one<{ id: string }>("select public.start_timer($1, $2) as id", [b, taskOfB])).id);
    expect(await running()).toEqual([{ member_id: members.partner, project_id: b }]);
    const stopped = await one<{ minutes: number; task_id: string | null }>("select minutes, task_id from public.time_entries where id = $1", [first]);
    expect(stopped.minutes).toBe(1);
    expect((await one<{ task_id: string }>("select task_id from public.time_entries where id = $1", [second])).task_id).toBe(taskOfB);

    // El de otro miembro no se toca.
    await as(db, owner, () => db.query("select public.start_timer($1)", [a]));
    expect(await running()).toHaveLength(2);

    // Ni a mano se pueden tener dos en marcha.
    await expect(logTime(a, { minutes: null, started_at: new Date().toISOString() })).rejects.toMatchObject({ code: "23505" });
  });

  it("solo un socio, en proyectos que ve, sin archivar y con tareas del proyecto", async () => {
    const a = await createProject();
    const b = await createProject({ name: "SEO" });
    const taskOfB = await createTask(b);
    await expect(as(db, viewer, () => db.query("select public.start_timer($1)", [a]))).rejects.toMatchObject({ code: "42501" });
    await expectHint(as(db, intruder, () => db.query("select public.start_timer($1)", [a])), "project_not_found");
    await expectHint(as(db, partner, () => db.query("select public.start_timer($1)", [randomUUID()])), "project_not_found");
    await expectHint(as(db, partner, () => db.query("select public.start_timer($1, $2)", [a, taskOfB])), "task_not_in_project");
    await as(db, partner, () => db.query("update public.projects set archived_at = now() where id = $1", [b]));
    await expectHint(as(db, partner, () => db.query("select public.start_timer($1)", [b])), "project_archived");
    await expect(as(db, null, () => db.query("select public.start_timer($1)", [a]))).rejects.toThrow(/permission denied/);
    await expect(as(db, null, () => db.query("select public.stop_timer()"))).rejects.toThrow(/permission denied/);
    expect(await running()).toEqual([]);
  });

  it("parar redondea al minuto (mínimo 1, máximo un día) y fecha el día en que empezó, en la zona de la org", async () => {
    const projectId = await createProject();
    const stopAfter = async (startedAt: string) => {
      const id = await as(db, partner, async () => (await one<{ id: string }>("select public.start_timer($1) as id", [projectId])).id);
      await db.query(`update public.time_entries set started_at = ${startedAt} where id = $1`, [id]);
      const stopped = await as(db, partner, async () => (await one<{ id: string | null }>("select public.stop_timer() as id")).id);
      expect(stopped).toBe(id);
      return one<{ minutes: number; worked_on: string }>("select minutes, worked_on::text from public.time_entries where id = $1", [id]);
    };

    const ninety = await stopAfter("now() - interval '90 minutes 20 seconds'");
    expect(ninety.minutes).toBe(90);
    const expectedDay = await one<{ d: string }>("select ((now() - interval '90 minutes') at time zone 'Europe/Madrid')::date::text as d");
    expect(ninety.worked_on).toBe(expectedDay.d);

    expect((await stopAfter("now() - interval '89 minutes 31 seconds'")).minutes).toBe(90);
    expect((await stopAfter("now() - interval '20 seconds'")).minutes).toBe(1);
    // Olvidado durante días: como mucho un día, fechado el día de inicio en Madrid (00:30 del 11 de enero).
    expect(await stopAfter("'2026-01-10 23:30:00+00'")).toEqual({ minutes: 1440, worked_on: "2026-01-11" });

    // Sin nada en marcha, no para nada.
    expect((await as(db, partner, () => one<{ id: string | null }>("select public.stop_timer() as id"))).id).toBeNull();
  });

  it("cada uno para el suyo", async () => {
    const projectId = await createProject();
    await as(db, owner, () => db.query("select public.start_timer($1)", [projectId]));
    expect((await as(db, partner, () => one<{ id: string | null }>("select public.stop_timer() as id"))).id).toBeNull();
    expect(await running()).toEqual([{ member_id: members.owner, project_id: projectId }]);
  });
});

describe("plantillas", () => {
  const insertTemplate = (tasks: unknown, name = "Web corporativa", user = partner) =>
    as(db, user, async () =>
      (
        await one<{ id: string }>("insert into public.project_templates (org_id, name, kind, tasks) values ($1, $2, 'web', $3::jsonb) returning id", [
          orgId,
          name,
          JSON.stringify(tasks),
        ])
      ).id,
    );

  it("las tareas se validan en SQL", async () => {
    const invalid: unknown[] = [
      {},
      "texto",
      [1],
      [{}],
      [{ title: "" }],
      [{ title: "   " }],
      [{ title: 3 }],
      [{ title: "x".repeat(301) }],
      [{ title: "A", extra: true }],
      [{ title: "A", estimate_minutes: 0 }],
      [{ title: "A", estimate_minutes: 1.5 }],
      [{ title: "A", estimate_minutes: "60" }],
      [{ title: "A", offset_days: -1 }],
      [{ title: "A", offset_days: 3651 }],
      [{ title: "A", client_visible: "sí" }],
      Array.from({ length: 201 }, () => ({ title: "A" })),
    ];
    for (const [i, tasks] of invalid.entries()) {
      await expect(insertTemplate(tasks, `Plantilla ${i}`), JSON.stringify(tasks).slice(0, 40)).rejects.toMatchObject({ code: "23514" });
    }
    await insertTemplate([
      { title: "Briefing", estimate_minutes: 60, offset_days: 0, client_visible: true },
      { title: "Diseño", estimate_minutes: 480, offset_days: 10, client_visible: null },
      { title: "Lanzamiento", estimate_minutes: null, offset_days: null },
      { title: "Sin nada más" },
    ]);
    await insertTemplate([], "Vacía");
    // El nombre no se repite (sin distinguir mayúsculas).
    await expect(insertTemplate([], "  web CORPORATIVA ")).rejects.toMatchObject({ code: "23505" });
    await expect(insertTemplate([], "Del viewer", viewer)).rejects.toThrow(/row-level security/);
  });

  it("un proyecto desde una plantilla: tareas en orden, fechadas desde el inicio", async () => {
    const templateId = await insertTemplate([
      { title: "Briefing", estimate_minutes: 60, offset_days: 0, client_visible: true },
      { title: "Diseño", estimate_minutes: 480, offset_days: 10 },
      { title: "Sin fecha" },
    ]);
    const { contractId } = await createContract();
    const projectId = await as(db, partner, async () =>
      (
        await one<{ id: string }>("select public.create_project_from_template($1, $2::jsonb) as id", [
          templateId,
          JSON.stringify({ client_id: clientId, contract_id: contractId, starts_on: "2026-10-01", owner_member_id: members.partner, budget_minutes: 600 }),
        ])
      ).id,
    );
    expect(
      await one("select name, kind, status, client_id, contract_id, starts_on::text, budget_minutes, owner_member_id from public.projects where id = $1", [
        projectId,
      ]),
    ).toEqual({
      name: "Web corporativa",
      kind: "web",
      status: "planned",
      client_id: clientId,
      contract_id: contractId,
      starts_on: "2026-10-01",
      budget_minutes: 600,
      owner_member_id: members.partner,
    });
    expect(
      await all(
        "select title, status, estimate_minutes, due_on::text, client_visible from public.project_tasks where project_id = $1 order by position",
        [projectId],
      ),
    ).toEqual([
      { title: "Briefing", status: "todo", estimate_minutes: 60, due_on: "2026-10-01", client_visible: true },
      { title: "Diseño", status: "todo", estimate_minutes: 480, due_on: "2026-10-11", client_visible: false },
      { title: "Sin fecha", status: "todo", estimate_minutes: null, due_on: null, client_visible: false },
    ]);

    // Sin inicio, las tareas no tienen fecha; el nombre y el tipo se pueden cambiar.
    const undated = await as(db, partner, async () =>
      (
        await one<{ id: string }>("select public.create_project_from_template($1, $2::jsonb) as id", [
          templateId,
          JSON.stringify({ name: "Landing", kind: "ads", client_id: clientId }),
        ])
      ).id,
    );
    expect(await one("select name, kind from public.projects where id = $1", [undated])).toEqual({ name: "Landing", kind: "ads" });
    expect(await all("select due_on from public.project_tasks where project_id = $1 and due_on is not null", [undated])).toEqual([]);
  });

  it("ni un viewer ni otra org crean proyectos desde una plantilla", async () => {
    const templateId = await insertTemplate([{ title: "A" }]);
    await expect(
      as(db, viewer, () => db.query("select public.create_project_from_template($1, '{}'::jsonb)", [templateId])),
    ).rejects.toThrow(/row-level security/);
    await expectHint(as(db, intruder, () => db.query("select public.create_project_from_template($1, '{}'::jsonb)", [templateId])), "template_not_found");
    expect(await all("select id from public.projects")).toEqual([]);
  });
});

describe("resumen del proyecto (projects_overview)", () => {
  it("tareas, horas registradas (sin el temporizador en marcha) y la próxima tarea", async () => {
    const projectId = await createProject({ budget_minutes: 600 });
    await createTask(projectId, { status: "done" });
    await createTask(projectId, { title: "Tarde", due_on: day(-3) });
    const next = await createTask(projectId, { title: "Mañana", due_on: day(1), client_visible: true });
    await createTask(projectId, { title: "Hecha y tarde", status: "done", due_on: day(-10) });
    await logTime(projectId, { minutes: 90, worked_on: day(-2) });
    await logTime(projectId, { minutes: 30, billable: false, worked_on: day(-1) });
    await as(db, owner, () => db.query("select public.start_timer($1)", [projectId]));

    expect(await overview(projectId)).toMatchObject({
      tasks_total: 4,
      tasks_done: 2,
      tasks_overdue: 1,
      tasks_client_visible: 1,
      next_task_id: await one<{ id: string }>("select id from public.project_tasks where title = 'Tarde'").then((r) => r.id),
      logged_minutes: 120,
      billable_minutes: 90,
      running_timers: 1,
      last_worked: day(-1),
      budget_minutes: 600,
      revenue: "0",
      contract_projects: 0,
    });
    expect(next).toBeTruthy();
  });

  it("lo facturado sale de las líneas emitidas del contrato; las rectificativas restan", async () => {
    const { contractId, lines } = await createContract();
    const [web, maintenance] = lines as [string, string];
    const projectId = await createProject({ contract_id: contractId });

    await issueInvoice([[150_000, web]], day(-50));
    const voided = await issueInvoice(
      [
        [9_000, maintenance],
        [5_000, null], // línea suelta: no es del contrato
      ],
      day(-30),
    );
    await issueInvoice([[9_000, maintenance]], day(-20));
    await draftInvoice([[150_000, web]]); // borrador: aún no cuenta

    // Otro contrato del mismo cliente no se mezcla.
    const other = await createContract();
    await issueInvoice([[70_000, other.lines[0]!]], day(-10));

    expect((await overview(projectId)).revenue).toBe(String(150_000 + 9_000 + 9_000));

    // Anular una factura con una rectificativa total resta lo que tenía del contrato.
    const [rect] = await as(db, owner, () => all<{ id: string }>("select public.create_rectification($1, 'Error') as id", [voided]));
    await completeIssue(rect!.id, day(-5));
    expect((await overview(projectId)).revenue).toBe(String(150_000 + 9_000));

    // La vista de lo facturado es la que se agrupa por mes en el resumen.
    const revenue = await as(db, viewer, () =>
      all<{ base_cents: string; invoice_kind: string }>(
        "select base_cents::text, invoice_kind from public.project_contract_revenue where contract_id = $1 order by issued_on, base_cents",
        [contractId],
      ),
    );
    expect(revenue).toEqual([
      { base_cents: "150000", invoice_kind: "ordinary" },
      { base_cents: "9000", invoice_kind: "ordinary" },
      { base_cents: "9000", invoice_kind: "ordinary" },
      { base_cents: "-9000", invoice_kind: "rectifying" },
    ]);
    expect(await as(db, intruder, () => all("select 1 from public.project_contract_revenue"))).toEqual([]);
  });

  it("dos proyectos del mismo contrato: se sabe con cuántos y cuántas horas lo comparten", async () => {
    const { contractId } = await createContract();
    const a = await createProject({ contract_id: contractId });
    const b = await createProject({ contract_id: contractId, name: "Mantenimiento" });
    await logTime(a, { minutes: 120 });
    await logTime(b, { minutes: 60 });
    for (const id of [a, b]) {
      expect(await overview(id)).toMatchObject({ contract_projects: 2, contract_minutes: 180 });
    }
    expect((await overview(a)).logged_minutes).toBe(120);
  });

  it("con retraso: la vista y el dominio dicen lo mismo (paridad)", async () => {
    const cases: { dueOn: string | null; status: ProjectStatus }[] = [];
    for (const dueOn of [day(-30), day(-1), today, day(1), null]) {
      for (const status of ["planned", "active", "paused", "done", "cancelled"] as const) cases.push({ dueOn, status });
    }
    const created = await Promise.all(
      cases.map(async (c, i) => ({ ...c, id: await createProject({ name: `P${i}`, status: c.status, due_on: c.dueOn }) })),
    );
    const rows = await as(db, viewer, () => all<{ id: string; is_overdue: boolean }>("select id, is_overdue from public.projects_overview"));
    const byId = new Map(rows.map((r) => [r.id, r.is_overdue]));
    for (const c of created) {
      expect(byId.get(c.id), `${c.status} ${c.dueOn}`).toBe(isProjectOverdue(c, today));
    }
    expect(created.filter((c) => byId.get(c.id)).length).toBe(6);
  });
});

describe("entregables", () => {
  it("no cuenta tarea como entrega y exige documento antes de enviar; conserva cambios de estado", async () => {
    const projectId = await createProject();
    const deliverable = await as(db, partner, () => one<{ id: string }>(
      `insert into public.project_deliverables (org_id, project_id, client_id, title, due_on)
       values ($1, $2, $3, 'Diseño aprobado', $4) returning id`,
      [orgId, projectId, clientId, day(2)],
    ));
    await expectHint(as(db, partner, () => db.query(
      "update public.project_deliverables set status = 'sent' where id = $1",
      [deliverable.id],
    )), "deliverable_file_required");

    const file = await as(db, partner, () => one<{ id: string }>(
      `insert into public.client_files (org_id, client_id, kind, title, url)
       values ($1, $2, 'link', 'Figma final', 'https://figma.com/file/example') returning id`,
      [orgId, clientId],
    ));
    const alreadySent = await as(db, partner, () => one<{ sent_at: Date }>(
      `insert into public.project_deliverables (org_id, project_id, client_id, title, status, client_file_id)
       values ($1,$2,$3,'Entregado antes del registro','sent',$4) returning sent_at`,
      [orgId, projectId, clientId, file.id],
    ));
    expect(alreadySent.sent_at).toBeTruthy();
    await as(db, partner, async () => {
      await db.query("update public.project_deliverables set client_file_id = $2, status = 'sent' where id = $1", [deliverable.id, file.id]);
      await db.query("update public.project_deliverables set status = 'accepted' where id = $1", [deliverable.id]);
    });
    const saved = await one<{ status: string; sent_at: Date; accepted_at: Date }>(
      "select status, sent_at, accepted_at from public.project_deliverables where id = $1",
      [deliverable.id],
    );
    expect(saved.status).toBe("accepted");
    expect(saved.accepted_at.getTime()).toBeGreaterThanOrEqual(saved.sent_at.getTime());
    expect(await one<{ count: number }>("select count(*)::int as count from public.project_deliverable_events where deliverable_id = $1", [deliverable.id])).toEqual({ count: 3 });
    await expectHint(as(db, partner, () => db.query("update public.project_deliverables set title = 'Reescrito' where id = $1", [deliverable.id])), "deliverable_sent_immutable");
  });

  it("viewer puede consultar entregas, pero no crearlas ni cambiarlas", async () => {
    const projectId = await createProject();
    const deliverable = await as(db, partner, () => one<{ id: string }>(
      `insert into public.project_deliverables (org_id, project_id, client_id, title)
       values ($1, $2, $3, 'Landing') returning id`,
      [orgId, projectId, clientId],
    ));
    expect(await as(db, viewer, () => one<{ title: string }>("select title from public.project_deliverables where id = $1", [deliverable.id]))).toEqual({ title: "Landing" });
    expect((await as(db, viewer, () => db.query("update public.project_deliverables set title = 'Cambio' where id = $1 returning id", [deliverable.id]))).rows).toHaveLength(0);
    await expectHint(as(db, partner, () => db.query("update public.project_deliverables set created_by = $2 where id = $1", [deliverable.id, owner])), "deliverable_identity_immutable");
  });
});

describe("⌘K", () => {
  it("busca proyectos por nombre y por cliente (sin tildes), también los internos", async () => {
    await createProject({ name: "Rediseño web" });
    await createProject({ client_id: null, kind: "internal", name: "Web de Mataró" });
    await createProject({ name: "Archivado", archived_at: new Date().toISOString() });
    const search = (query: string, user = viewer) =>
      as(db, user, () =>
        all<{ kind: string; title: string; subtitle: string | null; client_id: string | null }>(
          "select kind, title, subtitle, client_id from public.search_org($1, $2) where kind = 'project' order by title",
          [orgId, query],
        ),
      );
    expect(await search("rediseno")).toEqual([{ kind: "project", title: "Rediseño web", subtitle: "Clínica Dental Mar Blau", client_id: clientId }]);
    expect(await search("mar blau")).toEqual([{ kind: "project", title: "Rediseño web", subtitle: "Clínica Dental Mar Blau", client_id: clientId }]);
    expect(await search("mataro")).toEqual([{ kind: "project", title: "Web de Mataró", subtitle: null, client_id: null }]);
    expect(await search("archivado")).toEqual([]);
    expect(await search("web", intruder)).toEqual([]);
    // Lo de antes sigue saliendo.
    expect(
      (await as(db, viewer, () => all<{ kind: string }>("select kind from public.search_org($1, 'mar blau')", [orgId]))).map((r) => r.kind),
    ).toContain("client");
  });
});
