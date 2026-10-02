import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { type Db, DbError, must } from "@/server/billing/context";
import { BillingRuleError } from "@/server/billing/manual";
import { clientReportAttachment } from "@/server/reports/attachment";
import { emailFrom, getEmailProvider } from "./provider";
import { type EmailLocale, type EmailTemplate, renderEmail } from "./templates";

export type EmailDraft = { to: string[]; subject: string; body: string; language: EmailLocale };

/** Destinatarios de facturación de un cliente: sus contactos de facturación o, si no, el principal. */
export async function billingRecipients(db: Db, clientId: string): Promise<string[]> {
  const contacts = must(
    await db.from("contacts").select("email, is_billing, is_primary").eq("client_id", clientId).is("archived_at", null),
    "billingRecipients",
  );
  const withEmail = contacts.filter((c): c is typeof c & { email: string } => Boolean(c.email));
  const billing = withEmail.filter((c) => c.is_billing).map((c) => c.email);
  if (billing.length > 0) return billing;
  return withEmail.filter((c) => c.is_primary).map((c) => c.email).slice(0, 1);
}

/** Propuesta de email para una factura emitida (el socio la revisa antes de enviar). */
export async function composeInvoiceEmail(db: Db, invoiceId: string, template: EmailTemplate = "invoice"): Promise<EmailDraft> {
  const inv = must(
    await db
      .from("invoices_overview")
      .select("id, client_id, number, issued_on, due_on, total_cents, outstanding_cents, language, issuer_name, lifecycle")
      .eq("id", invoiceId)
      .maybeSingle(),
    "composeInvoiceEmail",
  );
  const full = must(await db.from("invoices").select("payment_method, issuer_snapshot").eq("id", invoiceId).single(), "composeInvoiceEmail.invoice");
  const snapshot = (full.issuer_snapshot ?? {}) as { iban?: string | null; trade_name?: string | null; legal_name?: string };
  const language = (inv.language ?? "es") as EmailLocale;
  const { subject, body } = renderEmail(template, language, {
    number: inv.number ?? "",
    issuerName: snapshot.trade_name || snapshot.legal_name || inv.issuer_name || "",
    totalCents: inv.total_cents ?? 0,
    outstandingCents: inv.outstanding_cents ?? undefined,
    issuedOn: inv.issued_on ?? "",
    dueOn: inv.due_on,
    paymentMethod: full.payment_method,
    iban: snapshot.iban ?? null,
  });
  return { to: inv.client_id ? await billingRecipients(db, inv.client_id) : [], subject, body, language };
}

async function invoicePdf(invoiceId: string): Promise<{ filename: string; content: Uint8Array } | null> {
  const admin = createAdminClient();
  const { data: inv } = await admin.from("invoices").select("id, org_id, pdf_path, number, lifecycle").eq("id", invoiceId).maybeSingle();
  if (!inv?.pdf_path || inv.lifecycle !== "issued") return null;
  const expectedPath = `${inv.org_id}/${inv.id}.pdf`;
  if (inv.pdf_path !== expectedPath) return null;
  const { data, error } = await admin.storage.from("invoices").download(expectedPath);
  if (error || !data) return null;
  return { filename: `${(inv.number ?? "factura").replace(/[^\w.-]+/g, "_")}.pdf`, content: new Uint8Array(await data.arrayBuffer()) };
}

/**
 * Envía un email de outbound_emails (una factura, un recordatorio o un informe mensual aprobados) y
 * deja el resultado en la fila: enviado con su id del proveedor, o fallido con el error.
 */
export async function sendOutboundEmail(
  db: Db,
  emailId: string,
  approverId: string,
  edits: Partial<{ to: string[]; subject: string; body: string }> = {},
): Promise<{ ok: true } | { ok: false; errorKey: string }> {
  const row = must(await db.from("outbound_emails").select("*").eq("id", emailId).maybeSingle(), "sendOutboundEmail");
  if (row.status === "sent") return { ok: true };
  if (row.status === "cancelled") return { ok: false, errorKey: "billing.errors.emailCancelled" };
  const to = (edits.to ?? row.to_emails).map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (to.length === 0) return { ok: false, errorKey: "billing.errors.emailNoRecipients" };
  const provider = getEmailProvider();
  if (!provider) return { ok: false, errorKey: "billing.errors.emailNotConfigured" };

  const subject = edits.subject ?? row.subject;
  const body = edits.body ?? row.body;
  const approved = { to_emails: to, subject, body, approved_by: approverId, approved_at: new Date().toISOString() };
  try {
    // El informe mensual no se guarda: su PDF se genera ahora, con la sesión de quien lo envía. Si no
    // se puede generar, lanza y el email queda fallido (se reintenta desde la bandeja): nunca sale sin él.
    const attachment = !row.attach_pdf
      ? null
      : row.template === "client_report"
        ? await clientReportAttachment(db, row)
        : row.invoice_id
          ? await invoicePdf(row.invoice_id)
          : null;
    // Se pidió el PDF y no está (sin copia en Storage, ruta no canónica…): el email queda fallido
    // en la bandeja para reintentarlo; nunca sale «la factura» sin su documento.
    if (row.attach_pdf && !attachment) throw new Error("PDF no disponible para adjuntar");
    const { data: org } = await db.from("orgs").select("name").eq("id", row.org_id).single();
    const sent = await provider.send({
      from: emailFrom(org?.name ?? "GNERAI"),
      to,
      subject,
      text: body,
      attachments: attachment ? [{ ...attachment, contentType: "application/pdf" }] : undefined,
    });
    const { error } = await db
      .from("outbound_emails")
      .update({ ...approved, status: "sent", sent_at: new Date().toISOString(), provider_message_id: sent.id, error: null })
      .eq("id", emailId);
    if (error) throw new DbError(error, "sendOutboundEmail.update");
    return { ok: true };
  } catch (error) {
    if (error instanceof DbError) throw error;
    console.error("[email]", error);
    await db
      .from("outbound_emails")
      .update({ ...approved, status: "failed", error: error instanceof Error ? error.message.slice(0, 500) : "error" })
      .eq("id", emailId);
    return { ok: false, errorKey: "billing.errors.emailFailed" };
  }
}

/** «Enviar factura»: guarda el email (ya aprobado por quien lo envía) y lo envía. */
export async function sendInvoiceEmail(
  db: Db,
  input: { orgId: string; invoiceId: string; approverId: string; to: string[]; subject: string; body: string; template?: EmailTemplate },
): Promise<{ ok: true; emailId: string } | { ok: false; errorKey: string }> {
  const inv = must(await db.from("invoices").select("client_id, language, lifecycle").eq("id", input.invoiceId).single(), "sendInvoiceEmail");
  if (inv.lifecycle !== "issued") throw new BillingRuleError("billing.errors.invoiceNotIssued");
  // Antes de guardar nada: sin destinatarios o sin proveedor, no queda un email colgado en «Por enviar».
  if (input.to.map((e) => e.trim()).filter(Boolean).length === 0) return { ok: false, errorKey: "billing.errors.emailNoRecipients" };
  if (!getEmailProvider()) return { ok: false, errorKey: "billing.errors.emailNotConfigured" };
  const { data, error } = await db
    .from("outbound_emails")
    .insert({
      org_id: input.orgId,
      invoice_id: input.invoiceId,
      client_id: inv.client_id,
      template: input.template ?? "invoice",
      language: inv.language,
      to_emails: input.to,
      subject: input.subject,
      body: input.body,
      attach_pdf: true,
    })
    .select("id")
    .single();
  if (error) throw new DbError(error, "sendInvoiceEmail.insert");
  const sent = await sendOutboundEmail(db, data.id, input.approverId);
  return sent.ok ? { ok: true, emailId: data.id } : sent;
}
