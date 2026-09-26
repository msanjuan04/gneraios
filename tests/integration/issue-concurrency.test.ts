/**
 * Emisión concurrente contra el Postgres real de `supabase start` (PGlite tiene una sola
 * conexión y no puede probarlo): varias emisiones a la vez en la misma serie tienen que dar
 * los números 1..N, sin huecos ni duplicados, aunque algunas fallen a mitad (ARCHITECTURE §11).
 * Si la base local no está en marcha, se salta.
 */
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DATABASE_URL = process.env.SEED_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = postgres(DATABASE_URL, { max: 8, onnotice: () => {}, connect_timeout: 2 });

let available = false;
let orgId = "";
let userId = "";
let seriesId = "";
const drafts: string[] = [];
const N = 24;

beforeAll(async () => {
  try {
    await sql`select 1`;
    available = true;
  } catch {
    return;
  }
  userId = randomUUID();
  await sql`insert into auth.users (id, email) values (${userId}, ${`concurrency-${userId}@gnerai.test`})`;
  const [org] = await sql`insert into public.orgs (name, slug) values ('Concurrencia', ${`concurrencia-${userId.slice(0, 8)}`}) returning id`;
  orgId = org!.id;
  await sql`insert into public.members (org_id, user_id, role, full_name, initials) values (${orgId}, ${userId}, 'owner', 'Test', 'TE')`;
  const [issuer] = await sql`
    insert into public.issuers (org_id, kind, legal_name, tax_id, address_line, postal_code, city, active_from)
    values (${orgId}, 'self_employed', 'Emisor Test', '12345678Z', 'Carrer 1', '08301', 'Mataró', '2020-01-01') returning id`;
  const [series] = await sql`
    insert into public.invoice_series (org_id, issuer_id, code, name, kind, format, is_default)
    values (${orgId}, ${issuer!.id}, 'F', 'Facturas', 'ordinary', '{yyyy}-{n:4}', true) returning id`;
  seriesId = series!.id;
  const [vat] = await sql`
    insert into public.tax_rates (org_id, kind, name, rate_bps, regime, is_default) values (${orgId}, 'vat', 'IVA 21 %', 2100, 'general', true) returning id`;
  const [client] = await sql`
    insert into public.clients (org_id, display_name, tax_id, address_line, postal_code, city)
    values (${orgId}, 'Cliente', 'B12345674', 'Carrer 2', '08301', 'Mataró') returning id`;
  for (let i = 0; i < N; i++) {
    const [inv] = await sql`
      insert into public.invoices (org_id, issuer_id, client_id) values (${orgId}, ${issuer!.id}, ${client!.id}) returning id`;
    await sql`
      insert into public.invoice_lines (org_id, invoice_id, description, quantity, unit_price_cents, base_cents, tax_rate_id, vat_bps, vat_cents, billing_type)
      values (${orgId}, ${inv!.id}, 'Servicio', 1, 10000, 10000, ${vat!.id}, 2100, 2100, 'one_off')`;
    drafts.push(inv!.id);
  }
});

afterAll(async () => {
  if (available && orgId) {
    await sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      for (const table of ["invoice_lines", "invoices", "clients", "tax_rates", "invoice_series", "issuers", "members", "audit_log"]) {
        await tx.unsafe(`delete from public.${table} where org_id = $1`, [orgId]);
      }
      await tx`delete from private.invoice_series_counters where series_id = ${seriesId}`;
      await tx`delete from public.pipeline_stages where org_id = ${orgId}`;
      await tx`delete from public.acquisition_sources where org_id = ${orgId}`;
      await tx`delete from public.loss_reasons where org_id = ${orgId}`;
      await tx`delete from public.orgs where id = ${orgId}`;
    });
    await sql`delete from auth.users where id = ${userId}`;
  }
  await sql.end();
});

/** Emite como lo haría PostgREST para ese usuario, en su propia transacción y conexión. */
async function issueAs(invoiceId: string, failAfterNumber: boolean) {
  return sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claim.sub', ${userId}, true)`;
    await tx`set local role authenticated`;
    const [r] = await tx`select public.issue_invoice_begin(${invoiceId}) as r`;
    if (failAfterNumber) throw new Error("fallo simulado después de reservar el número");
    await tx`select public.issue_invoice_complete(${invoiceId}, ${sql.json({ pdf_path: `${orgId}/${invoiceId}.pdf` })})`;
    return r!.r as { number: string };
  });
}

describe.runIf(process.env.CI !== "true")("emisión concurrente en Postgres real", () => {
  it("24 emisiones a la vez (con fallos a mitad) dan 1..N sin huecos ni duplicados", async () => {
    if (!available) {
      // En local sin `supabase start`: se avisa en vez de pasar en silencio.
      console.warn("[concurrency] base local no disponible: test saltado");
      if (process.env.REQUIRE_LOCAL_DB === "1") throw new Error("Base local no disponible");
      return;
    }
    // Una de cada cuatro falla después de reservar su número: su transacción se deshace.
    const firstRound = await Promise.allSettled(drafts.map((id, i) => issueAs(id, i % 4 === 0)));
    const failed = drafts.filter((_, i) => firstRound[i]!.status === "rejected");
    expect(failed).toHaveLength(N / 4);
    // Reintento de las que fallaron, también en paralelo.
    await Promise.all(failed.map((id) => issueAs(id, false)));

    const rows = await sql`
      select sequence, number from public.invoices where org_id = ${orgId} and lifecycle = 'issued' order by sequence`;
    expect(rows.map((r) => r.sequence)).toEqual(Array.from({ length: N }, (_, i) => i + 1));
    expect(new Set(rows.map((r) => r.number)).size).toBe(N);
  }, 60_000);
});
