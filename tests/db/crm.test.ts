import { beforeEach, describe, expect, it } from "vitest";
import { as, createDb, createOrg, createUser, type Db, onboardingPayload } from "./harness";

let db: Db;
let owner: string;
let orgId: string;
let stages: Record<string, string>;

async function stageIds(org: string) {
  const { rows } = await db.query<{ id: string; name: string }>(
    "select id, name from public.pipeline_stages where org_id = $1",
    [org],
  );
  return Object.fromEntries(rows.map((r) => [r.name, r.id]));
}

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0]!;
}

async function newClient(name: string, user = owner, org = orgId): Promise<string> {
  return as(db, user, async () =>
    (await one<{ id: string }>("insert into public.clients (org_id, display_name) values ($1, $2) returning id", [org, name])).id,
  );
}

async function newDeal(clientId: string, stage: string, user = owner, org = orgId): Promise<string> {
  return as(db, user, async () =>
    (
      await one<{ id: string }>(
        "insert into public.deals (org_id, client_id, title, stage_id, est_one_off_cents, est_mrr_cents) values ($1, $2, 'Web + SEO', $3, 300000, 45000) returning id",
        [org, clientId, stage],
      )
    ).id,
  );
}

beforeEach(async () => {
  db = await createDb();
  owner = await createUser(db, "owner@example.com");
  orgId = await createOrg(db, owner);
  stages = await stageIds(orgId);
});

describe("configuración del pipeline", () => {
  it("la base de datos impide quedarse sin etapa abierta, ganada o perdida", async () => {
    await expect(
      as(db, owner, () =>
        db.query("update public.pipeline_stages set archived_at = now() where org_id = $1 and kind = 'lost'", [orgId]),
      ),
    ).rejects.toThrow(/al menos una etapa/);
    // Archivar una de las dos ganadas (queda la otra) sí se puede.
    await as(db, owner, () => db.query("update public.pipeline_stages set archived_at = now() where id = $1", [stages["Activo"]]));
  });

  it("toda org nueva nace con etapas, fuentes y motivos editables", async () => {
    expect(Object.keys(stages).sort()).toEqual(
      ["Activo", "Ganado", "Lead", "Negociación", "Perdido", "Propuesta enviada", "Reunión"].sort(),
    );
    const counts = await one<{ sources: number; reasons: number }>(
      `select (select count(*)::int from public.acquisition_sources where org_id = $1) as sources,
              (select count(*)::int from public.loss_reasons where org_id = $1) as reasons`,
      [orgId],
    );
    expect(counts).toEqual({ sources: 6, reasons: 6 });
  });
});

describe("deals", () => {
  it("el historial de etapas lo escribe el trigger: al crear y al mover, no al editar otra cosa", async () => {
    const client = await newClient("Restaurante del Maresme");
    const deal = await newDeal(client, stages["Lead"]!);
    await as(db, owner, async () => {
      await db.query("update public.deals set next_action = 'Llamar' where id = $1", [deal]);
      await db.query("update public.deals set stage_id = $2 where id = $1", [deal, stages["Reunión"]]);
    });
    const { rows } = await db.query<{ from_name: string | null; to_name: string; changed_by: string }>(
      `select fs.name as from_name, ts.name as to_name, h.changed_by
       from public.deal_stage_history h
       join public.pipeline_stages ts on ts.id = h.to_stage_id
       left join public.pipeline_stages fs on fs.id = h.from_stage_id
       where h.deal_id = $1 order by h.id`,
      [deal],
    );
    expect(rows).toEqual([
      { from_name: null, to_name: "Lead", changed_by: owner },
      { from_name: "Lead", to_name: "Reunión", changed_by: owner },
    ]);
  });

  it("permite fechar el historial hacia atrás al importar o sembrar datos", async () => {
    const client = await newClient("Cliente histórico");
    await db.query("select set_config('app.stage_changed_at', '2025-03-01T10:00:00Z', false)");
    await newDeal(client, stages["Lead"]!);
    await db.query("select set_config('app.stage_changed_at', '', false)");
    const { changed_at } = await one<{ changed_at: Date }>("select changed_at from public.deal_stage_history");
    expect(changed_at.toISOString()).toBe("2025-03-01T10:00:00.000Z");
  });

  it("perder exige motivo, y reabrir el deal lo limpia", async () => {
    const client = await newClient("Clínica");
    const deal = await newDeal(client, stages["Propuesta enviada"]!);
    await expect(
      as(db, owner, () => db.query("update public.deals set stage_id = $2 where id = $1", [deal, stages["Perdido"]])),
    ).rejects.toThrow(/motivo/);

    const reason = await one<{ id: string }>("select id from public.loss_reasons where org_id = $1 and name = 'Precio'", [orgId]);
    await as(db, owner, () =>
      db.query("update public.deals set stage_id = $2, loss_reason_id = $3, loss_note = 'Caro' where id = $1", [
        deal,
        stages["Perdido"],
        reason.id,
      ]),
    );
    await as(db, owner, () => db.query("update public.deals set stage_id = $2 where id = $1", [deal, stages["Negociación"]]));
    expect(await one("select loss_reason_id, loss_note from public.deals where id = $1", [deal])).toEqual({
      loss_reason_id: null,
      loss_note: null,
    });
  });

  it("un deal no puede apuntar al cliente de otra org aunque se conozca su id", async () => {
    const intruder = await createUser(db, "otro@example.com");
    const otherOrg = await createOrg(db, intruder, onboardingPayload({ org: { name: "Otra", slug: "otra" }, invitations: [] }));
    const foreignClient = await newClient("Cliente ajeno", intruder, otherOrg);
    await expect(newDeal(foreignClient, stages["Lead"]!)).rejects.toThrow(/foreign key/);
  });
});

describe("mensajes del expediente", () => {
  it("registra dirección y canal, y conserva el mensaje como hecho inmutable", async () => {
    const client = await newClient("Prospecto");
    const { id } = await as(db, owner, () => one<{ id: string }>(
      `insert into public.activities
         (org_id, client_id, kind, title, body, direction, channel, counterpart)
       values ($1, $2, 'email', 'Propuesta recibida', 'Necesitamos una propuesta para la web', 'incoming', 'whatsapp', 'Contacto')
       returning id`,
      [orgId, client],
    ));
    await expect(as(db, owner, () => db.query("update public.activities set body = 'texto cambiado' where id = $1", [id])))
      .rejects.toThrow(/no se editan/);
    await expect(as(db, owner, () => db.query("delete from public.activities where id = $1", [id])))
      .rejects.toThrow(/no se borran/);
    expect(await one("select direction, channel, body from public.activities where id = $1", [id])).toEqual({
      direction: "incoming",
      channel: "whatsapp",
      body: "Necesitamos una propuesta para la web",
    });
  });

  it("rechaza clasificar llamadas o notas con campos de mensaje", async () => {
    const client = await newClient("Prospecto sin mensaje");
    await expect(as(db, owner, () => db.query(
      `insert into public.activities (org_id, client_id, kind, title, direction)
       values ($1, $2, 'call', 'Llamada', 'incoming')`,
      [orgId, client],
    ))).rejects.toThrow(/activities_message_context_check/);
  });
});

describe("RLS del CRM", () => {
  it("un viewer lee pero no escribe; otra org no ve nada", async () => {
    const viewer = await createUser(db, "viewer@example.com");
    await db.query(
      "insert into public.members (org_id, user_id, role, full_name, initials) values ($1, $2, 'viewer', 'Visor', 'VI')",
      [orgId, viewer],
    );
    const client = await newClient("Inmobiliaria");
    await newDeal(client, stages["Lead"]!);

    await as(db, viewer, async () => {
      expect((await db.query("select * from public.deals_board")).rows).toHaveLength(1);
    });
    await expect(newClient("No debería", viewer)).rejects.toThrow(/row-level security/);

    const outsider = await createUser(db, "fuera@example.com");
    await as(db, outsider, async () => {
      for (const view of ["clients", "deals", "deals_board", "clients_overview", "client_timeline", "deal_stage_history"]) {
        expect((await db.query(`select * from public.${view}`)).rows, view).toHaveLength(0);
      }
    });
  });
});

describe("vistas derivadas", () => {
  it("el estado del cliente sale de sus contratos: ganar un deal no lo hace cliente", async () => {
    const client = await newClient("Bodega");
    const deal = await newDeal(client, stages["Negociación"]!);
    const status = () => one<{ status: string }>("select status from public.clients_overview where id = $1", [client]);
    expect((await status()).status).toBe("lead");
    await as(db, owner, () => db.query("update public.deals set stage_id = $2 where id = $1", [deal, stages["Ganado"]]));
    // Los estados activo, pausado y ex-cliente se prueban en facturacion.test.ts.
    expect((await status()).status).toBe("lead");
  });

  it("el tablero calcula probabilidad efectiva y desde cuándo está en la etapa", async () => {
    const client = await newClient("Gimnasio");
    const deal = await newDeal(client, stages["Propuesta enviada"]!);
    const row = await as(db, owner, () =>
      one<{ probability_bps: number; stage_entered_at: Date | null; closed_at: Date | null }>(
        "select probability_bps, stage_entered_at, closed_at from public.deals_board where id = $1",
        [deal],
      ),
    );
    expect(row.probability_bps).toBe(5000);
    expect(row.stage_entered_at).not.toBeNull();
    expect(row.closed_at).toBeNull();
  });

  it("el timeline une actividades y cambios de etapa sin duplicar datos", async () => {
    const client = await newClient("Hotel");
    const deal = await newDeal(client, stages["Lead"]!);
    await as(db, owner, async () => {
      await db.query(
        "insert into public.activities (org_id, client_id, deal_id, kind, title) values ($1, $2, $3, 'call', 'Primera llamada')",
        [orgId, client, deal],
      );
      await db.query("update public.deals set stage_id = $2 where id = $1", [deal, stages["Reunión"]]);
    });
    const { rows } = await as(db, owner, () =>
      db.query<{ kind: string; meta: { to?: string } | null }>(
        "select kind, meta from public.client_timeline where client_id = $1 order by at",
        [client],
      ),
    );
    expect(rows.map((r) => r.kind).sort()).toEqual(["call", "deal_created", "stage_change"]);
    expect(rows.find((r) => r.kind === "stage_change")?.meta?.to).toBe("Reunión");
  });
});

describe("búsqueda", () => {
  it("encuentra sin acentos ni mayúsculas y solo dentro de la propia org", async () => {
    await newClient("Àtic Mataró");
    const intruder = await createUser(db, "otro@example.com");
    const otherOrg = await createOrg(db, intruder, onboardingPayload({ org: { name: "Otra", slug: "otra" }, invitations: [] }));
    await newClient("Mataró Ajeno", intruder, otherOrg);

    const { rows } = await as(db, owner, () =>
      db.query<{ kind: string; title: string }>("select kind, title from public.search_org($1, 'mataro')", [orgId]),
    );
    expect(rows).toEqual([{ kind: "client", title: "Àtic Mataró" }]);

    const leaked = await as(db, owner, () => db.query("select * from public.search_org($1, 'mataro')", [otherOrg]));
    expect(leaked.rows).toHaveLength(0);
  });
});
