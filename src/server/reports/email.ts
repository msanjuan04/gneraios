import "server-only";
import type { Month } from "@/domain/metrics/months";
import { isPortalLocale } from "@/domain/portal";
import { isReportableMonth } from "@/domain/reports";
import { nowInZone } from "@/lib/clock";
import { BillingRuleError, type Db, DbError } from "@/server/billing/context";
import { billingRecipients } from "@/server/email/send";
import { renderClientReportEmail } from "@/server/email/templates";

export type PreparedReportEmail = {
  emailId: string;
  /** Ya había uno por revisar para ese cliente y mes: se devuelve ese. */
  existing: boolean;
  recipients: number;
};

/**
 * «Preparar email» del informe mensual: deja en outbound_emails (Facturas → Por enviar) un email
 * 'client_report' por aprobar, en el idioma del cliente y para sus contactos de facturación (o el
 * principal). Solo se guarda de qué cliente y mes es y si lleva las horas: el PDF se genera al
 * enviarlo. Si ya había uno por revisar de ese mes, se devuelve ese (con la opción de horas de
 * ahora) y no se toca lo que el socio haya retocado. null si el cliente no es de la org.
 */
export async function prepareReportEmail(
  db: Db,
  input: { orgId: string; clientId: string; month: Month; includeHours: boolean },
): Promise<PreparedReportEmail | null> {
  const [clientRes, orgRes] = await Promise.all([
    db.from("clients").select("id, display_name, preferred_language").eq("org_id", input.orgId).eq("id", input.clientId).maybeSingle(),
    db.from("orgs").select("name, timezone").eq("id", input.orgId).single(),
  ]);
  if (clientRes.error) throw new DbError(clientRes.error, "reports.email.client");
  if (orgRes.error) throw new DbError(orgRes.error, "reports.email.org");
  const client = clientRes.data;
  if (!client) return null;
  if (!isReportableMonth(input.month, nowInZone(orgRes.data.timezone).date)) throw new BillingRuleError("reports.errors.monthNotAvailable");

  const pending = await findPending(db, input);
  if (pending) return keepPending(db, pending, input.includeHours);

  const language = isPortalLocale(client.preferred_language) ? client.preferred_language : "es";
  const { subject, body } = renderClientReportEmail(language, { month: input.month, clientName: client.display_name, senderName: orgRes.data.name });
  const to = await billingRecipients(db, client.id);
  const { data, error } = await db
    .from("outbound_emails")
    .insert({
      org_id: input.orgId,
      client_id: client.id,
      template: "client_report",
      language,
      to_emails: to,
      subject,
      body,
      attach_pdf: true,
      report_month: input.month,
      report_hours: input.includeHours,
    })
    .select("id")
    .single();
  if (error) {
    // Dos clics a la vez: el índice único deja uno solo por revisar; se devuelve ese.
    if (error.code === "23505") {
      const winner = await findPending(db, input);
      if (winner) return keepPending(db, winner, input.includeHours);
    }
    throw new DbError(error, "reports.email.insert");
  }
  return { emailId: data.id, existing: false, recipients: to.length };
}

type Pending = { id: string; report_hours: boolean; to_emails: string[] };

async function findPending(db: Db, input: { orgId: string; clientId: string; month: Month }): Promise<Pending | null> {
  const { data, error } = await db
    .from("outbound_emails")
    .select("id, report_hours, to_emails")
    .eq("org_id", input.orgId)
    .eq("client_id", input.clientId)
    .eq("template", "client_report")
    .eq("report_month", input.month)
    .eq("status", "pending_approval")
    .maybeSingle();
  if (error) throw new DbError(error, "reports.email.pending");
  return data;
}

async function keepPending(db: Db, pending: Pending, includeHours: boolean): Promise<PreparedReportEmail> {
  if (pending.report_hours !== includeHours) {
    const { error } = await db.from("outbound_emails").update({ report_hours: includeHours }).eq("id", pending.id).eq("status", "pending_approval");
    if (error) throw new DbError(error, "reports.email.hours");
  }
  return { emailId: pending.id, existing: true, recipients: pending.to_emails.length };
}
