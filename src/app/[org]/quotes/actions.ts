"use server";

import { revalidatePath } from "next/cache";
import { createHash } from "node:crypto";
import type { FinalizedQuote, QuoteEmailDraft } from "@/components/quotes/types";
import { renderQuotePdf } from "@/pdf";
import type { ActionResult } from "@/lib/action-result";
import { nowInZone } from "@/lib/clock";
import { createClient } from "@/lib/supabase/server";
import { type Failure, failure, forbidden, idSchema, invalidInput, partnerContext } from "@/server/action-utils";
import { BillingRuleError, DbError } from "@/server/billing/context";
import { loadQuoteDocument } from "@/server/quotes/document";
import { acceptQuoteFlow } from "@/server/quotes/accept";
import { composeQuoteEmail, readFinalized, sendQuoteEmail } from "@/server/quotes/email";
import { quoteFailure } from "@/server/quotes/errors";
import { duplicateQuote as duplicateQuoteRow, saveQuoteRpc } from "@/server/quotes/save";
import { z } from "zod";
import {
  parseEmailList,
  type QuoteEmailFormInput,
  quoteEmailFormSchema,
  type QuoteFormInput,
  quoteFormSchema,
  type RejectFormInput,
  rejectFormSchema,
  toSaveQuotePayload,
} from "./schema";

type Supabase = Awaited<ReturnType<typeof createClient>>;
type OrgCtx = NonNullable<Awaited<ReturnType<typeof partnerContext>>>;

const today = (ctx: OrgCtx) => nowInZone(ctx.org.timezone).date;

/** Error de los helpers de presupuestos o de facturación, listo para el toast. */
async function describeError(error: unknown, where: string): Promise<Failure> {
  if (error instanceof DbError) return quoteFailure(error.error, error.where);
  if (error instanceof BillingRuleError) return failure(error.key);
  console.error(`[quotes] ${where}`, error);
  return failure("common.errorGeneric");
}

/**
 * Vuelve a pintar el listado, el presupuesto, la ficha de su cliente y el dashboard. Al aceptar,
 * también el pipeline (el deal pasa a ganado), los contratos y las facturas.
 */
function revalidateQuote(slug: string, opts: { quoteId?: string; clientId?: string | null; accepted?: boolean } = {}) {
  revalidatePath(`/${slug}`);
  revalidatePath(`/${slug}/quotes`);
  if (opts.quoteId) revalidatePath(`/${slug}/quotes/${opts.quoteId}`);
  if (opts.clientId) revalidatePath(`/${slug}/clients/${opts.clientId}`);
  if (opts.accepted) {
    revalidatePath(`/${slug}/pipeline`);
    revalidatePath(`/${slug}/contracts`);
    revalidatePath(`/${slug}/invoices`);
  }
}

type QuoteRef = { id: string; client_id: string; status: "draft" | "sent" | "accepted" | "rejected"; number: string | null };

/** El presupuesto, si es de la org; si no, el error para el toast. */
async function quoteOfOrg(supabase: Supabase, orgId: string, quoteId: unknown): Promise<{ quote: QuoteRef } | { failure: Failure }> {
  const id = idSchema.safeParse(quoteId);
  if (!id.success) return { failure: await invalidInput() };
  const { data, error } = await supabase
    .from("quotes")
    .select("id, client_id, status, number")
    .eq("org_id", orgId)
    .eq("id", id.data)
    .maybeSingle();
  if (error) return { failure: await quoteFailure(error, "quotes.load") };
  if (!data) return { failure: await failure("quotes.errors.notFound") };
  return { quote: data };
}

// ---------------------------------------------------------------------------
// Guardar, duplicar y borrar
// ---------------------------------------------------------------------------

/**
 * Guarda el presupuesto (o lo crea si no hay id) con todas sus líneas y su plan. Sin cliente
 * elegido, lo crea a la vez, como el pipeline. Devuelve el updated_at nuevo para el siguiente
 * guardado (bloqueo optimista).
 */
export async function saveQuote(
  slug: string,
  quoteId: string | null,
  input: QuoteFormInput,
  expectedUpdatedAt: string | null,
): Promise<ActionResult<{ id: string; updatedAt: string }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const parsed = quoteFormSchema(today(ctx)).safeParse(input);
  if (!parsed.success || (expectedUpdatedAt !== null && (typeof expectedUpdatedAt !== "string" || expectedUpdatedAt.length > 64))) {
    return invalidInput();
  }
  const v = parsed.data;
  const orgId = ctx.org.id;
  const supabase = await createClient();

  let previousClientId: string | null = null;
  if (quoteId !== null) {
    const loaded = await quoteOfOrg(supabase, orgId, quoteId);
    if ("failure" in loaded) return loaded.failure;
    previousClientId = loaded.quote.client_id;
  }

  let clientId = v.client_id;
  let createdClient = false;
  if (clientId) {
    const { data, error } = await supabase.from("clients").select("id").eq("id", clientId).eq("org_id", orgId).maybeSingle();
    if (error) return quoteFailure(error, "saveQuote.client");
    if (!data) return failure("quotes.errors.clientNotFound");
  } else {
    const { data, error } = await supabase
      .from("clients")
      .insert({
        org_id: orgId,
        display_name: v.new_client_name.trim(),
        owner_member_id: ctx.member.id,
        preferred_language: v.language,
      })
      .select("id")
      .single();
    if (error) return quoteFailure(error, "saveQuote.newClient");
    clientId = data.id;
    createdClient = true;
  }

  try {
    const saved = await saveQuoteRpc(
      supabase,
      toSaveQuotePayload(v, { quoteId, expectedUpdatedAt, clientId }),
    );
    revalidateQuote(ctx.org.slug, { quoteId: saved.id, clientId });
    if (previousClientId && previousClientId !== clientId) revalidatePath(`/${ctx.org.slug}/clients/${previousClientId}`);
    if (createdClient) revalidatePath(`/${ctx.org.slug}/clients`);
    return { ok: true, ...saved };
  } catch (error) {
    // Si el cliente se creó solo para este presupuesto, no se deja huérfano.
    if (createdClient) {
      await supabase.from("clients").update({ archived_at: new Date().toISOString() }).eq("id", clientId).eq("org_id", orgId);
    }
    return describeError(error, "saveQuote");
  }
}

/** «Duplicar»: un borrador nuevo con las mismas líneas y el mismo plan. */
export async function duplicateQuote(slug: string, quoteId: string): Promise<ActionResult<{ id: string }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const supabase = await createClient();
  const loaded = await quoteOfOrg(supabase, ctx.org.id, quoteId);
  if ("failure" in loaded) return loaded.failure;
  try {
    const id = await duplicateQuoteRow(supabase, ctx.org.id, loaded.quote.id);
    revalidateQuote(ctx.org.slug, { quoteId: id, clientId: loaded.quote.client_id });
    return { ok: true, id };
  } catch (error) {
    return describeError(error, "duplicateQuote");
  }
}

/** Borra un borrador (con sus líneas). Lo enviado no se borra: se rechaza o se duplica. */
export async function deleteQuote(slug: string, quoteId: string): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const supabase = await createClient();
  const loaded = await quoteOfOrg(supabase, ctx.org.id, quoteId);
  if ("failure" in loaded) return loaded.failure;
  if (loaded.quote.status !== "draft") return failure("quotes.errors.quoteNotDraft");
  const { data, error } = await supabase
    .from("quotes")
    .delete()
    .eq("id", loaded.quote.id)
    .eq("org_id", ctx.org.id)
    .eq("status", "draft")
    .select("id");
  if (error) return quoteFailure(error, "deleteQuote");
  if (data.length === 0) return failure("quotes.errors.quoteNotDraft");
  revalidateQuote(ctx.org.slug, { clientId: loaded.quote.client_id });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Enviar
// ---------------------------------------------------------------------------

/** Propuesta de email (en el idioma del presupuesto) para revisarla en el panel de envío. */
export async function prepareQuoteEmail(slug: string, quoteId: string): Promise<ActionResult<{ email: QuoteEmailDraft }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const supabase = await createClient();
  const loaded = await quoteOfOrg(supabase, ctx.org.id, quoteId);
  if ("failure" in loaded) return loaded.failure;
  if (loaded.quote.status === "accepted") return failure("quotes.errors.quoteFrozen");
  if (loaded.quote.status === "rejected") return failure("quotes.errors.quoteNotEditable");
  try {
    const { count, error } = await supabase
      .from("quote_lines")
      .select("id", { count: "exact", head: true })
      .eq("quote_id", loaded.quote.id);
    if (error) throw new DbError(error, "prepareQuoteEmail.lines");
    if (!count) return failure("quotes.errors.quoteNoLines");
    const email = await composeQuoteEmail(supabase, loaded.quote.id);
    if (!email) return failure("quotes.errors.notFound");
    return { ok: true, email };
  } catch (error) {
    return describeError(error, "prepareQuoteEmail");
  }
}

/**
 * «Enviar»: numera el presupuesto si era un borrador, genera el PDF y lo envía con el texto
 * revisado por el socio. Las respuestas del cliente le llegan a quien lo envía.
 */
export async function sendQuote(slug: string, quoteId: string, input: QuoteEmailFormInput): Promise<ActionResult<FinalizedQuote>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const parsed = quoteEmailFormSchema.safeParse(input);
  if (!parsed.success) return invalidInput();
  const supabase = await createClient();
  const loaded = await quoteOfOrg(supabase, ctx.org.id, quoteId);
  if ("failure" in loaded) return loaded.failure;
  if (loaded.quote.status === "accepted") return failure("quotes.errors.quoteFrozen");
  if (loaded.quote.status === "rejected") return failure("quotes.errors.quoteNotEditable");
  try {
    const result = await sendQuoteEmail(supabase, {
      orgId: ctx.org.id,
      orgName: ctx.org.name,
      quoteId: loaded.quote.id,
      approverId: ctx.user.id,
      replyTo: ctx.user.email,
      to: parseEmailList(parsed.data.to)!,
      subject: parsed.data.subject,
      body: parsed.data.body,
    });
    revalidateQuote(ctx.org.slug, { quoteId: loaded.quote.id, clientId: loaded.quote.client_id });
    if (!result.ok) return failure(result.errorKey);
    return { ok: true, number: result.number, issuedOn: result.issuedOn, validUntil: result.validUntil };
  } catch (error) {
    return describeError(error, "sendQuote");
  }
}

/** «Marcar como enviado» por otra vía: guarda canal, destinatario y copia exacta del PDF. */
const manualSendSchema = z.object({ method: z.enum(["email", "whatsapp", "linkedin", "other"]), recipient: z.string().trim().max(254), note: z.string().trim().max(2000) });

export async function markQuoteSent(slug: string, quoteId: string, input: z.input<typeof manualSendSchema>): Promise<ActionResult<FinalizedQuote>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const parsed = manualSendSchema.safeParse(input);
  if (!parsed.success) return invalidInput();
  const supabase = await createClient();
  const loaded = await quoteOfOrg(supabase, ctx.org.id, quoteId);
  if ("failure" in loaded) return loaded.failure;
  const { data, error } = await supabase.rpc("finalize_quote", { p_quote_id: loaded.quote.id });
  if (error) return quoteFailure(error, "markQuoteSent");
  try {
    const finalizedQuote = await loadQuoteDocument(supabase, loaded.quote.id);
    if (!finalizedQuote) return failure("quotes.errors.notFound");
    const pdf = await renderQuotePdf(finalizedQuote.document);
    const { error: snapshotError } = await supabase.from("quote_sent_versions").insert({
      org_id: ctx.org.id,
      quote_id: loaded.quote.id,
      method: parsed.data.method,
      recipient: parsed.data.recipient || null,
      note: parsed.data.note || null,
      document_snapshot: JSON.parse(JSON.stringify(finalizedQuote.document)),
      pdf_snapshot: `\\x${Buffer.from(pdf).toString("hex")}`,
      pdf_sha256: createHash("sha256").update(pdf).digest("hex"),
      created_by: ctx.user.id,
    });
    if (snapshotError) return await quoteFailure(snapshotError, "markQuoteSent.snapshot");
  } catch (cause) {
    return describeError(cause, "markQuoteSent.snapshot");
  }
  revalidateQuote(ctx.org.slug, { quoteId: loaded.quote.id, clientId: loaded.quote.client_id });
  return { ok: true, ...readFinalized(data) };
}

// ---------------------------------------------------------------------------
// Aceptar y rechazar
// ---------------------------------------------------------------------------

/**
 * «Marcar aceptado» (ARCHITECTURE.md §7.3): contrato con líneas, emisor e hitos, deal ganado y,
 * si el primer pago es a la aceptación, el borrador de su factura. `warning` explica por qué no
 * se ha podido preparar ese borrador (el contrato ya existe; el cron lo reintenta).
 */
export async function acceptQuote(
  slug: string,
  quoteId: string,
): Promise<ActionResult<{ contractId: string; invoiceId: string | null; warning: string | null }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const supabase = await createClient();
  const loaded = await quoteOfOrg(supabase, ctx.org.id, quoteId);
  if ("failure" in loaded) return loaded.failure;
  try {
    const result = await acceptQuoteFlow(supabase, ctx.org.id, loaded.quote.id, today(ctx));
    revalidateQuote(ctx.org.slug, { quoteId: loaded.quote.id, clientId: loaded.quote.client_id, accepted: true });
    revalidatePath(`/${ctx.org.slug}/contracts/${result.contractId}`);
    if (result.invoiceId) revalidatePath(`/${ctx.org.slug}/invoices/${result.invoiceId}`);
    const warning = result.billingErrorKey ? (await failure(result.billingErrorKey)).error : null;
    return { ok: true, contractId: result.contractId, invoiceId: result.invoiceId, warning };
  } catch (error) {
    return describeError(error, "acceptQuote");
  }
}

/** El cliente ha dicho que no (con el motivo, si se sabe). */
export async function rejectQuote(slug: string, quoteId: string, input: RejectFormInput): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const parsed = rejectFormSchema.safeParse(input);
  if (!parsed.success) return invalidInput();
  const supabase = await createClient();
  const loaded = await quoteOfOrg(supabase, ctx.org.id, quoteId);
  if ("failure" in loaded) return loaded.failure;
  const { error } = await supabase.rpc("reject_quote", { p_quote_id: loaded.quote.id, p_reason: parsed.data.reason });
  if (error) return quoteFailure(error, "rejectQuote");
  revalidateQuote(ctx.org.slug, { quoteId: loaded.quote.id, clientId: loaded.quote.client_id });
  return { ok: true };
}
