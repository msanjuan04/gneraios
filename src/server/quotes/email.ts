import "server-only";
import { createHash } from "node:crypto";
import type { FinalizedQuote, QuoteEmailDraft } from "@/components/quotes/types";
import { renderQuotePdf } from "@/pdf";
import { type Db, DbError, must } from "@/server/billing/context";
import { emailFrom, getEmailProvider } from "@/server/email/provider";
import { billingRecipients } from "@/server/email/send";
import { loadQuoteDocument, quotePdfFilename } from "./document";
import { renderQuoteEmail } from "./email-copy";

/**
 * Envío de un presupuesto por email, con el PDF adjunto. Se registra en outbound_emails
 * (plantilla 'quote', con su quote_id) solo cuando el proveedor lo ha aceptado: así en la bandeja
 * de facturas nunca queda un presupuesto «por reintentar» que se enviaría sin su PDF.
 */

/** Propuesta de email para un presupuesto (el socio la revisa antes de enviar); null si no lo ve. */
export async function composeQuoteEmail(db: Db, quoteId: string): Promise<QuoteEmailDraft | null> {
  const loaded = await loadQuoteDocument(db, quoteId);
  if (!loaded) return null;
  const { quote, document, totals } = loaded;
  const issuerName = document.issuer.tradeName || document.issuer.legalName;
  const { subject, body } = renderQuoteEmail(quote.language, {
    title: quote.title,
    issuerName,
    validUntil: document.validUntil ?? document.issuedOn,
    oneOffCents: totals.oneOff?.totalCents ?? null,
    monthlyCents: totals.monthly?.totalCents ?? null,
    yearlyCents: totals.yearly?.totalCents ?? null,
    hasUsage: totals.usageCount > 0,
  });
  const to = await billingRecipients(db, quote.client_id);
  // Un borrador aún no tiene número: el PDF se llamará como el que se le asigne al enviarlo.
  const attachment = quote.number ? quotePdfFilename(quote) : null;
  return { to: to.join(", "), subject, body, language: quote.language, attachment };
}

export type SendQuoteResult = ({ ok: true } & FinalizedQuote) | { ok: false; errorKey: string; number: string | null };

/** El JSON que devuelve finalize_quote. */
export function readFinalized(value: unknown): FinalizedQuote {
  const row = (value ?? {}) as { number?: unknown; issued_on?: unknown; valid_until?: unknown };
  return {
    number: typeof row.number === "string" ? row.number : "",
    issuedOn: typeof row.issued_on === "string" ? row.issued_on : null,
    validUntil: typeof row.valid_until === "string" ? row.valid_until : null,
  };
}

/**
 * «Enviar presupuesto»: lo numera si era un borrador (finalize_quote), genera el PDF, lo envía y
 * deja el envío registrado. Sin proveedor configurado no se toca nada. Si el proveedor falla, el
 * presupuesto ya tiene número (se puede reintentar o enviar por otra vía).
 */
export async function sendQuoteEmail(
  db: Db,
  input: {
    orgId: string;
    orgName: string;
    quoteId: string;
    approverId: string;
    replyTo: string | null;
    to: string[];
    subject: string;
    body: string;
  },
): Promise<SendQuoteResult> {
  const provider = getEmailProvider();
  if (!provider) return { ok: false, errorKey: "billing.errors.emailNotConfigured", number: null };
  if (input.to.length === 0) return { ok: false, errorKey: "billing.errors.emailNoRecipients", number: null };

  const { data, error } = await db.rpc("finalize_quote", { p_quote_id: input.quoteId });
  if (error) throw new DbError(error, "sendQuoteEmail.finalize");
  const finalized = readFinalized(data);
  const { number } = finalized;

  const loaded = await loadQuoteDocument(db, input.quoteId);
  if (!loaded) throw new Error("sendQuoteEmail: presupuesto no encontrado tras numerarlo");
  const pdf = await renderQuotePdf(loaded.document);
  const approvedAt = new Date().toISOString();
  // Persist exact PDF + document before external side effect. If provider outcome becomes
  // uncertain, the attempted message still has recoverable evidence and immutable attachment.
  const snapshot = must(
    await db.from("outbound_emails").insert({
      org_id: input.orgId,
      quote_id: input.quoteId,
      client_id: loaded.quote.client_id,
      template: "quote",
      language: loaded.quote.language,
      to_emails: input.to,
      subject: input.subject,
      body: input.body,
      attach_pdf: true,
      status: "pending_approval",
      approved_by: input.approverId,
      approved_at: approvedAt,
      quote_document_snapshot: JSON.parse(JSON.stringify(loaded.document)),
      quote_pdf_snapshot: `\\x${Buffer.from(pdf).toString("hex")}`,
      quote_pdf_sha256: createHash("sha256").update(pdf).digest("hex"),
    }).select("id").single(),
    "sendQuoteEmail.snapshot",
  );

  let providerId: string;
  try {
    const sent = await provider.send({
      from: emailFrom(input.orgName),
      to: input.to,
      replyTo: input.replyTo,
      subject: input.subject,
      text: input.body,
      attachments: [{ filename: quotePdfFilename(loaded.quote), content: new Uint8Array(pdf), contentType: "application/pdf" }],
    });
    providerId = sent.id;
  } catch (sendError) {
    console.error("[quotes] email", sendError);
    const { error: updateError } = await db.from("outbound_emails").update({ status: "failed", error: "provider_send_failed" }).eq("id", snapshot.id).eq("org_id", input.orgId);
    if (updateError) console.error("[quotes] email snapshot failure", updateError);
    return { ok: false, errorKey: "billing.errors.emailFailed", number };
  }

  const now = new Date().toISOString();
  must(await db.from("outbound_emails").update({ status: "sent", sent_at: now, provider_message_id: providerId, error: null }).eq("id", snapshot.id).eq("org_id", input.orgId), "sendQuoteEmail.log");
  return { ok: true, ...finalized };
}
