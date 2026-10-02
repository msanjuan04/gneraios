"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { nowInZone } from "@/lib/clock";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json, TablesInsert } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { emptyToNull } from "@/lib/validation/fiscal";
import { failure, forbidden, idSchema, invalidInput, ownerContext, partnerContext } from "@/server/action-utils";
import { BillingRuleError, DbError } from "@/server/billing/context";
import { billingFailure } from "@/server/billing/errors";
import { removeAttachments } from "@/server/finance/attachments";
import { financeErrorKey, financeFailure } from "@/server/finance/errors";
import { generateSubscriptionExpenses } from "@/server/finance/generate";
import { type RebillResult, rebillClientExpenses } from "@/server/finance/rebill";
import type { OrgContext } from "@/server/session";
import {
  assignmentColumns,
  type CashAccountFormInput,
  cashAccountFormSchema,
  type CashBalanceFormInput,
  cashBalanceFormSchema,
  type ExpenseFormInput,
  expenseAmountsFromInput,
  expenseFormSchema,
  moneyToCents,
  type PaymentFormInput,
  paymentFormSchema,
  percentToBps,
  type ShareholdingsFormInput,
  shareholdingsFormSchema,
  type SubscriptionFormInput,
  subscriptionFormSchema,
  type VendorFormInput,
  vendorFormSchema,
} from "./schema";

type Supabase = Awaited<ReturnType<typeof createClient>>;

const today = (ctx: OrgContext) => nowInZone(ctx.org.timezone).date;

/** Vuelve a pintar todas las pestañas de Finanzas (resumen, gastos, suscripciones, caja y socios). */
function revalidateFinance(slug: string) {
  revalidatePath(`/${slug}/finance`, "layout");
}

/** Las fichas de los clientes a los que sirve (o servía) un gasto: su tarjeta «Por repercutir» cambia. */
function revalidateClients(slug: string, clientIds: (string | null | undefined)[]) {
  for (const id of new Set(clientIds)) if (id) revalidatePath(`/${slug}/clients/${id}`);
}

/** `%` y `_` son comodines de ilike: el nombre se busca tal cual. */
const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * El proveedor elegido o, si se ha escrito uno nuevo, el que ya exista con ese nombre (sin
 * distinguir mayúsculas) o uno nuevo con la categoría del gasto como la suya por defecto.
 */
async function resolveVendor(
  supabase: Supabase,
  orgId: string,
  input: { vendor_id: string; new_vendor_name: string; category_id: string },
): Promise<{ id: string | null } | { failure: Awaited<ReturnType<typeof failure>> }> {
  if (input.vendor_id) return { id: input.vendor_id };
  const name = input.new_vendor_name.trim();
  if (!name) return { id: null };
  const existing = await supabase
    .from("vendors")
    .select("id")
    .eq("org_id", orgId)
    .is("archived_at", null)
    .ilike("name", escapeLike(name))
    .limit(1)
    .maybeSingle();
  if (existing.error) return { failure: await financeFailure(existing.error, "resolveVendor.load") };
  if (existing.data) return { id: existing.data.id };
  const created = await supabase
    .from("vendors")
    .insert({ org_id: orgId, name, default_category_id: input.category_id })
    .select("id")
    .single();
  if (created.error) return { failure: await financeFailure(created.error, "resolveVendor.insert") };
  return { id: created.data.id };
}

// ---------------------------------------------------------------------------
// Gastos
// ---------------------------------------------------------------------------

/** Crea o actualiza un gasto. Los importes los calcula el dominio (IVA e IRPF redondeados sobre la base). */
export async function saveExpense(slug: string, expenseId: string | null, input: ExpenseFormInput): Promise<ActionResult<{ id: string }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const parsed = expenseFormSchema.safeParse(input);
  const id = expenseId === null ? null : idSchema.safeParse(expenseId);
  if (!parsed.success || (id && !id.success)) return invalidInput();
  const v = parsed.data;
  const amounts = expenseAmountsFromInput(v);
  if (!amounts) return invalidInput();

  const orgId = ctx.org.id;
  const supabase = await createClient();
  const vendor = await resolveVendor(supabase, orgId, v);
  if ("failure" in vendor) return vendor.failure;

  const row = {
    issuer_id: v.issuer_id,
    vendor_id: vendor.id,
    category_id: v.category_id,
    description: v.description,
    vendor_invoice_number: emptyToNull(v.vendor_invoice_number),
    issued_on: v.issued_on,
    due_on: v.due_on || null,
    base_cents: amounts.baseCents,
    vat_bps: percentToBps(v.vat),
    vat_cents: amounts.vatCents,
    vat_deductible: v.vat_deductible,
    irpf_bps: percentToBps(v.irpf),
    irpf_cents: amounts.irpfCents,
    total_cents: amounts.totalCents,
    paid_on: v.paid ? v.paid_on || null : null,
    payment_method: v.payment_method || (v.paid ? "transfer" : null),
    member_id: v.member_id || null,
    notes: emptyToNull(v.notes),
    // A quién sirve. Si ya se repercutió, la base de datos no deja cambiarlo (expense_rebilled).
    ...assignmentColumns(v),
  } satisfies Partial<TablesInsert<"expenses">>;

  if (id) {
    const before = await supabase.from("expenses").select("client_id").eq("id", id.data).eq("org_id", orgId).maybeSingle();
    if (before.error) return financeFailure(before.error, "saveExpense.load");
    if (!before.data) return failure("finance.errors.expenseNotFound");
    const { data, error } = await supabase.from("expenses").update(row).eq("id", id.data).eq("org_id", orgId).select("id");
    if (error) return financeFailure(error, "saveExpense.update");
    if (data.length === 0) return failure("finance.errors.expenseNotFound");
    revalidateFinance(ctx.org.slug);
    revalidateClients(ctx.org.slug, [before.data.client_id, row.client_id]);
    return { ok: true, id: id.data };
  }
  const { data, error } = await supabase
    .from("expenses")
    .insert({ ...row, org_id: orgId, source: "manual" })
    .select("id")
    .single();
  if (error) return financeFailure(error, "saveExpense.insert");
  revalidateFinance(ctx.org.slug);
  revalidateClients(ctx.org.slug, [row.client_id]);
  return { ok: true, id: data.id };
}

/** Marca un gasto como pagado (con fecha y método) o, con `null`, vuelve a dejarlo pendiente. */
export async function setExpensePaid(slug: string, expenseId: string, input: PaymentFormInput | null): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(expenseId);
  const payment = input === null ? null : paymentFormSchema.safeParse(input);
  if (!id.success || (payment && !payment.success)) return invalidInput();
  const supabase = await createClient();
  const patch = payment?.success ? { paid_on: payment.data.paid_on, payment_method: payment.data.payment_method } : { paid_on: null };
  const { data, error } = await supabase.from("expenses").update(patch).eq("id", id.data).eq("org_id", ctx.org.id).select("id");
  if (error) return financeFailure(error, "setExpensePaid");
  if (data.length === 0) return failure("finance.errors.expenseNotFound");
  revalidateFinance(ctx.org.slug);
  return { ok: true };
}

/** Borra un gasto y su justificante. Lo que una suscripción activa volvería a generar no se borra (trigger). */
export async function deleteExpense(slug: string, expenseId: string): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(expenseId);
  if (!id.success) return invalidInput();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("expenses")
    .delete()
    .eq("id", id.data)
    .eq("org_id", ctx.org.id)
    .select("id, attachment_path, client_id");
  if (error) return financeFailure(error, "deleteExpense");
  if (data.length === 0) return failure("finance.errors.expenseNotFound");
  const paths = data.flatMap((row) => (row.attachment_path ? [row.attachment_path] : []));
  if (paths.length) await removeAttachments(createAdminClient(), paths);
  revalidateFinance(ctx.org.slug);
  revalidateClients(ctx.org.slug, data.map((row) => row.client_id));
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Proveedores
// ---------------------------------------------------------------------------

/** Crea o corrige un proveedor (nombre, NIF, país y la categoría que se propone en sus gastos). */
export async function saveVendor(slug: string, vendorId: string | null, input: VendorFormInput): Promise<ActionResult<{ id: string }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const parsed = vendorFormSchema.safeParse(input);
  const id = vendorId === null ? null : idSchema.safeParse(vendorId);
  if (!parsed.success || (id && !id.success)) return invalidInput();
  const row = {
    name: parsed.data.name,
    tax_id: emptyToNull(parsed.data.tax_id),
    country_code: parsed.data.country_code,
    default_category_id: parsed.data.default_category_id || null,
  };
  const supabase = await createClient();
  if (id) {
    const { data, error } = await supabase.from("vendors").update(row).eq("id", id.data).eq("org_id", ctx.org.id).select("id");
    if (error) return financeFailure(error, "saveVendor.update");
    if (data.length === 0) return failure("finance.errors.vendorNotFound");
    revalidateFinance(ctx.org.slug);
    revalidatePath(`/${ctx.org.slug}/settings/expenses`);
    return { ok: true, id: id.data };
  }
  const { data, error } = await supabase.from("vendors").insert({ ...row, org_id: ctx.org.id }).select("id").single();
  if (error) return financeFailure(error, "saveVendor.insert");
  revalidateFinance(ctx.org.slug);
  revalidatePath(`/${ctx.org.slug}/settings/expenses`);
  return { ok: true, id: data.id };
}

/** Archiva un proveedor (sus gastos lo conservan; ya no se propone) o lo recupera. */
export async function setVendorArchived(slug: string, vendorId: string, archived: boolean): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(vendorId);
  if (!id.success || typeof archived !== "boolean") return invalidInput();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vendors")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", id.data)
    .eq("org_id", ctx.org.id)
    .select("id");
  if (error) return financeFailure(error, "setVendorArchived");
  if (data.length === 0) return failure("finance.errors.vendorNotFound");
  revalidateFinance(ctx.org.slug);
  revalidatePath(`/${ctx.org.slug}/settings/expenses`);
  return { ok: true };
}

const partnerMovementSchema = z.object({
  member_id: z.guid(),
  kind: z.enum(["capital_contribution", "shareholder_funds_contribution", "partner_loan", "loan_repayment", "expense_reimbursement", "dividend"]),
  amount_cents: z.number().int().positive(),
  effective_on: z.iso.date(),
  reference: z.string().trim().max(200),
  notes: z.string().trim().max(2000),
});

/** Registro interno propuesto; no contabiliza ni liquida impuestos. */
export async function createPartnerMovement(slug: string, input: z.input<typeof partnerMovementSchema>): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const parsed = partnerMovementSchema.safeParse(input);
  if (!parsed.success) return invalidInput();
  const supabase = await createClient();
  const { error } = await supabase.from("partner_movements").insert({
    org_id: ctx.org.id,
    member_id: parsed.data.member_id,
    kind: parsed.data.kind,
    amount_cents: parsed.data.amount_cents,
    effective_on: parsed.data.effective_on,
    reference: parsed.data.reference || null,
    notes: parsed.data.notes || null,
    status: "proposed",
  });
  if (error) return financeFailure(error, "createPartnerMovement");
  revalidateFinance(ctx.org.slug);
  return { ok: true };
}

export async function updatePartnerMovementStatus(slug: string, movementId: string, status: "approved" | "paid" | "void"): Promise<ActionResult> {
  const ctx = await ownerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(movementId);
  if (!id.success || !["approved", "paid", "void"].includes(status)) return invalidInput();
  const supabase = await createClient();
  const { data, error } = await supabase.from("partner_movements").update({ status }).eq("org_id", ctx.org.id).eq("id", id.data).select("id");
  if (error) return financeFailure(error, "updatePartnerMovementStatus");
  if (data.length === 0) return failure("finance.errors.notFound");
  revalidateFinance(ctx.org.slug);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Suscripciones
// ---------------------------------------------------------------------------

/** Genera con la sesión del socio los cargos que falten hasta hoy (el cron lo hace cada día). */
async function generateNowFor(ctx: OrgContext, supabase: Supabase): Promise<number> {
  try {
    return (await generateSubscriptionExpenses(supabase, ctx.org.id, today(ctx))).created;
  } catch (error) {
    // No bloquea lo que ya se ha guardado: el cron lo completará mañana.
    console.error("[finance] generateSubscriptionExpenses", error instanceof DbError ? error.error : error);
    return 0;
  }
}

/** Crea o actualiza una suscripción y genera los cargos que ya tocaban. */
export async function saveSubscription(
  slug: string,
  subscriptionId: string | null,
  input: SubscriptionFormInput,
): Promise<ActionResult<{ id: string; generated: number }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const parsed = subscriptionFormSchema.safeParse(input);
  const id = subscriptionId === null ? null : idSchema.safeParse(subscriptionId);
  if (!parsed.success || (id && !id.success)) return invalidInput();
  const v = parsed.data;

  const orgId = ctx.org.id;
  const supabase = await createClient();
  const vendor = await resolveVendor(supabase, orgId, v);
  if ("failure" in vendor) return vendor.failure;

  const row = {
    issuer_id: v.issuer_id,
    vendor_id: vendor.id,
    category_id: v.category_id,
    member_id: v.member_id || null,
    description: v.description,
    base_cents: moneyToCents(v.base),
    vat_bps: percentToBps(v.vat),
    vat_deductible: v.vat_deductible,
    irpf_bps: percentToBps(v.irpf),
    billing_interval: v.interval,
    starts_on: v.starts_on,
    ends_on: v.ends_on || null,
    billing_day: v.interval === "monthly" ? Number(v.billing_day) : null,
    payment_method: v.payment_method,
    is_active: v.is_active,
    notes: emptyToNull(v.notes),
    // A quién sirve: pasa a los gastos que se generen a partir de ahora.
    ...assignmentColumns(v),
  } satisfies Partial<TablesInsert<"expense_subscriptions">>;

  let savedId: string;
  if (id) {
    const { data, error } = await supabase.from("expense_subscriptions").update(row).eq("id", id.data).eq("org_id", orgId).select("id");
    if (error) return financeFailure(error, "saveSubscription.update");
    if (data.length === 0) return failure("finance.errors.subscriptionNotFound");
    savedId = id.data;
  } else {
    const { data, error } = await supabase.from("expense_subscriptions").insert({ ...row, org_id: orgId }).select("id").single();
    if (error) return financeFailure(error, "saveSubscription.insert");
    savedId = data.id;
  }
  const generated = await generateNowFor(ctx, supabase);
  revalidateFinance(ctx.org.slug);
  revalidateClients(ctx.org.slug, [row.client_id]);
  return { ok: true, id: savedId, generated };
}

/** Enciende o apaga una suscripción. Al encenderla se generan los cargos que falten. */
export async function setSubscriptionActive(slug: string, subscriptionId: string, active: boolean): Promise<ActionResult<{ generated: number }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(subscriptionId);
  if (!id.success || typeof active !== "boolean") return invalidInput();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("expense_subscriptions")
    .update({ is_active: active })
    .eq("id", id.data)
    .eq("org_id", ctx.org.id)
    .select("id");
  if (error) return financeFailure(error, "setSubscriptionActive");
  if (data.length === 0) return failure("finance.errors.subscriptionNotFound");
  const generated = active ? await generateNowFor(ctx, supabase) : 0;
  revalidateFinance(ctx.org.slug);
  return { ok: true, generated };
}

/** Borra una suscripción; con `withExpenses`, también sus gastos generados (y sus justificantes). */
export async function deleteSubscription(slug: string, subscriptionId: string, withExpenses: boolean): Promise<ActionResult<{ deleted: number }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(subscriptionId);
  if (!id.success || typeof withExpenses !== "boolean") return invalidInput();
  const supabase = await createClient();
  const attachments = withExpenses
    ? await supabase.from("expenses").select("attachment_path").eq("org_id", ctx.org.id).eq("subscription_id", id.data).not("attachment_path", "is", null)
    : null;
  if (attachments?.error) return financeFailure(attachments.error, "deleteSubscription.attachments");
  const { data, error } = await supabase.rpc("delete_expense_subscription", { p_id: id.data, p_with_expenses: withExpenses });
  if (error) return financeFailure(error, "deleteSubscription");
  const paths = (attachments?.data ?? []).flatMap((row) => (row.attachment_path ? [row.attachment_path] : []));
  if (paths.length) await removeAttachments(createAdminClient(), paths);
  revalidateFinance(ctx.org.slug);
  return { ok: true, deleted: data };
}

/** «Generar ahora»: los cargos de todas las suscripciones que tocaban hasta hoy y faltan. */
export async function generateSubscriptionsNow(slug: string): Promise<ActionResult<{ created: number }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const supabase = await createClient();
  try {
    const result = await generateSubscriptionExpenses(supabase, ctx.org.id, today(ctx));
    revalidateFinance(ctx.org.slug);
    return { ok: true, created: result.created };
  } catch (error) {
    if (error instanceof DbError) return financeFailure(error.error, error.where);
    console.error("[finance] generateSubscriptionsNow", error);
    return failure("common.errorGeneric");
  }
}

// ---------------------------------------------------------------------------
// Repercutir gastos a los clientes
// ---------------------------------------------------------------------------

// Cada id va en la URL de PostgREST: una selección, no toda la lista.
const rebillIdsSchema = z.array(z.guid()).min(1).max(100).nullable();

/**
 * «Añadir a factura»: los gastos del cliente pendientes de repercutir (o solo `expenseIds`, si
 * siguen pendientes) a su borrador abierto más reciente o a uno nuevo, con una línea por gasto.
 * Se puede repetir sin miedo: lo que ya tiene línea nunca se vuelve a repercutir.
 */
export async function addRebillsToInvoice(
  slug: string,
  clientId: string,
  expenseIds: string[] | null = null,
): Promise<ActionResult<RebillResult>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const client = idSchema.safeParse(clientId);
  const ids = rebillIdsSchema.safeParse(expenseIds);
  if (!client.success || !ids.success) return invalidInput();
  const supabase = await createClient();
  try {
    const result = await rebillClientExpenses(supabase, ctx.org, client.data, { expenseIds: ids.data, today: today(ctx) });
    revalidateFinance(ctx.org.slug);
    revalidatePath(`/${ctx.org.slug}/invoices`);
    revalidatePath(`/${ctx.org.slug}/invoices/${result.invoiceId}`);
    revalidateClients(ctx.org.slug, [client.data]);
    revalidatePath(`/${ctx.org.slug}`);
    return { ok: true, ...result };
  } catch (error) {
    if (error instanceof BillingRuleError) return failure(error.key);
    // Los errores del borrador (draft_changed…) son de facturación; los de la repercusión, de finanzas.
    if (error instanceof DbError) return billingFailure(error.error, error.where, financeErrorKey);
    console.error("[finance] addRebillsToInvoice", error);
    return failure("common.errorGeneric");
  }
}

// ---------------------------------------------------------------------------
// Caja
// ---------------------------------------------------------------------------

/** Crea o actualiza una cuenta de caja (cerrarla es desactivarla: su histórico se conserva). */
export async function saveCashAccount(slug: string, accountId: string | null, input: CashAccountFormInput): Promise<ActionResult<{ id: string }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const parsed = cashAccountFormSchema.safeParse(input);
  const id = accountId === null ? null : idSchema.safeParse(accountId);
  if (!parsed.success || (id && !id.success)) return invalidInput();
  const row = {
    issuer_id: parsed.data.issuer_id,
    name: parsed.data.name,
    iban: emptyToNull(parsed.data.iban),
    is_active: parsed.data.is_active,
  };
  const supabase = await createClient();
  if (id) {
    const { data, error } = await supabase.from("cash_accounts").update(row).eq("id", id.data).eq("org_id", ctx.org.id).select("id");
    if (error) return financeFailure(error, "saveCashAccount.update");
    if (data.length === 0) return failure("finance.errors.accountNotFound");
    revalidateFinance(ctx.org.slug);
    return { ok: true, id: id.data };
  }
  const { data, error } = await supabase.from("cash_accounts").insert({ ...row, org_id: ctx.org.id }).select("id").single();
  if (error) return financeFailure(error, "saveCashAccount.insert");
  revalidateFinance(ctx.org.slug);
  return { ok: true, id: data.id };
}

/** Apunta el saldo de una cuenta en un día (si ya había uno ese día, lo sustituye). */
export async function saveCashBalance(slug: string, input: CashBalanceFormInput): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const parsed = cashBalanceFormSchema.safeParse(input);
  if (!parsed.success) return invalidInput();
  if (parsed.data.balance_on > today(ctx)) return failure("finance.errors.balanceFuture");
  const supabase = await createClient();
  const { error } = await supabase.from("cash_balances").upsert(
    {
      org_id: ctx.org.id,
      account_id: parsed.data.account_id,
      balance_on: parsed.data.balance_on,
      balance_cents: moneyToCents(parsed.data.balance),
      note: emptyToNull(parsed.data.note),
      source: "manual",
    },
    { onConflict: "account_id,balance_on" },
  );
  if (error) return financeFailure(error, "saveCashBalance");
  revalidateFinance(ctx.org.slug);
  return { ok: true };
}

export async function deleteCashBalance(slug: string, balanceId: string): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(balanceId);
  if (!id.success) return invalidInput();
  const supabase = await createClient();
  const { data, error } = await supabase.from("cash_balances").delete().eq("id", id.data).eq("org_id", ctx.org.id).select("id");
  if (error) return financeFailure(error, "deleteCashBalance");
  if (data.length === 0) return failure("finance.errors.balanceNotFound");
  revalidateFinance(ctx.org.slug);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Participaciones (owners)
// ---------------------------------------------------------------------------

const dateSchema = z.iso.date();

/** Guarda el reparto de una fecha (100 %). Con `previousValidFrom`, lo mueve desde esa otra fecha. */
export async function saveShareholdings(
  slug: string,
  input: ShareholdingsFormInput,
  previousValidFrom: string | null,
): Promise<ActionResult> {
  const ctx = await ownerContext(slug);
  if (!ctx) return forbidden();
  const parsed = shareholdingsFormSchema.safeParse(input);
  const previous = previousValidFrom === null ? null : dateSchema.safeParse(previousValidFrom);
  if (!parsed.success || (previous && !previous.success)) return invalidInput();
  const supabase = await createClient();
  const rows = parsed.data.rows.map((r) => ({ member_id: r.member_id, percent_bps: percentToBps(r.percent) }));
  const { error } = await supabase.rpc("save_shareholdings", {
    p_org: ctx.org.id,
    p_valid_from: parsed.data.valid_from,
    p: rows as unknown as Json,
    p_previous_valid_from: previous?.success ? previous.data : undefined,
  });
  if (error) return financeFailure(error, "saveShareholdings");
  revalidateFinance(ctx.org.slug);
  return { ok: true };
}

/** Borra el reparto de una fecha entera. */
export async function deleteShareholdings(slug: string, validFrom: string): Promise<ActionResult> {
  const ctx = await ownerContext(slug);
  if (!ctx) return forbidden();
  const on = dateSchema.safeParse(validFrom);
  if (!on.success) return invalidInput();
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_shareholdings", { p_org: ctx.org.id, p_valid_from: on.data, p: [] as unknown as Json });
  if (error) return financeFailure(error, "deleteShareholdings");
  revalidateFinance(ctx.org.slug);
  return { ok: true };
}
