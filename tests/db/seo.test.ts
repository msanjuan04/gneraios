import { beforeEach, describe, expect, it } from "vitest";
import { as, createDb, createOrg, createUser, type Db, onboardingPayload } from "./harness";

let db: Db;
let owner: string;
let partner: string;
let viewer: string;
let intruder: string;
let orgId: string;
let otherOrgId: string;
let clientId: string;

const SECRET = "v1.aaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.cccccccccccccccccccccc";

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0]!;
}

/** Como el servidor: service_role (salta RLS, como el cliente con la clave secreta). */
async function asService<T>(fn: () => Promise<T>): Promise<T> {
  await db.exec("set role service_role");
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}

async function addMember(userId: string, role: "viewer" | "partner", org = orgId) {
  await db.query("insert into public.members (org_id, user_id, role, full_name, initials) values ($1, $2, $3, 'Socio', 'SO')", [
    org,
    userId,
    role,
  ]);
}

async function connect(user = owner, org = orgId, secret = SECRET, email = "Marketing@Gnerai.com") {
  return as(db, user, async () =>
    (
      await one<{ id: string }>(
        "select public.connect_integration($1, 'google', $2, $3::text[], $4) as id",
        [org, email, ["openid", "email", "https://www.googleapis.com/auth/webmasters.readonly"], secret],
      )
    ).id,
  );
}

async function newProperty(fields: Record<string, unknown>, user = partner): Promise<string> {
  const row = { org_id: orgId, label: "gnerai.com", gsc_site_url: "sc-domain:gnerai.com", ...fields };
  const columns = Object.keys(row);
  const values = Object.values(row);
  return as(db, user, async () =>
    (
      await one<{ id: string }>(
        `insert into public.seo_properties (${columns.join(", ")}) values (${columns.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
        values,
      )
    ).id,
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
  await addMember(partner, "partner");
  await addMember(viewer, "viewer");
  clientId = await as(db, owner, async () =>
    (await one<{ id: string }>("insert into public.clients (org_id, display_name) values ($1, 'Clínica Dental') returning id", [orgId]))
      .id,
  );
});

describe("integraciones", () => {
  it("solo un owner conecta, y reconectar renueva la misma fila", async () => {
    await expect(connect(partner)).rejects.toMatchObject({ hint: "owner_required" });
    await expect(connect(intruder)).rejects.toMatchObject({ hint: "owner_required" });
    await expect(connect(owner, orgId, "  ")).rejects.toMatchObject({ hint: "secret_required" });

    const first = await connect();
    const again = await connect(owner, orgId, `${SECRET}x`);
    expect(again).toBe(first);
    const row = await as(db, owner, () =>
      one<{ status: string; account_email: string; connected_by: string; scopes: string[] }>(
        "select status, account_email, connected_by, scopes from public.integrations where id = $1",
        [first],
      ),
    );
    expect(row).toEqual({
      status: "connected",
      account_email: "marketing@gnerai.com",
      connected_by: owner,
      scopes: ["openid", "email", "https://www.googleapis.com/auth/webmasters.readonly"],
    });
    const stored = await asService(() =>
      one<{ refresh_token_encrypted: string }>("select refresh_token_encrypted from public.integrations where id = $1", [first]),
    );
    expect(stored.refresh_token_encrypted).toBe(`${SECRET}x`);
  });

  it("nadie salvo service_role lee el token: ni el owner, ni con select *, ni anon", async () => {
    await connect();
    for (const user of [owner, partner, viewer]) {
      await expect(as(db, user, () => db.query("select refresh_token_encrypted from public.integrations"))).rejects.toThrow(
        /permission denied/,
      );
      await expect(as(db, user, () => db.query("select * from public.integrations"))).rejects.toThrow(/permission denied/);
      const visible = await as(db, user, () => db.query("select id, status, account_email, last_sync_at from public.integrations"));
      expect(visible.rows).toHaveLength(1);
    }
    await expect(as(db, null, () => db.query("select id from public.integrations"))).rejects.toThrow(/permission denied/);

    // La auditoría (que leen los owners) tampoco lo guarda.
    const audit = await as(db, owner, () =>
      db.query<{ new_data: Record<string, unknown> }>("select new_data from public.audit_log where table_name = 'integrations'"),
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]!.new_data).not.toHaveProperty("refresh_token_encrypted");
    expect(JSON.stringify(audit.rows)).not.toContain(SECRET);
  });

  it("un miembro no escribe la integración directamente: solo con las RPC", async () => {
    const id = await connect();
    await expect(
      as(db, owner, () => db.query("update public.integrations set status = 'error' where id = $1", [id])),
    ).rejects.toThrow(/permission denied/);
    await expect(
      as(db, owner, () =>
        db.query(
          "insert into public.integrations (org_id, provider, status, refresh_token_encrypted) values ($1, 'google', 'connected', 'x')",
          [otherOrgId],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(as(db, owner, () => db.query("delete from public.integrations where id = $1", [id]))).rejects.toThrow(
      /permission denied/,
    );
  });

  it("desconectar borra el token y conserva la conexión (y los datos)", async () => {
    const id = await connect();
    await expect(as(db, partner, () => db.query("select public.disconnect_integration($1, 'google')", [orgId]))).rejects.toMatchObject(
      { hint: "owner_required" },
    );
    await as(db, owner, () => db.query("select public.disconnect_integration($1, 'google')", [orgId]));
    const row = await asService(() =>
      one<{ status: string; refresh_token_encrypted: string | null }>(
        "select status, refresh_token_encrypted from public.integrations where id = $1",
        [id],
      ),
    );
    expect(row).toEqual({ status: "disconnected", refresh_token_encrypted: null });
    // Una conexión "conectada" sin token es imposible.
    await expect(
      asService(() => db.query("update public.integrations set status = 'connected' where id = $1", [id])),
    ).rejects.toThrow(/check constraint/);
  });

  it("otra org no ve la conexión, y la sincronización diaria no llena la auditoría", async () => {
    const id = await connect();
    expect((await as(db, intruder, () => db.query("select id from public.integrations"))).rows).toHaveLength(0);

    const count = async () =>
      (await one<{ n: number }>("select count(*)::int as n from public.audit_log where table_name = 'integrations'")).n;
    const before = await count();
    await asService(() =>
      db.query("update public.integrations set last_sync_at = now(), last_error = 'timeout' where id = $1", [id]),
    );
    expect(await count()).toBe(before);
    await asService(() => db.query("update public.integrations set status = 'error', last_error = 'invalid_grant' where id = $1", [id]));
    expect(await count()).toBe(before + 1);
  });
});

describe("propiedades", () => {
  it("las ve cualquier miembro, las lleva un socio y no hay borrado", async () => {
    const id = await newProperty({ label: "  gnerai.com  ", ga4_property_id: " properties/123456789 " });
    const row = await as(db, viewer, () =>
      one<{ label: string; ga4_property_id: string; client_id: string | null }>(
        "select label, ga4_property_id, client_id from public.seo_properties where id = $1",
        [id],
      ),
    );
    expect(row).toEqual({ label: "gnerai.com", ga4_property_id: "123456789", client_id: null });

    await expect(newProperty({ gsc_site_url: "https://www.otra.com/" }, viewer)).rejects.toThrow(/row-level security/);
    const updated = await as(db, viewer, () => db.query("update public.seo_properties set label = 'x' where id = $1 returning id", [id]));
    expect(updated.rows).toHaveLength(0);
    const deleted = await as(db, partner, () => db.query("delete from public.seo_properties where id = $1 returning id", [id]));
    expect(deleted.rows).toHaveLength(0);
    expect((await as(db, intruder, () => db.query("select id from public.seo_properties"))).rows).toHaveLength(0);
  });

  it("necesita Search Console o GA4, y no repite la misma web en la org", async () => {
    await expect(newProperty({ gsc_site_url: null })).rejects.toThrow(/check constraint/);
    await expect(newProperty({ gsc_site_url: "gnerai.com" })).rejects.toThrow(/check constraint/);
    await newProperty({});
    await expect(newProperty({ label: "Otra vez" })).rejects.toThrow(/seo_properties_gsc_idx/);
  });

  it("una web de cliente no puede apuntar al cliente de otra org", async () => {
    const foreign = await as(db, intruder, async () =>
      (await one<{ id: string }>("insert into public.clients (org_id, display_name) values ($1, 'Ajeno') returning id", [otherOrgId]))
        .id,
    );
    await expect(newProperty({ client_id: foreign })).rejects.toThrow(/foreign key/);
    await newProperty({ client_id: clientId, gsc_site_url: "https://www.clinica.example/" });
  });

  it("una principal por dueño (la org y cada cliente); archivar deja de ser principal", async () => {
    const first = await newProperty({ is_primary: true });
    const second = await newProperty({ label: "blog", gsc_site_url: "https://blog.gnerai.com/", is_primary: true });
    const clientSite = await newProperty({ client_id: clientId, gsc_site_url: "https://www.clinica.example/", is_primary: true });
    const primaries = async () =>
      (await db.query<{ id: string }>("select id from public.seo_properties where is_primary order by created_at")).rows.map((r) => r.id);
    expect(await primaries()).toEqual([second, clientSite]);

    await as(db, partner, () => db.query("update public.seo_properties set is_primary = true where id = $1", [first]));
    expect(await primaries()).toEqual([first, clientSite]);
    await as(db, partner, () => db.query("update public.seo_properties set archived_at = now() where id = $1", [first]));
    expect(await primaries()).toEqual([clientSite]);
  });
});

describe("hechos diarios", () => {
  let propertyId: string;

  beforeEach(async () => {
    propertyId = await newProperty({ ga4_property_id: "123456789" });
  });

  const upsertDaily = (clicks: number, impressions: number, position: number) =>
    db.query(
      `insert into public.seo_daily_metrics (org_id, property_id, metric_on, clicks, impressions, position, source)
       values ($1, $2, '2026-09-20', $3, $4, $5, 'gsc')
       on conflict (property_id, metric_on) do update
         set clicks = excluded.clicks, impressions = excluded.impressions, position = excluded.position, source = excluded.source`,
      [orgId, propertyId, clicks, impressions, position],
    );

  const upsertQuery = (query: string, page: string, clicks: number) =>
    db.query(
      `insert into public.seo_query_daily (org_id, property_id, metric_on, query, page, clicks, impressions, position, source)
       values ($1, $2, '2026-09-20', $3, $4, $5, 100, 4.2, 'gsc')
       on conflict (property_id, metric_on, key_hash) do update set clicks = excluded.clicks`,
      [orgId, propertyId, query, page, clicks],
    );

  it("solo los escribe el servidor; repetir la sincronización no duplica", async () => {
    await expect(as(db, owner, () => upsertDaily(1, 10, 3))).rejects.toThrow(/permission denied/);
    await expect(as(db, owner, () => upsertQuery("seo mataró", "https://gnerai.com/", 1))).rejects.toThrow(/permission denied/);
    await expect(
      as(db, owner, () => db.query("delete from public.seo_daily_metrics where property_id = $1", [propertyId])),
    ).rejects.toThrow(/permission denied/);

    await asService(async () => {
      await upsertDaily(12, 400, 7.456);
      await upsertDaily(15, 500, 6.5);
      await upsertQuery("agencia seo mataró", "https://gnerai.com/seo/", 3);
      await upsertQuery("agencia seo mataró", "https://gnerai.com/seo/", 4);
      await upsertQuery("agencia seo mataró", "https://gnerai.com/", 1);
      for (let round = 0; round < 2; round++) {
        for (const channel of ["all", "organic_search"]) {
          await db.query(
            `insert into public.web_analytics_daily (org_id, property_id, metric_on, channel, sessions, users, engaged_sessions, conversions, source)
             values ($1, $2, '2026-09-20', $3, 40, 35, 25, 2, 'ga4')
             on conflict (property_id, metric_on, channel) do update set sessions = excluded.sessions`,
            [orgId, propertyId, channel],
          );
        }
      }
    });

    const daily = await as(db, viewer, () =>
      db.query("select clicks, impressions, ctr_bps, position::float as position from public.seo_daily_metrics"),
    );
    expect(daily.rows).toEqual([{ clicks: 15, impressions: 500, ctr_bps: 300, position: 6.5 }]);
    const queries = await as(db, viewer, () =>
      db.query<{ page: string; clicks: number; key_hash: string }>(
        "select page, clicks, key_hash from public.seo_query_daily order by page",
      ),
    );
    expect(queries.rows.map((r) => [r.page, r.clicks])).toEqual([
      ["https://gnerai.com/", 1],
      ["https://gnerai.com/seo/", 4],
    ]);
    expect(queries.rows[0]!.key_hash).toMatch(/^[0-9a-f-]{36}$/);
    expect((await one<{ n: number }>("select count(*)::int as n from public.web_analytics_daily")).n).toBe(2);
    // El CTR se deriva: no se puede escribir.
    await expect(
      asService(() => db.query("update public.seo_daily_metrics set ctr_bps = 1 where property_id = $1", [propertyId])),
    ).rejects.toThrow(/can only be updated to DEFAULT/);
  });

  it("un hecho no puede colgar de la propiedad de otra org, y otra org no ve nada", async () => {
    await expect(
      asService(() =>
        db.query(
          `insert into public.seo_daily_metrics (org_id, property_id, metric_on, clicks, impressions, position, source)
           values ($1, $2, '2026-09-20', 1, 10, 3, 'gsc')`,
          [otherOrgId, propertyId],
        ),
      ),
    ).rejects.toThrow(/foreign key/);
    await asService(() => upsertDaily(3, 30, 5));
    await asService(() =>
      db.query(
        "insert into public.seo_sync_state (org_id, property_id, provider, synced_from, synced_to) values ($1, $2, 'gsc', '2025-05-01', '2026-09-20')",
        [orgId, propertyId],
      ),
    );
    for (const table of ["seo_daily_metrics", "seo_query_daily", "web_analytics_daily", "seo_sync_state", "seo_properties_overview"]) {
      expect((await as(db, intruder, () => db.query(`select 1 from public.${table}`))).rows).toHaveLength(0);
    }
    expect((await as(db, viewer, () => db.query("select 1 from public.seo_sync_state"))).rows).toHaveLength(1);
  });

  it("la vista de propiedades dice qué tramo de datos hay y de dónde sale", async () => {
    await asService(async () => {
      await upsertDaily(3, 30, 5);
      await db.query(
        `insert into public.seo_daily_metrics (org_id, property_id, metric_on, clicks, impressions, position, source)
         values ($1, $2, '2025-06-01', 1, 10, 9, 'demo')`,
        [orgId, propertyId],
      );
      await db.query(
        "insert into public.seo_sync_state (org_id, property_id, provider, synced_from, synced_to, last_error) values ($1, $2, 'ga4', '2025-06-01', '2026-09-19', 'quota')",
        [orgId, propertyId],
      );
    });
    const row = await as(db, viewer, () =>
      one<Record<string, unknown>>(
        `select label, client_name, first_metric_on::text, last_metric_on::text, metric_source, last_web_on,
                ga4_synced_to::text, ga4_last_error, gsc_synced_to
         from public.seo_properties_overview where id = $1`,
        [propertyId],
      ),
    );
    expect(row).toEqual({
      label: "gnerai.com",
      client_name: null,
      first_metric_on: "2025-06-01",
      last_metric_on: "2026-09-20",
      metric_source: "gsc",
      last_web_on: null,
      ga4_synced_to: "2026-09-19",
      ga4_last_error: "quota",
      gsc_synced_to: null,
    });
  });
});

describe("consultas agregadas (seo_query_stats)", () => {
  let propertyId: string;

  async function fact(day: string, query: string, page: string, clicks: number, impressions: number, position: number) {
    await asService(() =>
      db.query(
        `insert into public.seo_query_daily (org_id, property_id, metric_on, query, page, clicks, impressions, position, source)
         values ($1, $2, $3, $4, $5, $6, $7, $8, 'gsc')`,
        [orgId, propertyId, day, query, page, clicks, impressions, position],
      ),
    );
  }

  const stats = (user: string, args: Record<string, unknown>) =>
    as(db, user, async () => {
      const { rows } = await db.query<Record<string, unknown>>(
        `select key, clicks::int, impressions::int, avg_position::float, compare_clicks::int, compare_impressions::int,
                compare_avg_position::float
         from public.seo_query_stats(
           p_property_id => $1, p_dimension => $2, p_from => $3, p_to => $4, p_compare_from => $5, p_compare_to => $6,
           p_order => $7, p_min_position => $8, p_max_position => $9, p_min_impressions => $10, p_limit => $11)`,
        [
          propertyId,
          args.dimension ?? "query",
          "2026-09-01",
          "2026-09-28",
          args.compare === false ? null : "2026-08-04",
          args.compare === false ? null : "2026-08-31",
          args.order ?? "clicks",
          args.minPosition ?? null,
          args.maxPosition ?? null,
          args.minImpressions ?? null,
          args.limit ?? 50,
        ],
      );
      return rows;
    });

  beforeEach(async () => {
    propertyId = await newProperty({});
    // Periodo actual (septiembre) y de comparación (agosto).
    await fact("2026-09-02", "diseño web mataró", "https://gnerai.com/web/", 10, 100, 2);
    await fact("2026-09-03", "diseño web mataró", "https://gnerai.com/web/", 0, 300, 6);
    await fact("2026-09-03", "diseño web mataró", "https://gnerai.com/", 2, 100, 3);
    await fact("2026-08-10", "diseño web mataró", "https://gnerai.com/web/", 4, 200, 9);
    await fact("2026-09-05", "agencia seo maresme", "https://gnerai.com/seo/", 1, 900, 8);
    await fact("2026-08-06", "agencia seo maresme", "https://gnerai.com/seo/", 6, 500, 5);
    await fact("2026-08-07", "gnerai", "https://gnerai.com/", 20, 40, 1);
    // Fuera de los dos periodos: no cuenta.
    await fact("2026-07-01", "gnerai", "https://gnerai.com/", 99, 99, 1);
  });

  it("agrega por consulta con la posición ponderada por impresiones y compara periodos", async () => {
    expect(await stats(viewer, {})).toEqual([
      {
        key: "diseño web mataró",
        clicks: 12,
        impressions: 500,
        avg_position: 4.6, // (2·100 + 6·300 + 3·100) / 500
        compare_clicks: 4,
        compare_impressions: 200,
        compare_avg_position: 9,
      },
      {
        key: "agencia seo maresme",
        clicks: 1,
        impressions: 900,
        avg_position: 8,
        compare_clicks: 6,
        compare_impressions: 500,
        compare_avg_position: 5,
      },
    ]);
  });

  it("ordena por ganancia o pérdida (incluye lo que ha desaparecido) y filtra oportunidades", async () => {
    expect((await stats(viewer, { order: "gain" })).map((r) => r.key)).toEqual(["diseño web mataró"]);
    expect((await stats(viewer, { order: "loss" })).map((r) => [r.key, r.clicks, r.compare_clicks])).toEqual([
      ["gnerai", 0, 20],
      ["agencia seo maresme", 1, 6],
    ]);
    expect(
      (await stats(viewer, { order: "impressions", minPosition: 4, maxPosition: 15, minImpressions: 600 })).map((r) => r.key),
    ).toEqual(["agencia seo maresme"]);
    expect((await stats(viewer, { limit: 1 })).map((r) => r.key)).toEqual(["diseño web mataró"]);
    // Sin periodo de comparación, las columnas de comparación salen a cero.
    expect((await stats(viewer, { compare: false }))[0]).toMatchObject({ compare_clicks: 0, compare_avg_position: null });
  });

  it("agrega por página, y otra org no obtiene nada", async () => {
    expect((await stats(viewer, { dimension: "page" })).map((r) => [r.key, r.clicks, r.impressions])).toEqual([
      ["https://gnerai.com/web/", 10, 400],
      ["https://gnerai.com/", 2, 100],
      ["https://gnerai.com/seo/", 1, 900],
    ]);
    expect(await stats(intruder, {})).toEqual([]);
    expect(await stats(viewer, { dimension: "nope" })).toEqual([]);
    await expect(
      as(db, null, () => db.query("select * from public.seo_query_stats($1, 'query', '2026-09-01', '2026-09-28')", [propertyId])),
    ).rejects.toThrow(/permission denied/);
  });
});
