import { beforeEach, describe, expect, it } from "vitest";
import { VERIFACTU_FROM } from "@/domain/tax/spain-defaults";
import { as, createDb, createOrg, createUser, type Db, onboardingPayload } from "./harness";

let db: Db;
let owner: string;

beforeEach(async () => {
  db = await createDb();
  owner = await createUser(db, "owner@example.com");
});

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from (${sql}) q`, params);
  return rows[0]!.n;
}

describe("create_organization", () => {
  it("crea org, owner, emisores, series, contador, impuestos e invitaciones en una transacción", async () => {
    const orgId = await createOrg(db, owner);

    await as(db, owner, async () => {
      const member = await db.query<{ role: string; initials: string }>(
        "select role, initials from public.members where org_id = $1",
        [orgId],
      );
      expect(member.rows).toEqual([{ role: "owner", initials: "MS" }]);
      expect(await count("select * from public.issuers where org_id = $1", [orgId])).toBe(2);
      expect(await count("select * from public.invoice_series where org_id = $1", [orgId])).toBe(3);
      expect(await count("select * from public.tax_rates where org_id = $1", [orgId])).toBe(3);
      expect(await count("select * from public.member_invitations where org_id = $1", [orgId])).toBe(1);

      const counters = await db.query<{ year: number; last_number: number }>(
        "select year, last_number from public.series_counters($1)",
        [orgId],
      );
      expect(counters.rows).toEqual([{ year: 2026, last_number: 37 }]);
    });
  });

  it("normaliza NIF, enlaza al autónomo con su miembro y pone la fecha Verifactu por tipo", async () => {
    const orgId = await createOrg(db, owner);
    const { rows } = await db.query<{ kind: string; tax_id: string | null; verifactu_from: Date; linked: boolean }>(
      "select kind, tax_id, verifactu_from, member_id is not null as linked from public.issuers where org_id = $1 order by kind",
      [orgId],
    );
    expect(rows.map((r) => [r.kind, r.tax_id, r.verifactu_from.toISOString().slice(0, 10), r.linked])).toEqual([
      ["company", null, VERIFACTU_FROM.company, false],
      ["self_employed", "12345678Z", VERIFACTU_FROM.self_employed, true],
    ]);
  });

  it("es atómica: si algo falla no queda nada a medias", async () => {
    const payload = onboardingPayload();
    // Dos emisores principales violan el índice único parcial.
    payload.issuers[1] = { ...payload.issuers[1]!, is_primary: true };
    await expect(createOrg(db, owner, payload)).rejects.toThrow();
    expect(await count("select * from public.orgs")).toBe(0);
    expect(await count("select * from public.members")).toBe(0);
  });

  it("rechaza slugs reservados y a usuarios anónimos", async () => {
    await expect(createOrg(db, owner, onboardingPayload({ org: { name: "X", slug: "login" } }))).rejects.toThrow();
    await expect(
      as(db, null, () => db.query("select public.create_organization($1::jsonb)", [JSON.stringify(onboardingPayload())])),
    ).rejects.toThrow();
  });

  it("exige el año en el formato si la serie se reinicia cada año", async () => {
    const payload = onboardingPayload();
    payload.issuers[0]!.series = [{ code: "F", name: "Facturas", kind: "ordinary", format: "F-{n:5}", is_default: true }];
    await expect(createOrg(db, owner, payload)).rejects.toThrow(/invoice_series_check|check constraint/);
  });
});

describe("RLS", () => {
  it("un usuario no ve nada de una org de la que no es miembro", async () => {
    const orgA = await createOrg(db, owner);
    const intruder = await createUser(db, "otro@example.com");
    await createOrg(db, intruder, onboardingPayload({ org: { name: "Otra agencia", slug: "otra" }, invitations: [] }));

    await as(db, intruder, async () => {
      for (const table of ["orgs", "members", "issuers", "invoice_series", "tax_rates", "member_invitations", "audit_log"]) {
        const column = table === "orgs" ? "id" : "org_id";
        expect(await count(`select * from public.${table} where ${column} = $1`, [orgA]), table).toBe(0);
      }
      expect(await count("select * from public.series_counters($1)", [orgA])).toBe(0);
    });
  });

  it("anon no puede leer ninguna tabla", async () => {
    await createOrg(db, owner);
    await expect(as(db, null, () => db.query("select * from public.orgs"))).rejects.toThrow(/permission denied/);
  });

  it("solo un owner cambia la configuración fiscal", async () => {
    const orgId = await createOrg(db, owner);
    const partner = await createUser(db, "partner@example.com");
    await db.query(
      "insert into public.members (org_id, user_id, role, full_name, initials) values ($1, $2, 'partner', 'Socio', 'SP')",
      [orgId, partner],
    );

    const rename = "update public.issuers set trade_name = 'Cambiado' where org_id = $1 and kind = 'company'";
    const asPartner = await as(db, partner, () => db.query(rename, [orgId]));
    expect(asPartner.affectedRows).toBe(0);
    const asOwner = await as(db, owner, () => db.query(rename, [orgId]));
    expect(asOwner.affectedRows).toBe(1);

    await expect(
      as(db, partner, () => db.query("select public.set_series_last_number(id, 2026, 99) from public.invoice_series limit 1")),
    ).rejects.toThrow(/Sin permiso/);
  });

  it("nadie da de alta miembros directamente: solo por invitación u onboarding", async () => {
    const orgId = await createOrg(db, owner);
    const other = await createUser(db, "colado@example.com");
    await expect(
      as(db, owner, () =>
        db.query(
          "insert into public.members (org_id, user_id, role, full_name, initials) values ($1, $2, 'owner', 'Colado', 'CO')",
          [orgId, other],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("registra auditoría con el actor", async () => {
    const orgId = await createOrg(db, owner);
    const rows = await as(db, owner, () =>
      db.query<{ table_name: string; actor_id: string }>(
        "select distinct table_name, actor_id from public.audit_log where org_id = $1 order by table_name",
        [orgId],
      ),
    );
    // Incluye lo que siembran los triggers al crear la org: el pipeline (hito 1.1), las categorías
    // de gasto (finanzas) y las reglas de upsell del consejo.
    expect(rows.rows.map((r) => r.table_name)).toEqual([
      "acquisition_sources",
      "expense_categories",
      "invoice_series",
      "issuers",
      "loss_reasons",
      "member_invitations",
      "members",
      "orgs",
      "pipeline_stages",
      "tax_rates",
      "upsell_rules",
    ]);
    expect(new Set(rows.rows.map((r) => r.actor_id))).toEqual(new Set([owner]));
  });
});

describe("miembros e invitaciones", () => {
  it("el usuario invitado entra en la org con el rol de la invitación, una sola vez", async () => {
    const orgId = await createOrg(db, owner);
    const invited = await createUser(db, "socio2@example.com");

    const first = await as(db, invited, () =>
      db.query<{ n: number }>("select public.accept_pending_invitations() as n"),
    );
    expect(first.rows[0]!.n).toBe(1);
    const again = await as(db, invited, () =>
      db.query<{ n: number }>("select public.accept_pending_invitations() as n"),
    );
    expect(again.rows[0]!.n).toBe(0);

    const member = await as(db, invited, () =>
      db.query<{ role: string; initials: string }>(
        "select role, initials from public.members where org_id = $1 and user_id = $2",
        [orgId, invited],
      ),
    );
    expect(member.rows).toEqual([{ role: "owner", initials: "SD" }]);
  });

  it("no deja a la org sin owner", async () => {
    const orgId = await createOrg(db, owner);
    await expect(
      as(db, owner, () =>
        db.query("update public.members set role = 'partner' where org_id = $1 and user_id = $2", [orgId, owner]),
      ),
    ).rejects.toThrow(/al menos un owner/);
  });

  it("cada miembro edita su perfil pero no su rol", async () => {
    const orgId = await createOrg(db, owner);
    await as(db, owner, () =>
      db.query("select public.update_my_profile($1, 'Marc S.', 'msj', 'ca')", [orgId]),
    );
    const { rows } = await db.query<{ full_name: string; initials: string; locale: string; role: string }>(
      "select full_name, initials, locale, role from public.members where org_id = $1",
      [orgId],
    );
    expect(rows).toEqual([{ full_name: "Marc S.", initials: "MSJ", locale: "ca", role: "owner" }]);
  });
});
