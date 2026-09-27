import { beforeEach, describe, expect, it } from "vitest";
import { as, createDb, createOrg, createUser, type Db } from "./harness";

// Informe mensual del cliente (supabase/migrations/20260926350000_informes.sql): el email
// 'client_report' guarda solo de qué cliente y mes es y si lleva las horas; el PDF se genera al
// enviarlo. Aquí se prueba lo que garantiza la base de datos.

let db: Db;
let owner: string;
let orgId: string;
let clientId: string;

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0]!;
}

type EmailInput = {
  template?: string;
  clientId?: string | null;
  invoiceId?: string | null;
  month?: string | null;
  hours?: boolean;
  status?: string;
};

/** Un email como lo deja «Preparar email» (o enviado, si se pide), con la sesión del owner. */
function insertEmail(input: EmailInput = {}): Promise<{ id: string }> {
  const status = input.status ?? "pending_approval";
  return as(db, owner, () =>
    one<{ id: string }>(
      `insert into public.outbound_emails
         (org_id, client_id, invoice_id, template, language, to_emails, subject, body, report_month, report_hours, status, sent_at)
       values ($1, $2, $3, $4::public.email_template, 'es', '{clara@example.com}', 'Informe mensual', 'Hola', $5, $6, $7::public.email_status,
               case when $7 = 'sent' then now() end)
       returning id`,
      [
        orgId,
        input.clientId === undefined ? clientId : input.clientId,
        input.invoiceId ?? null,
        input.template ?? "client_report",
        input.month === undefined ? "2026-08-01" : input.month,
        input.hours ?? false,
        status,
      ],
    ),
  );
}

beforeEach(async () => {
  db = await createDb();
  owner = await createUser(db, "owner@example.com");
  orgId = await createOrg(db, owner);
  clientId = (
    await as(db, owner, () =>
      one<{ id: string }>("insert into public.clients (org_id, display_name, preferred_language) values ($1, 'Clínica Dental Mar Blau', 'ca') returning id", [
        orgId,
      ]),
    )
  ).id;
});

describe("outbound_emails de informes", () => {
  it("un socio deja un informe por revisar: cliente, mes y sin horas por defecto", async () => {
    const { id } = await insertEmail();
    const row = await one<{ template: string; report_month: string; report_hours: boolean; status: string }>(
      "select template::text, report_month::text, report_hours, status::text from public.outbound_emails where id = $1",
      [id],
    );
    expect(row).toEqual({ template: "client_report", report_month: "2026-08-01", report_hours: false, status: "pending_approval" });
  });

  it("el mes es su primer día", async () => {
    await expect(insertEmail({ month: "2026-08-15" })).rejects.toThrow(/outbound_emails_report_month_check/);
  });

  it("la plantilla y el mes van juntos, y las horas solo en un informe", async () => {
    await expect(insertEmail({ month: null })).rejects.toThrow(/outbound_emails_report_check/);
    await expect(insertEmail({ template: "payment_reminder" })).rejects.toThrow(/outbound_emails_report_check/);
    await expect(insertEmail({ template: "payment_reminder", month: null, hours: true })).rejects.toThrow(/outbound_emails_report_check/);
    await expect(insertEmail({ template: "payment_reminder", month: null })).resolves.toMatchObject({ id: expect.any(String) });
  });

  it("un informe es de un cliente y no va con una factura", async () => {
    await expect(insertEmail({ clientId: null })).rejects.toThrow(/outbound_emails_report_check/);
    const issuer = (await one<{ id: string }>("select id from public.issuers where org_id = $1 and kind = 'self_employed'", [orgId])).id;
    const invoice = (
      await as(db, owner, () =>
        one<{ id: string }>("select public.save_invoice_draft($1::jsonb) as id", [
          JSON.stringify({ header: { issuer_id: issuer, client_id: clientId }, lines: [] }),
        ]),
      )
    ).id;
    await expect(insertEmail({ invoiceId: invoice })).rejects.toThrow(/outbound_emails_report_check/);
  });

  it("uno por revisar por cliente y mes; enviado o descartado, se puede preparar otro", async () => {
    const first = await insertEmail();
    await expect(insertEmail({ hours: true })).rejects.toThrow(/outbound_emails_report_pending_idx/);
    // Otro mes u otro estado no chocan.
    await expect(insertEmail({ month: "2026-07-01" })).resolves.toBeDefined();
    await expect(insertEmail({ status: "sent" })).resolves.toBeDefined();

    await as(db, owner, () => db.query("update public.outbound_emails set status = 'cancelled' where id = $1", [first.id]));
    await expect(insertEmail()).resolves.toBeDefined();
  });

  it("los meses enviados de un cliente se leen de sus emails", async () => {
    await insertEmail({ month: "2026-06-01", status: "sent" });
    await insertEmail({ month: "2026-07-01", status: "sent", hours: true });
    await insertEmail({ month: "2026-08-01" });
    const months = await as(db, owner, async () =>
      (
        await db.query<{ month: string }>(
          `select distinct report_month::text as month from public.outbound_emails
            where org_id = $1 and client_id = $2 and template = 'client_report' and status = 'sent' and report_month is not null
            order by 1 desc`,
          [orgId, clientId],
        )
      ).rows.map((r) => r.month),
    );
    expect(months).toEqual(["2026-07-01", "2026-06-01"]);
  });
});
