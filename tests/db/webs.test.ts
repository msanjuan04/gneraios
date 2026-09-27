import { beforeEach, describe, expect, it } from "vitest";
import { currentStreak, isNormalizedSiteUrl, normalizeSiteUrl, windowCounts } from "@/domain/sites";
import { as, createDb, createOrg, createUser, type Db, onboardingPayload } from "./harness";

let db: Db;
let owner: string;
let partner: string;
let viewer: string;
let intruder: string;
let orgId: string;
let otherOrgId: string;
let clientId: string;

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0]!;
}

async function all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

async function addMember(userId: string, role: "viewer" | "partner", initials: string): Promise<void> {
  await db.query("insert into public.members (org_id, user_id, role, full_name, initials) values ($1, $2, $3, 'Socio', $4)", [
    orgId,
    userId,
    role,
    initials,
  ]);
}

async function createSite(values: Record<string, unknown> = {}, user = partner): Promise<string> {
  const row = { org_id: orgId, url: "https://clinicamarblau.com", label: "Clínica Mar Blau", ...values };
  const columns = Object.keys(row);
  return as(db, user, async () =>
    (
      await one<{ id: string }>(
        `insert into public.sites (${columns.join(", ")}) values (${columns.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
        Object.values(row),
      )
    ).id,
  );
}

/** Una comprobación hace `hoursAgo` horas (como service_role: el cron). */
async function addCheck(siteId: string, hoursAgo: number, ok: boolean, extra: Record<string, unknown> = {}, org = orgId): Promise<void> {
  const row = {
    org_id: org,
    site_id: siteId,
    ok,
    status_code: ok ? 200 : 503,
    response_ms: ok ? 350 : null,
    error: ok ? null : "http",
    ...extra,
  };
  const columns = Object.keys(row);
  await db.query(
    `insert into public.site_checks (checked_at, ${columns.join(", ")})
     values (now() - make_interval(secs => $1::double precision * 3600), ${columns.map((_, i) => `$${i + 2}`).join(", ")})`,
    [hoursAgo, ...Object.values(row)],
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
  await addMember(partner, "partner", "PA");
  await addMember(viewer, "viewer", "VI");
  clientId = await as(db, owner, async () =>
    (await one<{ id: string }>("insert into public.clients (org_id, display_name) values ($1, 'Clínica Dental Mar Blau') returning id", [orgId])).id,
  );
});

describe("webs: permisos", () => {
  it("cualquier miembro las lee; otra org no ve nada; sin sesión, nada", async () => {
    const siteId = await createSite({ client_id: clientId });
    await addCheck(siteId, 0.1, true);

    expect(await as(db, viewer, () => all("select url, client_id from public.sites"))).toEqual([
      { url: "https://clinicamarblau.com", client_id: clientId },
    ]);
    expect(await as(db, viewer, () => all("select site_id from public.site_checks"))).toEqual([{ site_id: siteId }]);
    expect(await as(db, viewer, () => all("select client_name, checks_24h from public.sites_overview"))).toEqual([
      { client_name: "Clínica Dental Mar Blau", checks_24h: 1 },
    ]);

    expect(await as(db, intruder, () => all("select id from public.sites"))).toEqual([]);
    expect(await as(db, intruder, () => all("select id from public.site_checks"))).toEqual([]);
    expect(await as(db, intruder, () => all("select id from public.sites_overview"))).toEqual([]);

    await expect(as(db, null, () => db.query("select id from public.sites"))).rejects.toThrow(/permission denied/);
    await expect(as(db, null, () => db.query("select id from public.site_checks"))).rejects.toThrow(/permission denied/);
    await expect(as(db, null, () => db.query("select id from public.sites_overview"))).rejects.toThrow(/permission denied/);
  });

  it("un viewer no escribe nada: ni webs ni comprobaciones", async () => {
    const siteId = await createSite();
    await expect(createSite({ url: "https://hotel-llevant.cat" }, viewer)).rejects.toThrow(/row-level security/);
    await as(db, viewer, () => db.query("update public.sites set label = 'Cambiada', is_active = false where id = $1", [siteId]));
    await as(db, viewer, () => db.query("delete from public.sites where id = $1", [siteId]));
    expect(await one("select label, is_active from public.sites where id = $1", [siteId])).toEqual({ label: "Clínica Mar Blau", is_active: true });

    await expect(
      as(db, viewer, () => db.query("insert into public.site_checks (org_id, site_id, ok) values ($1, $2, true)", [orgId, siteId])),
    ).rejects.toThrow(/row-level security/);
  });

  it("un socio las da de alta, las edita, las pausa y las quita (con sus comprobaciones)", async () => {
    const siteId = await createSite({ client_id: clientId, domain_expires_on: "2027-03-01" });
    await as(db, partner, () =>
      db.query("update public.sites set label = 'Mar Blau', hosted_by_us = false, is_active = false where id = $1", [siteId]),
    );
    expect(await one("select label, hosted_by_us, is_active from public.sites where id = $1", [siteId])).toEqual({
      label: "Mar Blau",
      hosted_by_us: false,
      is_active: false,
    });

    // «Comprobar ahora»: un socio registra una comprobación.
    await as(db, partner, () =>
      db.query("insert into public.site_checks (org_id, site_id, ok, status_code, response_ms) values ($1, $2, true, 200, 410)", [orgId, siteId]),
    );
    expect(await all("select ok from public.site_checks where site_id = $1", [siteId])).toEqual([{ ok: true }]);

    await as(db, partner, () => db.query("delete from public.sites where id = $1", [siteId]));
    expect(await all("select id from public.sites")).toEqual([]);
    expect(await all("select id from public.site_checks")).toEqual([]);
    expect((await all<{ action: string }>("select action from public.audit_log where table_name = 'sites' order by id")).map((a) => a.action)).toEqual([
      "insert",
      "update",
      "delete",
    ]);
  });

  it("una comprobación es un hecho: ni un socio ni un owner la cambian o la borran", async () => {
    const siteId = await createSite();
    await addCheck(siteId, 1, false);
    for (const user of [partner, owner]) {
      await expect(as(db, user, () => db.query("update public.site_checks set ok = true, error = null"))).rejects.toThrow(/permission denied/);
      await expect(as(db, user, () => db.query("delete from public.site_checks"))).rejects.toThrow(/permission denied/);
    }
    expect(await all("select ok from public.site_checks")).toEqual([{ ok: false }]);
  });

  it("otra org no escribe en la nuestra", async () => {
    await expect(createSite({ url: "https://intrusa.com" }, intruder)).rejects.toThrow(/row-level security/);
  });
});

describe("webs: datos válidos", () => {
  it("la URL tiene que ser https con un dominio de verdad, ya normalizada (la misma regla que la app)", async () => {
    const valid = [
      "https://clinicamarblau.com",
      "https://www.gnerai.com/es",
      "https://gnerai.com?lang=ca",
      "https://gnerai.com:8443/estado",
      "https://xn--caf-dma.com",
      "https://a.b.example.co.uk/ruta/Con/Mayusculas/",
    ];
    const invalid = [
      "http://gnerai.com",
      "https://gnerai.com/",
      "https://Gnerai.com",
      "gnerai.com",
      "https://localhost",
      "https://127.0.0.1",
      "https://gnerai.com/#contacto",
      "https://gne rai.com",
      "https://gne_rai.com",
      "ftp://gnerai.com",
      `https://gnerai.com/${"a".repeat(2100)}`,
    ];
    let n = 0;
    for (const url of valid) {
      expect(isNormalizedSiteUrl(url), url).toBe(true);
      await createSite({ url, label: `Web ${(n += 1)}` });
    }
    for (const url of invalid) {
      expect(isNormalizedSiteUrl(url), url).toBe(false);
      await expect(createSite({ url }), url).rejects.toMatchObject({ code: "23514" });
    }
    // Lo que normaliza la app, la base de datos lo acepta.
    for (const input of ["http://www.Hotel-Llevant.cat/", "café.com/menú", "gnerai.com:443"]) {
      await createSite({ url: normalizeSiteUrl(input)!, label: input });
    }
  });

  it("la misma web no se da de alta dos veces en una org (en otra, sí)", async () => {
    await createSite();
    await expect(createSite({ label: "Otra vez" })).rejects.toMatchObject({ code: "23505" });
    await as(db, intruder, () =>
      db.query("insert into public.sites (org_id, url) values ($1, 'https://clinicamarblau.com')", [otherOrgId]),
    );
  });

  it("el cliente tiene que ser de la org (FK compuesta); sin cliente también vale", async () => {
    const foreignClient = await as(db, intruder, async () =>
      (await one<{ id: string }>("insert into public.clients (org_id, display_name) values ($1, 'Ajeno') returning id", [otherOrgId])).id,
    );
    await expect(createSite({ client_id: foreignClient })).rejects.toMatchObject({ code: "23503" });
    await createSite({ client_id: null, url: "https://gnerai.com", label: null });
    await createSite({ client_id: clientId, url: "https://clinicamarblau.cat" });
  });

  it("una comprobación es de una web de su org, y o va bien o dice qué falló", async () => {
    const siteId = await createSite();
    const foreignSite = await as(db, intruder, async () =>
      (await one<{ id: string }>("insert into public.sites (org_id, url) values ($1, 'https://ajena.com') returning id", [otherOrgId])).id,
    );
    await expect(addCheck(foreignSite, 0, true)).rejects.toMatchObject({ code: "23503" });
    await expect(addCheck(siteId, 0, true, {}, otherOrgId)).rejects.toMatchObject({ code: "23503" });
    await expect(addCheck(siteId, 0, false, { error: null })).rejects.toMatchObject({ code: "23514" });
    await expect(addCheck(siteId, 0, true, { error: "timeout" })).rejects.toMatchObject({ code: "23514" });
    await expect(addCheck(siteId, 0, false, { error: "Timeout!" })).rejects.toMatchObject({ code: "23514" });
    await expect(addCheck(siteId, 0, true, { status_code: 99 })).rejects.toMatchObject({ code: "23514" });
    await expect(addCheck(siteId, 0, true, { response_ms: -1 })).rejects.toMatchObject({ code: "23514" });
    await addCheck(siteId, 0, false, { error: "timeout", status_code: null, tls_expires_at: "2027-01-01T00:00:00Z" });
  });

  it("los avisos de Webs son tipos de aviso", async () => {
    for (const kind of ["site_down", "site_up", "ssl_expiring", "domain_expiring"]) {
      await db.query("insert into public.notifications (org_id, kind, params, href, dedupe_key) values ($1, $2::public.notification_kind, '{}', '/sites', $3)", [
        orgId,
        kind,
        `${kind}:test`,
      ]);
    }
    expect((await all("select kind from public.notifications where href = '/sites' order by kind")).length).toBe(4);
  });
});

describe("webs: vista sites_overview", () => {
  type Overview = {
    last_ok: boolean | null;
    last_status_code: number | null;
    last_error: string | null;
    tls_expires_at: string | null;
    consecutive_failures: number;
    failing_since: string | null;
    checks_24h: number;
    ok_24h: number;
    checks_7d: number;
    ok_7d: number;
    checks_30d: number;
    ok_30d: number;
  };
  /** Un timestamptz como ISO en UTC (el texto de Postgres, "…+00", no lo entiende Date). */
  const iso = (column: string) => `to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as ${column}`;
  const overview = (siteId: string) =>
    as(db, viewer, () =>
      one<Overview>(
        `select last_ok, last_status_code, last_error, ${iso("tls_expires_at")}, consecutive_failures, ${iso("failing_since")},
                checks_24h, ok_24h, checks_7d, ok_7d, checks_30d, ok_30d
         from public.sites_overview where id = $1`,
        [siteId],
      ),
    );
  const checksOf = (siteId: string) =>
    all<{ checked_at: string; ok: boolean }>(
      `select ${iso("checked_at")}, ok from public.site_checks where site_id = $1`,
      [siteId],
    );

  it("sin comprobaciones: todo a cero", async () => {
    const siteId = await createSite();
    expect(await overview(siteId)).toEqual({
      last_ok: null,
      last_status_code: null,
      last_error: null,
      tls_expires_at: null,
      consecutive_failures: 0,
      failing_since: null,
      checks_24h: 0,
      ok_24h: 0,
      checks_7d: 0,
      ok_7d: 0,
      checks_30d: 0,
      ok_30d: 0,
    });
  });

  it("los recuentos de 24 h, 7 y 30 días y la racha coinciden con el dominio (paridad)", async () => {
    const siteId = await createSite();
    const series: [number, boolean][] = [
      [24 * 40, false],
      [24 * 29.5, true],
      [24 * 8, true],
      [24 * 6.5, false],
      [48, true],
      [23.5, true],
      [3, true],
      [0.25, false],
      [0.17, false],
      [0.08, false],
    ];
    for (const [hoursAgo, ok] of series) await addCheck(siteId, hoursAgo, ok, ok ? { tls_expires_at: "2026-12-01T00:00:00Z" } : {});
    const row = await overview(siteId);
    const now = new Date(Number((await one<{ ms: string }>("select (extract(epoch from now()) * 1000)::bigint::text as ms")).ms));
    const checks = (await checksOf(siteId)).map((c) => ({ checkedAt: c.checked_at, ok: c.ok }));
    const counts = windowCounts(checks, now);
    const streak = currentStreak(checks);

    expect({ day: { total: row.checks_24h, ok: row.ok_24h }, week: { total: row.checks_7d, ok: row.ok_7d }, month: { total: row.checks_30d, ok: row.ok_30d } }).toEqual(
      counts,
    );
    expect(counts).toEqual({ day: { total: 5, ok: 2 }, week: { total: 7, ok: 3 }, month: { total: 9, ok: 5 } });
    expect(row.consecutive_failures).toBe(streak.failures);
    expect(row.consecutive_failures).toBe(3);
    expect(new Date(row.failing_since!).toISOString()).toBe(new Date(streak.since!).toISOString());
    expect(row).toMatchObject({ last_ok: false, last_status_code: 503, last_error: "http" });
    // El último certificado leído, aunque la última comprobación no lo leyera.
    expect(new Date(row.tls_expires_at!).toISOString()).toBe("2026-12-01T00:00:00.000Z");
  });

  it("si ninguna fue bien, la racha son todas; si la última fue bien, no hay racha", async () => {
    const down = await createSite({ url: "https://caida.com" });
    for (const hoursAgo of [2, 1, 0.5]) await addCheck(down, hoursAgo, false);
    expect(await overview(down)).toMatchObject({ consecutive_failures: 3, last_ok: false });

    const back = await createSite({ url: "https://vuelve.com" });
    await addCheck(back, 1, false);
    await addCheck(back, 0.5, false);
    await addCheck(back, 0.1, true);
    expect(await overview(back)).toMatchObject({ consecutive_failures: 0, failing_since: null, last_ok: true, ok_24h: 1, checks_24h: 3 });
  });
});
