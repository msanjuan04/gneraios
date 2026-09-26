"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { IssueResult } from "@/components/invoices/types";
import { parseMoneyInput } from "@/domain/money";
import type { ActionResult } from "@/lib/action-result";
import { nowInZone } from "@/lib/clock";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { emptyToNull } from "@/lib/validation/fiscal";
import { type Failure, failure, forbidden, idSchema, invalidInput, partnerContext } from "@/server/action-utils";
import { BillingRuleError, DbError } from "@/server/billing/context";
import { billingFailure } from "@/server/billing/errors";
import { BillingBusyError, runBillingForOrg } from "@/server/billing/run";
import { composeInvoiceEmail, sendInvoiceEmail, sendOutboundEmail } from "@/server/email/send";
import { type DraftEditorInput, type DraftEditorLine, saveDraft } from "@/server/invoicing/drafts";
import { issueInvoices } from "@/server/invoicing/issue";
import {
  type DraftFormInput,
  draftFormSchema,
  type EmailFormInput,
  emailFormSchema,
  parseDiscountInput,
  parseEmailList,
  parseQuantityInput,
  type PaymentFormInput,
  paymentFormSchema,
  type RectifyFormInput,
  rectifyFormSchema,
  type ReleaseItemsInput,
  releaseItemsSchema,
  type SaveDraftOptions,
  saveDraftOptionsSchema,
} from "./schema";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Error de los helpers de facturación, listo para el toast. */
async function describeError(error: unknown, where: string): Promise<Failure> {
  if (error instanceof DbError) return billingFailure(error.error, error.where);
  if (error instanceof BillingRuleError) return failure(error.key);
  console.error(`[invoices] ${where}`, error);
  return failure("common.errorGeneric");
}

/** Vuelve a pintar el listado, las facturas tocadas, la bandeja, las fichas de sus clientes y el dashboard. */
function revalidateInvoices(slug: string, opts: { invoiceIds?: string[]; clientIds?: string[] } = {}) {
  revalidatePath(`/${slug}/invoices`);
  revalidatePath(`/${slug}/invoices/outbox`);
  for (const id of new Set(opts.invoiceIds ?? [])) revalidatePath(`/${slug}/invoices/${id}`);
  for (const id of new Set(opts.clientIds ?? [])) revalidatePath(`/${slug}/clients/${id}`);
  revalidatePath(`/${slug}`);
}

const today = (timeZone: string) => nowInZone(timeZone).date;

async function loadInvoice(supabase: Supabase, orgId: string, invoiceId: string) {
  const { data, error } = await supabase
    .from("invoices")
    .select("id, kind, lifecycle, client_id, issuer_id, contract_id, grouping_key, issued_on, number, updated_at")
    .eq("org_id", orgId)
    .eq("id", invoiceId)
    .maybeSingle();
  if (error) throw new DbError(error, "invoices.load");
  return data;
}

// ---------------------------------------------------------------------------
// Borradores
// ---------------------------------------------------------------------------

/**
 * Guarda un borrador (o crea la factura manual si no hay id) con todas sus líneas. Lo que viene
 * del contrato (su línea, su periodo y su tipo) y lo que rectifica cada línea se toma de la base
 * de datos, nunca del formulario. Devuelve el nuevo updated_at para el siguiente guardado.
 */
export async function saveInvoiceDraft(
  slug: string,
  invoiceId: string | null,
  input: DraftFormInput,
  options: SaveDraftOptions,
): Promise<ActionResult<{ id: string; updatedAt: string }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = invoiceId === null ? null : idSchema.safeParse(invoiceId);
  const opts = saveDraftOptionsSchema.safeParse(options);
  if ((id && !id.success) || !opts.success) return invalidInput();

  const orgId = ctx.org.id;
  const supabase = await createClient();
  try {
    const invoice = id ? await loadInvoice(supabase, orgId, id.data) : null;
    if (id && !invoice) return failure("billing.errors.draftNotFound");
    if (invoice && invoice.lifecycle !== "draft") return failure("billing.errors.invoiceImmutable");

    const kind = invoice?.kind ?? "ordinary";
    const parsed = draftFormSchema({ kind, today: today(ctx.org.timezone), minLines: invoice ? 0 : 1 }).safeParse(input);
    if (!parsed.success) return invalidInput();
    const v = parsed.data;

    const existing = new Map<
      string,
      { contract_line_id: string | null; rectifies_line_id: string | null; billing_type: DraftEditorLine["billingType"]; period_start: string | null; period_end: string | null }
    >();
    if (invoice) {
      const { data, error } = await supabase
        .from("invoice_lines")
        .select("id, contract_line_id, rectifies_line_id, billing_type, period_start, period_end")
        .eq("invoice_id", invoice.id);
      if (error) throw new DbError(error, "saveDraft.lines");
      for (const l of data) existing.set(l.id, l);
    }

    // Un borrador del contrato o una rectificativa conservan emisor y cliente.
    const locked =
      invoice !== null &&
      (invoice.kind === "rectifying" ||
        invoice.contract_id !== null ||
        invoice.grouping_key !== null ||
        [...existing.values()].some((l) => l.contract_line_id !== null));
    const issuerId = locked ? invoice.issuer_id : v.issuer_id;
    const clientId = locked ? invoice.client_id : v.client_id;

    if (v.series_id) {
      const { data, error } = await supabase
        .from("invoice_series")
        .select("issuer_id, kind, archived_at")
        .eq("org_id", orgId)
        .eq("id", v.series_id)
        .maybeSingle();
      if (error) throw new DbError(error, "saveDraft.series");
      if (!data || data.issuer_id !== issuerId || data.kind !== kind || data.archived_at) {
        return failure("billing.errors.seriesInvalid");
      }
    }

    const lines: DraftEditorLine[] = v.lines.map((line) => {
      const saved = existing.get(line.id);
      const fromContract = Boolean(saved?.contract_line_id);
      return {
        id: line.id,
        description: line.description,
        quantity: parseQuantityInput(line.quantity)!,
        unitPriceCents: parseMoneyInput(line.unit_price)!,
        discountBps: parseDiscountInput(line.discount)!,
        taxRateId: line.tax_rate_id,
        irpfApplies: line.irpf_applies,
        // Lo que viene del contrato no cambia de tipo ni de periodo: así las métricas no se mezclan.
        billingType: fromContract && saved ? saved.billing_type : line.billing_type,
        periodStart: fromContract && saved ? saved.period_start : emptyToNull(line.period_start),
        periodEnd: fromContract && saved ? saved.period_end : emptyToNull(line.period_end),
        contractLineId: saved?.contract_line_id ?? null,
        rectifiesLineId: saved?.rectifies_line_id ?? null,
      };
    });

    // Lo quitado a propósito que venía de un pendiente del contrato: se condona en vez de volver a pendiente.
    const kept = new Set(v.lines.map((l) => l.id));
    const waiveLines = opts.data.waiveLineIds.filter((lineId) => existing.has(lineId) && !kept.has(lineId));
    let waiveItemIds: string[] = [];
    if (waiveLines.length > 0) {
      const { data, error } = await supabase
        .from("billable_items")
        .select("id")
        .eq("org_id", orgId)
        .in("invoice_line_id", waiveLines);
      if (error) throw new DbError(error, "saveDraft.items");
      waiveItemIds = data.map((i) => i.id);
    }

    const draft: DraftEditorInput = {
      invoiceId: invoice?.id ?? null,
      expectedUpdatedAt: invoice ? opts.data.expectedUpdatedAt : null,
      header: {
        issuerId,
        clientId,
        seriesId: emptyToNull(v.series_id),
        issuedOn: emptyToNull(v.issued_on),
        operationOn: emptyToNull(v.operation_on),
        dueOn: v.due_mode === "date" ? emptyToNull(v.due_on) : null,
        paymentTermsDays: v.due_mode === "terms" && v.payment_terms_days !== "" ? Number(v.payment_terms_days) : null,
        language: v.language,
        irpfBps: Number(v.irpf_bps),
        paymentMethod: v.payment_method,
        notes: emptyToNull(v.notes),
        ...(kind === "rectifying" && { rectificationReason: v.rectification_reason.trim() }),
      },
      lines,
      waiveItemIds,
      waiveReason: null,
    };

    const savedId = await saveDraft(supabase, orgId, draft);
    const { data: fresh, error } = await supabase.from("invoices").select("updated_at").eq("id", savedId).single();
    if (error) throw new DbError(error, "saveDraft.reload");

    revalidateInvoices(ctx.org.slug, { invoiceIds: [savedId], clientIds: [clientId, invoice?.client_id ?? clientId] });
    return { ok: true, id: savedId, updatedAt: fresh.updated_at };
  } catch (error) {
    return describeError(error, "saveInvoiceDraft");
  }
}

const versionSchema = z.string().min(1).max(64).nullable();

/**
 * Número y fecha con los que se emitiría ahora (para la confirmación). No reserva nada. Si el
 * borrador ha cambiado desde que se abrió (p. ej. el cron le ha añadido algo), no se emite a ciegas.
 */
export async function prepareIssue(
  slug: string,
  invoiceId: string,
  expectedUpdatedAt: string | null,
): Promise<ActionResult<{ number: string | null; issuedOn: string }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(invoiceId);
  const version = versionSchema.safeParse(expectedUpdatedAt);
  if (!id.success || !version.success) return invalidInput();
  const supabase = await createClient();
  try {
    const invoice = await loadInvoice(supabase, ctx.org.id, id.data);
    if (!invoice) return failure("billing.errors.draftNotFound");
    const issuedOn = invoice.issued_on ?? today(ctx.org.timezone);
    if (invoice.lifecycle !== "draft") return { ok: true, number: invoice.number, issuedOn };
    if (version.data && version.data !== invoice.updated_at) return failure("billing.errors.draftChanged");
    const { data, error } = await supabase.rpc("invoice_next_number", { p_invoice_id: id.data });
    if (error) throw new DbError(error, "prepareIssue");
    return { ok: true, number: data ?? null, issuedOn };
  } catch (error) {
    return describeError(error, "prepareIssue");
  }
}

const issueIdsSchema = z.array(z.guid()).min(1).max(100);
const expectedVersionsSchema = z.record(z.guid(), z.string().min(1).max(64));

/**
 * Emite borradores (o completa los que se quedaron emitiendo), de uno en uno y en orden por
 * emisor y serie, del más antiguo al más reciente. El resultado va por factura. `expected`
 * (id → updated_at) evita emitir un borrador que ha cambiado desde que se revisó.
 */
export async function issueDrafts(
  slug: string,
  invoiceIds: string[],
  expected: Record<string, string> = {},
): Promise<ActionResult<{ results: IssueResult[] }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const ids = issueIdsSchema.safeParse(invoiceIds);
  const versions = expectedVersionsSchema.safeParse(expected);
  if (!ids.success || !versions.success) return invalidInput();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("invoices")
    .select("id, lifecycle, issuer_id, series_id, kind, client_id, created_at, updated_at")
    .eq("org_id", ctx.org.id)
    .in("id", [...new Set(ids.data)])
    .in("lifecycle", ["draft", "issuing"]);
  if (error) return describeError(new DbError(error, "issueDrafts.load"), "issueDrafts");

  const changedError = (await failure("billing.errors.draftChanged")).error;
  const changed = data.filter((i) => i.lifecycle === "draft" && versions.data[i.id] && versions.data[i.id] !== i.updated_at);
  const ordered = data.filter((i) => !changed.includes(i)).sort(
    (a, b) =>
      // Primero se completa lo que se quedó a medias; después, por emisor, tipo y serie.
      Number(a.lifecycle === "draft") - Number(b.lifecycle === "draft") ||
      a.issuer_id.localeCompare(b.issuer_id) ||
      a.kind.localeCompare(b.kind) ||
      (a.series_id ?? "").localeCompare(b.series_id ?? "") ||
      a.created_at.localeCompare(b.created_at),
  );
  const outcomes = await issueInvoices(
    supabase,
    ordered.map((i) => i.id),
  );

  const found = new Set(data.map((i) => i.id));
  const notFound = (await failure("billing.errors.draftNotFound")).error;
  const results: IssueResult[] = [
    ...outcomes.map((o): IssueResult => (o.ok ? { invoiceId: o.invoiceId, ok: true, number: o.number } : o)),
    ...changed.map((i): IssueResult => ({ invoiceId: i.id, ok: false, error: changedError })),
    ...[...new Set(ids.data)].filter((i) => !found.has(i)).map((invoiceId): IssueResult => ({ invoiceId, ok: false, error: notFound })),
  ];

  revalidateInvoices(ctx.org.slug, { invoiceIds: ordered.map((i) => i.id), clientIds: ordered.map((i) => i.client_id) });
  return { ok: true, results };
}

/**
 * Borra un borrador: sus conceptos del contrato vuelven a pendiente de facturar. No revalida:
 * eso volvería a pintar la página del borrador ya borrado (un 404) antes de que el editor
 * navegue al listado, que es dinámico y se lee de nuevo al llegar.
 */
export async function deleteDraft(slug: string, invoiceId: string): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(invoiceId);
  if (!id.success) return invalidInput();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invoices")
    .delete()
    .eq("org_id", ctx.org.id)
    .eq("id", id.data)
    .eq("lifecycle", "draft")
    .select("id");
  if (error) return describeError(new DbError(error, "deleteDraft"), "deleteDraft");
  if (data.length === 0) return failure("billing.errors.draftNotFound");
  return { ok: true };
}

/** «Facturar ahora»: la misma ejecución que el cron diario, para esta org y ahora mismo. */
export async function runBillingNow(
  slug: string,
): Promise<ActionResult<{ itemsCreated: number; drafts: number; notifications: number; emails: number }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  try {
    const summary = await runBillingForOrg(createAdminClient(), ctx.org.id);
    revalidateInvoices(ctx.org.slug);
    return {
      ok: true,
      itemsCreated: summary.itemsCreated,
      drafts: summary.drafts,
      notifications: summary.notifications,
      emails: summary.emails,
    };
  } catch (error) {
    revalidateInvoices(ctx.org.slug);
    if (error instanceof BillingBusyError) return failure("billing.errors.billingRunBusy");
    return describeError(error, "runBillingNow");
  }
}

// ---------------------------------------------------------------------------
// Cobros
// ---------------------------------------------------------------------------

/** Registra un cobro (parcial, total o, en negativo, una devolución) de una factura emitida. */
export async function addPayment(slug: string, invoiceId: string, input: PaymentFormInput): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(invoiceId);
  const parsed = paymentFormSchema(today(ctx.org.timezone)).safeParse(input);
  if (!id.success || !parsed.success) return invalidInput();
  const supabase = await createClient();
  try {
    const invoice = await loadInvoice(supabase, ctx.org.id, id.data);
    if (!invoice) return failure("invoices.errors.notFound");
    if (invoice.lifecycle !== "issued") return failure("billing.errors.paymentNotIssued");
    const { error } = await supabase.from("payments").insert({
      org_id: ctx.org.id,
      invoice_id: invoice.id,
      amount_cents: parseMoneyInput(parsed.data.amount)!,
      paid_on: parsed.data.paid_on,
      method: parsed.data.method,
      reference: emptyToNull(parsed.data.reference),
    });
    if (error) throw new DbError(error, "addPayment");
    revalidateInvoices(ctx.org.slug, { invoiceIds: [invoice.id], clientIds: [invoice.client_id] });
    return { ok: true };
  } catch (error) {
    return describeError(error, "addPayment");
  }
}

export async function deletePayment(slug: string, invoiceId: string, paymentId: string): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const invoice = idSchema.safeParse(invoiceId);
  const payment = idSchema.safeParse(paymentId);
  if (!invoice.success || !payment.success) return invalidInput();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("payments")
    .delete()
    .eq("org_id", ctx.org.id)
    .eq("invoice_id", invoice.data)
    .eq("id", payment.data)
    .select("id");
  if (error) return describeError(new DbError(error, "deletePayment"), "deletePayment");
  if (data.length === 0) return failure("invoices.errors.paymentNotFound");
  const { data: inv } = await supabase.from("invoices").select("client_id").eq("id", invoice.data).maybeSingle();
  revalidateInvoices(ctx.org.slug, { invoiceIds: [invoice.data], clientIds: inv ? [inv.client_id] : [] });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Emails: enviar una factura y la bandeja «Por enviar»
// ---------------------------------------------------------------------------

/** Propuesta de email para una factura emitida, en el idioma del cliente, para revisarla antes de enviar. */
export async function composeEmail(
  slug: string,
  invoiceId: string,
): Promise<ActionResult<{ to: string; subject: string; body: string; language: string }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(invoiceId);
  if (!id.success) return invalidInput();
  const supabase = await createClient();
  try {
    const invoice = await loadInvoice(supabase, ctx.org.id, id.data);
    if (!invoice) return failure("invoices.errors.notFound");
    const draft = await composeInvoiceEmail(supabase, invoice.id, "invoice");
    return { ok: true, to: draft.to.join(", "), subject: draft.subject, body: draft.body, language: draft.language };
  } catch (error) {
    return describeError(error, "composeEmail");
  }
}

/** Envía la factura por email: lo aprueba quien lo envía, que es un socio. */
export async function sendInvoiceByEmail(slug: string, invoiceId: string, input: EmailFormInput): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(invoiceId);
  const parsed = emailFormSchema.safeParse(input);
  if (!id.success || !parsed.success) return invalidInput();
  const supabase = await createClient();
  try {
    const invoice = await loadInvoice(supabase, ctx.org.id, id.data);
    if (!invoice) return failure("invoices.errors.notFound");
    const sent = await sendInvoiceEmail(supabase, {
      orgId: ctx.org.id,
      invoiceId: invoice.id,
      approverId: ctx.user.id,
      to: parseEmailList(parsed.data.to)!,
      subject: parsed.data.subject,
      body: parsed.data.body,
    });
    revalidateInvoices(ctx.org.slug, { invoiceIds: [invoice.id] });
    return sent.ok ? { ok: true } : failure(sent.errorKey);
  } catch (error) {
    return describeError(error, "sendInvoiceByEmail");
  }
}

/** Envía un email de la bandeja (un recordatorio por aprobar, o reintenta uno fallido) con los cambios del socio. */
export async function sendOutboxEmail(slug: string, emailId: string, input: EmailFormInput): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(emailId);
  const parsed = emailFormSchema.safeParse(input);
  if (!id.success || !parsed.success) return invalidInput();
  const supabase = await createClient();
  try {
    const { data: email, error } = await supabase
      .from("outbound_emails")
      .select("id, status, invoice_id")
      .eq("org_id", ctx.org.id)
      .eq("id", id.data)
      .maybeSingle();
    if (error) throw new DbError(error, "sendOutboxEmail.load");
    if (!email || (email.status !== "pending_approval" && email.status !== "failed")) {
      return failure("invoices.errors.emailNotFound");
    }
    const sent = await sendOutboundEmail(supabase, email.id, ctx.user.id, {
      to: parseEmailList(parsed.data.to)!,
      subject: parsed.data.subject,
      body: parsed.data.body,
    });
    revalidateInvoices(ctx.org.slug, { invoiceIds: email.invoice_id ? [email.invoice_id] : [] });
    return sent.ok ? { ok: true } : failure(sent.errorKey);
  } catch (error) {
    return describeError(error, "sendOutboxEmail");
  }
}

/** Descarta un recordatorio por aprobar: no se envía y queda en el historial como descartado. */
export async function discardOutboxEmail(slug: string, emailId: string): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(emailId);
  if (!id.success) return invalidInput();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("outbound_emails")
    .update({ status: "cancelled" })
    .eq("org_id", ctx.org.id)
    .eq("id", id.data)
    .eq("status", "pending_approval")
    .select("id, invoice_id");
  if (error) return describeError(new DbError(error, "discardOutboxEmail"), "discardOutboxEmail");
  if (data.length === 0) return failure("invoices.errors.emailNotFound");
  revalidateInvoices(ctx.org.slug, { invoiceIds: data.flatMap((d) => (d.invoice_id ? [d.invoice_id] : [])) });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Rectificativas y conceptos de una factura anulada
// ---------------------------------------------------------------------------

/**
 * Crea el borrador rectificativo: total (anular: todas las líneas en negativo) o por diferencias
 * (vacío, para añadir lo que se corrige). Si ya hay uno en borrador, devuelve ese.
 */
export async function rectifyInvoice(slug: string, invoiceId: string, input: RectifyFormInput): Promise<ActionResult<{ id: string }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(invoiceId);
  const parsed = rectifyFormSchema.safeParse(input);
  if (!id.success || !parsed.success) return invalidInput();
  const supabase = await createClient();
  try {
    const invoice = await loadInvoice(supabase, ctx.org.id, id.data);
    if (!invoice) return failure("invoices.errors.notFound");
    const { data, error } = await supabase.rpc("create_rectification", {
      p_invoice_id: invoice.id,
      p_reason: parsed.data.reason,
      p_full: parsed.data.mode === "full",
    });
    if (error) throw new DbError(error, "rectifyInvoice");
    revalidateInvoices(ctx.org.slug, { invoiceIds: [invoice.id, data], clientIds: [invoice.client_id] });
    return { ok: true, id: data };
  } catch (error) {
    return describeError(error, "rectifyInvoice");
  }
}

/** Tras anular una factura: sus conceptos del contrato vuelven a pendiente (se refacturan) o se condonan. */
export async function releaseInvoiceItems(
  slug: string,
  invoiceId: string,
  input: ReleaseItemsInput,
): Promise<ActionResult<{ count: number }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(invoiceId);
  const parsed = releaseItemsSchema.safeParse(input);
  if (!id.success || !parsed.success) return invalidInput();
  const supabase = await createClient();
  try {
    const invoice = await loadInvoice(supabase, ctx.org.id, id.data);
    if (!invoice) return failure("invoices.errors.notFound");
    const { data, error } = await supabase.rpc("release_invoice_items", {
      p_invoice_id: invoice.id,
      p_waive: parsed.data.waive,
      p_reason: parsed.data.waive ? (emptyToNull(parsed.data.reason) ?? undefined) : undefined,
    });
    if (error) throw new DbError(error, "releaseInvoiceItems");
    revalidateInvoices(ctx.org.slug, { invoiceIds: [invoice.id], clientIds: [invoice.client_id] });
    return { ok: true, count: data };
  } catch (error) {
    return describeError(error, "releaseInvoiceItems");
  }
}
