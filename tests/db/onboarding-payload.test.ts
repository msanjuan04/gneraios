import { beforeEach, describe, expect, it } from "vitest";
import { onboardingDefaults } from "@/app/onboarding/defaults";
import { onboardingSchema, toCreateOrganizationPayload } from "@/lib/validation/onboarding";
import { as, createDb, createUser, type Db } from "./harness";

/**
 * El formulario real del onboarding → Zod → payload → create_organization().
 * Cubre sin Docker el camino que recorre la app al crear la org.
 */

let db: Db;
let owner: string;

beforeEach(async () => {
  db = await createDb();
  owner = await createUser(db, "owner@example.com");
});

function filledForm() {
  const form = onboardingDefaults();
  form.owner.full_name = "Socio Fundador";
  form.issuers[1]!.legal_name = "Socio Fundador";
  form.issuers[1]!.tax_id = "12345678z";
  form.issuers[1]!.series[0]!.last_number = 38;
  form.invitations = [{ email: " Socio2@Example.com ", full_name: "Socio Dos", role: "owner" }];
  return form;
}

describe("onboarding: formulario → base de datos", () => {
  it("el formulario por defecto, completado, crea la org tal y como se ve en la revisión", async () => {
    const values = onboardingSchema.parse(filledForm());
    const payload = toCreateOrganizationPayload(values, 2026);

    const orgId = await as(db, owner, async () => {
      const { rows } = await db.query<{ id: string }>("select public.create_organization($1::jsonb) as id", [
        JSON.stringify(payload),
      ]);
      return rows[0]!.id;
    });

    const issuers = await db.query<{ kind: string; tax_id: string | null; active_from: string | null; irpf: number }>(
      "select kind, tax_id, active_from, default_irpf_bps as irpf from public.issuers where org_id = $1 order by kind",
      [orgId],
    );
    expect(issuers.rows).toEqual([
      { kind: "company", tax_id: null, active_from: null, irpf: 0 },
      { kind: "self_employed", tax_id: "12345678Z", active_from: null, irpf: 1500 },
    ]);

    const { rows: counters } = await db.query<{ year: number; last_number: number }>(
      "select c.year, c.last_number from private.invoice_series_counters c join public.invoice_series s on s.id = c.series_id where s.org_id = $1",
      [orgId],
    );
    expect(counters).toEqual([{ year: 2026, last_number: 38 }]);

    const { rows: taxes } = await db.query<{ n: number; defaults: number }>(
      "select count(*)::int as n, count(*) filter (where is_default)::int as defaults from public.tax_rates where org_id = $1",
      [orgId],
    );
    expect(taxes[0]).toEqual({ n: 6, defaults: 2 });

    const { rows: invites } = await db.query<{ email: string }>(
      "select email from public.member_invitations where org_id = $1",
      [orgId],
    );
    expect(invites).toEqual([{ email: "socio2@example.com" }]);
  });

  it("valida en el cliente lo que la base de datos rechazaría", () => {
    const badNif = filledForm();
    badNif.issuers[1]!.tax_id = "12345678A";
    expect(onboardingSchema.safeParse(badNif).success).toBe(false);

    const badIban = filledForm();
    badIban.issuers[0]!.iban = "ES00 1234";
    expect(onboardingSchema.safeParse(badIban).success).toBe(false);

    const reserved = filledForm();
    reserved.org.slug = "login";
    expect(onboardingSchema.safeParse(reserved).success).toBe(false);

    const noYear = filledForm();
    noYear.issuers[0]!.series[0]!.format = "F-{n:5}";
    expect(onboardingSchema.safeParse(noYear).success).toBe(false);

    const twoPrimary = filledForm();
    twoPrimary.issuers[1]!.is_primary = true;
    expect(onboardingSchema.safeParse(twoPrimary).success).toBe(false);
  });
});
