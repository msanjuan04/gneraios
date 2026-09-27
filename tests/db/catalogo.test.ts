import { beforeEach, describe, expect, it } from "vitest";
import { translationsError } from "@/domain/catalog/text";
import { as, createDb, createOrg, createUser, type Db, onboardingPayload } from "./harness";

let db: Db;
let owner: string;
let orgId: string;
let rates: { vat21: string; exempt: string; irpf15: string };

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0]!;
}

async function all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

async function asUser<T>(user: string, sql: string, params: unknown[] = []): Promise<T[]> {
  return as(db, user, async () => (await db.query<T>(sql, params)).rows);
}

/** Rechaza con el hint de Postgres que la app traduce a un mensaje. */
async function expectHint(promise: Promise<unknown>, hint: string) {
  await expect(promise).rejects.toMatchObject({ hint });
}

async function addMember(email: string, role: "viewer" | "partner" | "owner", org = orgId): Promise<string> {
  const user = await createUser(db, email);
  await db.query("insert into public.members (org_id, user_id, role, full_name, initials) values ($1, $2, $3, $4, 'XX')", [
    org,
    user,
    role,
    email.split("@")[0],
  ]);
  return user;
}

/** Un servicio como lo escribe la app (PostgREST): columnas explícitas, traducciones en JSON. */
async function insertItem(user: string, fields: Record<string, unknown> = {}, org = orgId): Promise<string> {
  const row: Record<string, unknown> = {
    org_id: org,
    category: "web",
    name: "Web corporativa",
    description: "Hasta 5 páginas, adaptada a móvil.",
    billing_type: "one_off",
    unit_price_cents: 180_000,
    tax_rate_id: rates.vat21,
    ...fields,
  };
  if (row.translations !== undefined) row.translations = JSON.stringify(row.translations);
  const columns = Object.keys(row);
  const [inserted] = await asUser<{ id: string }>(
    user,
    `insert into public.catalog_items (${columns.join(", ")}) values (${columns.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
    Object.values(row),
  );
  return inserted!.id;
}

async function saveBundle(user: string, payload: Record<string, unknown>): Promise<string> {
  const [row] = await asUser<{ id: string }>(user, "select public.save_catalog_bundle($1::jsonb) as id", [
    JSON.stringify({ org_id: orgId, name: "Pack Lanzamiento", translations: {}, discount_bps: 1000, ...payload }),
  ]);
  return row!.id;
}

async function bundleItems(bundleId: string) {
  return all<{ item_id: string; quantity: string | null; position: number }>(
    "select item_id, quantity::text, position from public.catalog_bundle_items where bundle_id = $1 order by position",
    [bundleId],
  );
}

beforeEach(async () => {
  db = await createDb();
  owner = await createUser(db, "owner@example.com");
  orgId = await createOrg(db, owner);
  const found = await all<{ id: string; name: string }>("select id, name from public.tax_rates where org_id = $1", [orgId]);
  const byName = (name: string) => found.find((r) => r.name === name)!.id;
  rates = { vat21: byName("IVA 21 %"), exempt: byName("Exento"), irpf15: byName("IRPF 15 %") };
});

describe("servicios", () => {
  it("un socio los crea y los edita; se archivan pero no se borran; quedan en la auditoría", async () => {
    const partner = await addMember("socio@example.com", "partner");
    const web = await insertItem(partner, {
      translations: { en: { name: "Corporate website" } },
      unit_label: "proyecto",
      default_quantity: "1.5",
    });
    const [edited] = await asUser<{ unit_price_cents: string; is_active: boolean }>(
      partner,
      "update public.catalog_items set unit_price_cents = 190000, is_active = false where id = $1 returning unit_price_cents::text, is_active",
      [web],
    );
    expect(edited).toEqual({ unit_price_cents: "190000", is_active: false });
    await expect(asUser(partner, "delete from public.catalog_items where id = $1", [web])).rejects.toThrow(/permission denied/);

    const audit = await all<{ action: string; actor_id: string }>(
      "select action, actor_id from public.audit_log where table_name = 'catalog_items' and record_id = $1 order by id",
      [web],
    );
    expect(audit).toEqual([
      { action: "insert", actor_id: partner },
      { action: "update", actor_id: partner },
    ]);
  });

  it("un viewer los lee pero no los cambia; otra org ni los ve ni escribe en la nuestra", async () => {
    const web = await insertItem(owner);
    const viewer = await addMember("viewer@example.com", "viewer");
    expect(await asUser(viewer, "select id from public.catalog_items where org_id = $1", [orgId])).toHaveLength(1);
    await expect(insertItem(viewer, { name: "SEO mensual" })).rejects.toThrow(/row-level security/);
    expect(await asUser(viewer, "update public.catalog_items set name = 'Otra' where id = $1 returning id", [web])).toEqual([]);
    expect(await asUser(viewer, "select public.reorder_catalog_items($1::uuid[]) as n", [[web]])).toEqual([{ n: 0 }]);

    const intruder = await createUser(db, "otro@example.com");
    await createOrg(db, intruder, onboardingPayload({ org: { name: "Otra", slug: "otra" }, invitations: [] }));
    for (const table of ["catalog_items", "catalog_bundles", "catalog_bundle_items"]) {
      expect(await asUser(intruder, `select id from public.${table} where org_id = $1`, [orgId]), table).toEqual([]);
    }
    await expect(insertItem(intruder, { name: "Intrusa" })).rejects.toThrow(/row-level security/);
    expect(await asUser(intruder, "update public.catalog_items set name = 'Mía' where id = $1 returning id", [web])).toEqual([]);
  });

  it("el IVA tiene que ser de la org y un tipo de IVA vigente; si luego se archiva, el servicio lo conserva", async () => {
    // FK compuesta: el IVA de otra org no vale aunque se conozca su id.
    const intruder = await createUser(db, "otro@example.com");
    const otherOrg = await createOrg(db, intruder, onboardingPayload({ org: { name: "Otra", slug: "otra" }, invitations: [] }));
    const foreignVat = (await one<{ id: string }>("select id from public.tax_rates where org_id = $1 and kind = 'vat' and is_default", [otherOrg])).id;
    await expect(insertItem(owner, { tax_rate_id: foreignVat })).rejects.toThrow(/foreign key/);
    await expect(insertItem(intruder, { tax_rate_id: rates.vat21 }, otherOrg)).rejects.toThrow(/foreign key/);

    await expectHint(insertItem(owner, { tax_rate_id: rates.irpf15 }), "vat_rate_required");
    const exempt = await insertItem(owner, { name: "Formación", tax_rate_id: rates.exempt });
    await db.query("update public.tax_rates set archived_at = now() where id = $1", [rates.exempt]);
    await expectHint(insertItem(owner, { name: "Curso", tax_rate_id: rates.exempt }), "vat_rate_archived");
    const [kept] = await asUser<{ tax_rate_id: string }>(
      owner,
      "update public.catalog_items set unit_price_cents = 5000 where id = $1 returning tax_rate_id",
      [exempt],
    );
    expect(kept!.tax_rate_id).toBe(rates.exempt);
    await expectHint(
      asUser(owner, "update public.catalog_items set tax_rate_id = $2 where id = $1", [exempt, rates.irpf15]),
      "vat_rate_required",
    );
  });

  it("no cambian de org, aunque quien lo intente sea socio de las dos", async () => {
    const web = await insertItem(owner);
    const otherOrg = await createOrg(db, owner, onboardingPayload({ org: { name: "Otra", slug: "otra" }, invitations: [] }));
    await expectHint(
      asUser(owner, "update public.catalog_items set org_id = $2 where id = $1", [web, otherOrg]),
      "catalog_org_fixed",
    );
  });

  it("dos activos no se llaman igual; uno archivado deja libre el nombre", async () => {
    const web = await insertItem(owner, { name: "Web corporativa" });
    await expect(insertItem(owner, { name: "web CORPORATIVA" })).rejects.toMatchObject({ code: "23505" });
    await db.query("update public.catalog_items set is_active = false where id = $1", [web]);
    await insertItem(owner, { name: "Web corporativa" });
    // Restaurar el archivado chocaría con el nuevo.
    await expect(asUser(owner, "update public.catalog_items set is_active = true where id = $1", [web])).rejects.toMatchObject({
      code: "23505",
    });
  });

  it("reordenar cambia solo las posiciones que cambian", async () => {
    const [a, b, c] = [await insertItem(owner, { name: "A" }), await insertItem(owner, { name: "B" }), await insertItem(owner, { name: "C" })];
    expect(await asUser(owner, "select public.reorder_catalog_items($1::uuid[]) as n", [[c, a, b]])).toEqual([{ n: 2 }]);
    const order = await all<{ name: string; position: number }>(
      "select name, position from public.catalog_items where org_id = $1 order by position",
      [orgId],
    );
    expect(order).toEqual([
      { name: "C", position: 0 },
      { name: "A", position: 1 },
      { name: "B", position: 2 },
    ]);
    expect(await asUser(owner, "select public.reorder_catalog_items($1::uuid[]) as n", [[c, a, b]])).toEqual([{ n: 0 }]);
  });
});

describe("textos y traducciones", () => {
  it("rechaza textos vacíos, con espacios en los extremos, con saltos de línea o demasiado largos", async () => {
    for (const fields of [
      { name: "" },
      { name: " Web" },
      { name: "x".repeat(121) },
      { description: "Dos\nlíneas" },
      { description: "" },
      { description: "x".repeat(376) },
      { unit_label: "hora " },
      { unit_label: "x".repeat(31) },
    ]) {
      await expect(insertItem(owner, fields), JSON.stringify(fields)).rejects.toMatchObject({ code: "23514" });
    }
    await insertItem(owner, { name: "x".repeat(120), description: "y".repeat(375), unit_label: "hora" });
  });

  it("valida las traducciones igual que el dominio (translationsError)", async () => {
    const cases: unknown[] = [
      {},
      { ca: { name: "Web corporativa" } },
      { ca: { name: "Botiga en línia", description: "Amb pagament amb targeta." }, en: { description: "With card payments." } },
      { en: { name: "x".repeat(120), description: "y".repeat(375) } },
      [],
      "texto",
      { es: { name: "Web" } },
      { fr: { name: "Site" } },
      { ca: {} },
      { ca: "Web" },
      { ca: { title: "Web" } },
      { ca: { name: "" } },
      { ca: { name: "Web " } },
      { ca: { name: "Dues\nlínies" } },
      { ca: { name: 1 } },
      { ca: { name: null } },
      { en: { name: "x".repeat(121) } },
      { en: { description: "y".repeat(376) } },
    ];
    for (const value of cases) {
      const { ok } = await one<{ ok: boolean }>("select private.catalog_translations_ok($1::jsonb, 120, 375) as ok", [JSON.stringify(value)]);
      expect(ok, JSON.stringify(value)).toBe(translationsError(value) === null);
    }
    // Y en las tablas, con el nombre del check (la app lo traduce).
    await expect(insertItem(owner, { translations: { de: { name: "Webseite" } } })).rejects.toMatchObject({
      code: "23514",
      constraint: "catalog_items_translations_check",
    });
    await expect(saveBundle(owner, { translations: { ca: {} }, items: [{ item_id: await insertItem(owner) }] })).rejects.toMatchObject({
      code: "23514",
      constraint: "catalog_bundles_translations_check",
    });
  });
});

describe("packs", () => {
  it("se guardan con sus servicios como conjunto completo y en el orden en que llegan", async () => {
    const web = await insertItem(owner, { name: "Web corporativa" });
    const hosting = await insertItem(owner, { name: "Hosting", category: "hosting", billing_type: "yearly", unit_price_cents: 18_000 });
    const seo = await insertItem(owner, { name: "SEO mensual", category: "seo", billing_type: "monthly", unit_price_cents: 45_000 });

    const pack = await saveBundle(owner, { items: [{ item_id: web }, { item_id: hosting, quantity: "2" }] });
    expect(await bundleItems(pack)).toEqual([
      { item_id: web, quantity: null, position: 0 },
      { item_id: hosting, quantity: "2.000", position: 1 },
    ]);
    const first = await one<{ discount_bps: number; position: number }>("select discount_bps, position from public.catalog_bundles where id = $1", [pack]);
    expect(first).toEqual({ discount_bps: 1000, position: 0 });

    // Lo que no viene se quita; lo que viene cambia de orden y de cantidad.
    const same = await saveBundle(owner, { bundle_id: pack, name: "Pack Crecimiento", discount_bps: 1500, items: [{ item_id: seo }, { item_id: web, quantity: "3" }] });
    expect(same).toBe(pack);
    expect(await bundleItems(pack)).toEqual([
      { item_id: seo, quantity: null, position: 0 },
      { item_id: web, quantity: "3.000", position: 1 },
    ]);
    expect(await one<{ name: string; discount_bps: number }>("select name, discount_bps from public.catalog_bundles where id = $1", [pack])).toEqual({
      name: "Pack Crecimiento",
      discount_bps: 1500,
    });

    // Un pack nuevo va al final.
    const second = await saveBundle(owner, { name: "Pack SEO", items: [{ item_id: seo }] });
    expect((await one<{ position: number }>("select position from public.catalog_bundles where id = $1", [second])).position).toBe(1);
    expect(await asUser(owner, "select public.reorder_catalog_bundles($1::uuid[]) as n", [[second, pack]])).toEqual([{ n: 2 }]);
  });

  it("llevan de 1 a 50 servicios, sin repetir, y todos de la misma org", async () => {
    const web = await insertItem(owner);
    await expectHint(saveBundle(owner, { items: [] }), "bundle_items_invalid");
    await expectHint(saveBundle(owner, { items: [{ quantity: "1" }] }), "bundle_items_invalid");
    await expectHint(saveBundle(owner, { items: [{ item_id: web }, { item_id: web, quantity: "2" }] }), "bundle_item_repeated");

    const intruder = await createUser(db, "otro@example.com");
    const otherOrg = await createOrg(db, intruder, onboardingPayload({ org: { name: "Otra", slug: "otra" }, invitations: [] }));
    const foreignVat = (await one<{ id: string }>("select id from public.tax_rates where org_id = $1 and kind = 'vat' and is_default", [otherOrg])).id;
    const foreign = await insertItem(intruder, { tax_rate_id: foreignVat }, otherOrg);
    // Un servicio de otra org no entra en nuestro pack (FK compuesta), aunque se conozca su id.
    await expect(saveBundle(owner, { items: [{ item_id: foreign }] })).rejects.toThrow(/foreign key/);
    // Ni un pack nuestro con los servicios de otra org, escrito directamente.
    const pack = await saveBundle(owner, { items: [{ item_id: web }] });
    await expect(
      asUser(intruder, "insert into public.catalog_bundle_items (org_id, bundle_id, item_id) values ($1, $2, $3)", [otherOrg, pack, foreign]),
    ).rejects.toThrow(/foreign key/);
    await expect(
      asUser(intruder, "insert into public.catalog_bundle_items (org_id, bundle_id, item_id) values ($1, $2, $3)", [orgId, pack, web]),
    ).rejects.toThrow(/row-level security/);
  });

  it("un viewer no los crea ni los cambia; un socio sí, y archivarlos no borra nada", async () => {
    const web = await insertItem(owner);
    const pack = await saveBundle(owner, { items: [{ item_id: web }] });
    const viewer = await addMember("viewer@example.com", "viewer");
    await expect(saveBundle(viewer, { name: "Pack viewer", items: [{ item_id: web }] })).rejects.toThrow(/row-level security/);
    await expectHint(saveBundle(viewer, { bundle_id: pack, items: [{ item_id: web }] }), "bundle_not_found");
    expect(await asUser(viewer, "delete from public.catalog_bundle_items where bundle_id = $1 returning id", [pack])).toEqual([]);
    expect(await asUser(viewer, "select item_id from public.catalog_bundle_items where bundle_id = $1", [pack])).toHaveLength(1);

    const partner = await addMember("socio@example.com", "partner");
    await saveBundle(partner, { bundle_id: pack, name: "Pack socio", items: [{ item_id: web, quantity: "2" }] });
    await asUser(partner, "update public.catalog_bundles set is_active = false where id = $1", [pack]);
    await expect(asUser(partner, "delete from public.catalog_bundles where id = $1", [pack])).rejects.toThrow(/permission denied/);
    expect(await bundleItems(pack)).toEqual([{ item_id: web, quantity: "2.000", position: 0 }]);
    const audited = await all<{ table_name: string }>(
      "select distinct table_name from public.audit_log where table_name like 'catalog_%' order by table_name",
    );
    expect(audited.map((a) => a.table_name)).toEqual(["catalog_bundle_items", "catalog_bundles", "catalog_items"]);
  });
});
