/**
 * «Añadir a factura» dos veces a la vez (doble clic, o dos socios) contra el Postgres real de
 * `supabase start` (PGlite tiene una sola conexión y no puede probarlo): rebill_expenses bloquea los
 * gastos, así que solo una repercusión los factura; la otra no guarda nada (rebill_taken) y no deja
 * borradores ni líneas huérfanas. Si la base local no está en marcha, se salta.
 */
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { planRebillLines, type RebillExpense } from "@/domain/finance/rebill";

const DATABASE_URL = process.env.SEED_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = postgres(DATABASE_URL, { max: 8, onnotice: () => {}, connect_timeout: 2 });

let available = false;
let orgId = "";
let userId = "";
let issuerId = "";
let clientId = "";
let categoryId = "";
let vatId = "";

beforeAll(async () => {
  try {
    await sql`select 1`;
    available = true;
  } catch {
    return;
  }
  userId = randomUUID();
  await sql`insert into auth.users (id, email) values (${userId}, ${`rebill-${userId}@gnerai.test`})`;
  const [org] = await sql`insert into public.orgs (name, slug) values ('Repercusión', ${`repercusion-${userId.slice(0, 8)}`}) returning id`;
  orgId = org!.id;
  await sql`insert into public.members (org_id, user_id, role, full_name, initials) values (${orgId}, ${userId}, 'owner', 'Test', 'TE')`;
  const [issuer] = await sql`
    insert into public.issuers (org_id, kind, legal_name, tax_id, address_line, postal_code, city, active_from)
    values (${orgId}, 'self_employed', 'Emisor Test', '12345678Z', 'Carrer 1', '08301', 'Mataró', '2020-01-01') returning id`;
  issuerId = issuer!.id;
  const [vat] = await sql`
    insert into public.tax_rates (org_id, kind, name, rate_bps, regime, is_default) values (${orgId}, 'vat', 'IVA 21 %', 2100, 'general', true) returning id`;
  vatId = vat!.id;
  const [client] = await sql`
    insert into public.clients (org_id, display_name, tax_id, address_line, postal_code, city)
    values (${orgId}, 'Cliente', 'B12345674', 'Carrer 2', '08301', 'Mataró') returning id`;
  clientId = client!.id;
  // Las categorías por defecto las siembra el alta de la org.
  const [category] = await sql`select id from public.expense_categories where org_id = ${orgId} and name = 'Servidores y hosting'`;
  categoryId = category!.id;
});

afterAll(async () => {
  if (available && orgId) {
    await sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      for (const table of ["expenses", "invoice_lines", "invoices", "clients", "tax_rates", "invoice_series", "issuers", "expense_categories", "members", "audit_log"]) {
        await tx.unsafe(`delete from public.${table} where org_id = $1`, [orgId]);
      }
      await tx`delete from public.pipeline_stages where org_id = ${orgId}`;
      await tx`delete from public.acquisition_sources where org_id = ${orgId}`;
      await tx`delete from public.loss_reasons where org_id = ${orgId}`;
      await tx`delete from public.orgs where id = ${orgId}`;
    });
    await sql`delete from auth.users where id = ${userId}`;
  }
  await sql.end();
});

async function insertRebillable(description: string): Promise<RebillExpense> {
  const [row] = await sql`
    insert into public.expenses (org_id, issuer_id, category_id, description, issued_on, base_cents, total_cents, allocation, client_id, rebill, rebill_markup_bps)
    values (${orgId}, ${issuerId}, ${categoryId}, ${description}, '2026-09-01', 1000, 1000, 'client', ${clientId}, true, 1000) returning id`;
  return { id: row!.id, clientId, description, vendorName: null, issuedOn: "2026-09-01", periodStart: null, baseCents: 1000, markupBps: 1000 };
}

/** Una repercusión en un borrador nuevo del cliente, con líneas (e ids) propias. */
function payload(expenses: RebillExpense[]) {
  const lines = planRebillLines(expenses, {
    startPosition: 0,
    taxRate: { id: vatId, rateBps: 2100, regime: "general", legalNote: null },
    invoiceIrpfBps: 0,
    irpfApplies: true,
    describe: (e) => `Repercusión: ${e.description}`,
    newId: randomUUID,
  });
  return {
    draft: { header: { issuer_id: issuerId, client_id: clientId, irpf_bps: 0, language: "es" }, lines: lines.map((l) => l.line) },
    links: lines.map((l) => ({ expense_id: l.expenseId, line_id: l.line.id })),
  };
}

/** Como lo haría PostgREST para ese usuario, en su propia transacción y conexión. */
async function rebillAs(p: ReturnType<typeof payload>) {
  return sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claim.sub', ${userId}, true)`;
    await tx`set local role authenticated`;
    const [r] = await tx`select public.rebill_expenses(${sql.json(p)}) as id`;
    // Un poco de trabajo después de guardar, para que la otra repercusión espere al bloqueo.
    await tx`select pg_sleep(0.2)`;
    return r!.id as string;
  });
}

describe.runIf(process.env.CI !== "true")("repercusiones simultáneas en Postgres real", () => {
  it("tres «Añadir a factura» a la vez: una factura los gastos y las otras no guardan nada", async () => {
    if (!available) {
      // En local sin `supabase start`: se avisa en vez de pasar en silencio.
      console.warn("[rebill] base local no disponible: test saltado");
      if (process.env.REQUIRE_LOCAL_DB === "1") throw new Error("Base local no disponible");
      return;
    }
    const expenses = [await insertRebillable("Servidor"), await insertRebillable("Dominio")];
    const results = await Promise.allSettled([rebillAs(payload(expenses)), rebillAs(payload(expenses)), rebillAs(payload(expenses))]);

    const ok = results.filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled");
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(failed.map((f) => (f.reason as { hint?: string }).hint)).toEqual(["rebill_taken", "rebill_taken"]);

    const invoices = await sql`select id from public.invoices where org_id = ${orgId} and client_id = ${clientId}`;
    expect(invoices.map((i) => i.id)).toEqual([ok[0]!.value]);
    const lines = await sql`select id from public.invoice_lines where invoice_id = ${ok[0]!.value}`;
    expect(lines).toHaveLength(2);
    const linked = await sql`
      select e.rebill_invoice_line_id from public.expenses e
      where e.id in ${sql(expenses.map((e) => e.id))} and e.rebill_invoice_line_id in ${sql(lines.map((l) => l.id))}`;
    expect(linked).toHaveLength(2);
  }, 60_000);
});
