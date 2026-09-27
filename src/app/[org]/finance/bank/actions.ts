"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { expenseAmountsFromInput, type ExpenseFormInput, expenseFormSchema, percentToBps } from "@/app/[org]/finance/schema";
import type { BankTargetOption } from "@/components/banking/types";
import { type Allocation, learnRule, methodOf, type RuleDraft } from "@/domain/banking/matcher";
import type { ActionResult } from "@/lib/action-result";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { emptyToNull } from "@/lib/validation/fiscal";
import { failure, forbidden, idSchema, invalidInput, partnerContext } from "@/server/action-utils";
import { bankingFailure } from "@/server/banking/errors";
import { searchBankTargets as searchTargets } from "@/server/banking/queries";
import {
  applyAllocations,
  confirmAllHigh,
  confirmSuggestion,
  createExpenseFromMovement,
  deleteStatement,
  ignoreMovement,
  type ServiceResult,
  type Touched,
  undoMatch,
  unignoreMovement,
} from "@/server/banking/service";
import { loadPendingTransactions } from "@/server/banking/sources";
import { DbError } from "@/server/billing/context";
import { removeAttachments } from "@/server/finance/attachments";
import { allocationsSchema, type AllocationInput, ignoreSchema, type IgnoreInput } from "./schema";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Vuelve a pintar lo que cambia al conciliar: Finanzas entera (banco, caja, gastos, resumen), el
 * dashboard y, si se ha cobrado algo, las facturas, las remesas y las fichas de cliente.
 */
function revalidateBank(slug: string, touched?: Touched) {
  revalidatePath(`/${slug}/finance`, "layout");
  revalidatePath(`/${slug}`);
  if (!touched) return;
  if (touched.invoiceIds.length > 0 || touched.remittanceIds.length > 0) {
    revalidatePath(`/${slug}/invoices`, "layout");
    revalidatePath(`/${slug}/clients`, "layout");
  }
}

function fail(result: Extract<ServiceResult, { ok: false }>, where: string) {
  const error = result.error as Partial<PostgrestError> & { hint: string; message: string };
  return bankingFailure(
    { code: error.code ?? "", details: error.details ?? "", name: "PostgrestError", hint: error.hint, message: error.message } as PostgrestError,
    where,
  );
}

/** Confirma una propuesta (la clave es la de la propuesta que ve el socio; se recalcula antes de aplicarla). */
export async function confirmBankSuggestion(
  slug: string,
  transactionId: string,
  key: string,
): Promise<ActionResult<{ matchIds: string[]; kind: string }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(transactionId);
  if (!id.success || typeof key !== "string" || key.length > 400) return invalidInput();
  const supabase = await createClient();
  try {
    const result = await confirmSuggestion(supabase, ctx.org.id, id.data, key);
    if (!result.ok) return fail(result, "confirmBankSuggestion");
    revalidateBank(ctx.org.slug, result.touched);
    return { ok: true, matchIds: result.matchIds, kind: result.kind };
  } catch (error) {
    if (error instanceof DbError) return bankingFailure(error.error, error.where);
    console.error("[banking] confirmBankSuggestion", error);
    return failure("common.errorGeneric");
  }
}

/** Confirma de una vez todas las propuestas de confianza alta de una cuenta. */
export async function confirmAllBankSuggestions(
  slug: string,
  accountId: string,
): Promise<ActionResult<{ applied: number; failed: number; matchIds: string[]; ignoredIds: string[] }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(accountId);
  if (!id.success) return invalidInput();
  const supabase = await createClient();
  try {
    const result = await confirmAllHigh(supabase, ctx.org.id, id.data);
    revalidateBank(ctx.org.slug, result.touched);
    return { ok: true, applied: result.applied, failed: result.failed, matchIds: result.matchIds, ignoredIds: result.ignoredIds };
  } catch (error) {
    if (error instanceof DbError) return bankingFailure(error.error, error.where);
    console.error("[banking] confirmAllBankSuggestions", error);
    return failure("common.errorGeneric");
  }
}

/** La regla que se aprende con un reparto manual: si todo va a un mismo cliente, o a un gasto con su categoría. */
async function ruleForAllocations(
  supabase: Supabase,
  tx: { amountCents: number; counterparty: string | null; concept: string },
  allocations: readonly Allocation[],
): Promise<RuleDraft | null> {
  const invoiceIds = allocations.filter((a) => a.kind === "invoice").map((a) => a.id);
  const expenseIds = allocations.filter((a) => a.kind === "expense").map((a) => a.id);
  if (invoiceIds.length === allocations.length) {
    const { data } = await supabase.from("invoices").select("client_id").in("id", invoiceIds);
    const clients = [...new Set((data ?? []).map((i) => i.client_id))];
    return clients.length === 1 ? learnRule(tx, { clientId: clients[0]! }) : null;
  }
  if (expenseIds.length === 1 && allocations.length === 1) {
    const { data } = await supabase.from("expenses").select("vendor_id, category_id").eq("id", expenseIds[0]!).maybeSingle();
    return data ? learnRule(tx, { vendorId: data.vendor_id, categoryId: data.category_id }) : null;
  }
  return null;
}

/** Concilia a mano: uno o varios repartos (varias facturas, un gasto, una remesa…) de un movimiento. */
export async function applyBankAllocations(
  slug: string,
  transactionId: string,
  input: AllocationInput[],
  learn: boolean,
): Promise<ActionResult<{ matchIds: string[] }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(transactionId);
  const parsed = allocationsSchema.safeParse(input);
  if (!id.success || !parsed.success || typeof learn !== "boolean") return invalidInput();
  const supabase = await createClient();
  try {
    const [tx] = await loadPendingTransactions(supabase, ctx.org.id, { ids: [id.data] });
    if (!tx) return failure("banking.errors.bankSuggestionStale");
    const allocations: Allocation[] = parsed.data;
    const rule = learn ? await ruleForAllocations(supabase, tx, allocations) : null;
    const result = await applyAllocations(supabase, { transactionId: tx.id, allocations, method: methodOf(tx), rule });
    if (!result.ok) return fail(result, "applyBankAllocations");
    revalidateBank(ctx.org.slug, result.touched);
    return { ok: true, matchIds: result.matchIds };
  } catch (error) {
    if (error instanceof DbError) return bankingFailure(error.error, error.where);
    console.error("[banking] applyBankAllocations", error);
    return failure("common.errorGeneric");
  }
}

/** Busca a mano qué puede explicar un movimiento (facturas, cobros, gastos, remesas). */
export async function searchBankTargets(slug: string, transactionId: string, query: string): Promise<ActionResult<{ options: BankTargetOption[] }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(transactionId);
  if (!id.success || typeof query !== "string") return invalidInput();
  const supabase = await createClient();
  try {
    const [tx] = await loadPendingTransactions(supabase, ctx.org.id, { ids: [id.data] });
    if (!tx) return failure("banking.errors.bankSuggestionStale");
    return { ok: true, options: await searchTargets(supabase, ctx.org.id, tx, query.slice(0, 80)) };
  } catch (error) {
    if (error instanceof DbError) return bankingFailure(error.error, error.where);
    console.error("[banking] searchBankTargets", error);
    return failure("common.errorGeneric");
  }
}

/**
 * Crea un gasto desde un movimiento, con la misma validación y los mismos importes que Finanzas
 * (expenseFormSchema y el redondeo del dominio). Queda pagado con la fecha del movimiento y enlazado.
 */
export async function createBankExpense(
  slug: string,
  transactionId: string,
  input: ExpenseFormInput,
  learn: boolean,
): Promise<ActionResult<{ expenseId: string; matchId: string }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(transactionId);
  const parsed = expenseFormSchema.safeParse(input);
  if (!id.success || !parsed.success || typeof learn !== "boolean") return invalidInput();
  const v = parsed.data;
  const amounts = expenseAmountsFromInput(v);
  if (!amounts) return invalidInput();
  const supabase = await createClient();
  try {
    const [tx] = await loadPendingTransactions(supabase, ctx.org.id, { ids: [id.data] });
    if (!tx) return failure("banking.errors.bankSuggestionStale");
    const vendorId = v.vendor_id || null;
    const newVendorName = vendorId ? null : emptyToNull(v.new_vendor_name);
    const rule = learn ? learnRule(tx, { vendorId, categoryId: v.category_id }) : null;
    const result = await createExpenseFromMovement(supabase, {
      transactionId: tx.id,
      expense: {
        issuerId: v.issuer_id,
        vendorId,
        newVendorName,
        categoryId: v.category_id,
        description: v.description,
        vendorInvoiceNumber: emptyToNull(v.vendor_invoice_number),
        issuedOn: v.issued_on,
        dueOn: v.due_on || null,
        baseCents: amounts.baseCents,
        vatBps: percentToBps(v.vat),
        vatCents: amounts.vatCents,
        vatDeductible: v.vat_deductible,
        irpfBps: percentToBps(v.irpf),
        irpfCents: amounts.irpfCents,
        // Un cargo es un gasto (base positiva); un abono del proveedor, un gasto en negativo. La RPC
        // comprueba que el signo cuadra con el movimiento.
        totalCents: amounts.totalCents,
        paymentMethod: v.payment_method || methodOf(tx),
        memberId: v.member_id || null,
        notes: emptyToNull(v.notes),
      },
      // Con un proveedor nuevo, la regla se guarda después (hace falta su id).
      rule: newVendorName ? null : rule,
    });
    if (!result.ok) return fail(result, "createBankExpense");
    if (learn && newVendorName && rule && result.vendorId) {
      const { error } = await supabase.from("bank_rules").upsert(
        {
          org_id: ctx.org.id,
          direction: rule.direction,
          field: rule.field,
          pattern: rule.pattern,
          vendor_id: result.vendorId,
          category_id: rule.categoryId,
          client_id: null,
        },
        { onConflict: "org_id,direction,field,pattern" },
      );
      // La regla es una ayuda: si no se guarda, el gasto ya está creado.
      if (error) console.error("[banking] createBankExpense.rule", error);
    }
    revalidateBank(ctx.org.slug, result.touched);
    return { ok: true, expenseId: result.expenseId, matchId: result.matchId };
  } catch (error) {
    if (error instanceof DbError) return bankingFailure(error.error, error.where);
    console.error("[banking] createBankExpense", error);
    return failure("common.errorGeneric");
  }
}

/** Ignora uno o varios movimientos con un motivo. */
export async function ignoreBankMovements(slug: string, transactionIds: string[], input: IgnoreInput): Promise<ActionResult<{ ignored: number }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const ids = idSchema.array().min(1).max(200).safeParse(transactionIds);
  const parsed = ignoreSchema.safeParse(input);
  if (!ids.success || !parsed.success) return invalidInput();
  const supabase = await createClient();
  let ignored = 0;
  for (const id of ids.data) {
    const result = await ignoreMovement(supabase, id, parsed.data.reason, emptyToNull(parsed.data.note));
    if (!result.ok) {
      if (ignored > 0) revalidateBank(ctx.org.slug);
      return fail(result, "ignoreBankMovements");
    }
    ignored += 1;
  }
  revalidateBank(ctx.org.slug);
  return { ok: true, ignored };
}

/** Vuelve a tener en cuenta uno o varios movimientos ignorados. */
export async function unignoreBankMovements(slug: string, transactionIds: string[]): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const ids = idSchema.array().min(1).max(200).safeParse(transactionIds);
  if (!ids.success) return invalidInput();
  const supabase = await createClient();
  for (const id of ids.data) {
    const result = await unignoreMovement(supabase, id);
    if (!result.ok) return fail(result, "unignoreBankMovements");
  }
  revalidateBank(ctx.org.slug);
  return { ok: true };
}

/**
 * Deshace uno o varios enlaces (el «Deshacer» del toast o del panel). Si la confirmación había creado
 * el cobro o el gasto, se borran; el justificante de un gasto borrado se quita de Storage.
 */
export async function undoBankMatches(slug: string, matchIds: string[]): Promise<ActionResult<{ undone: number; remittanceKept: boolean }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const ids = idSchema.array().min(1).max(200).safeParse(matchIds);
  if (!ids.success) return invalidInput();
  const supabase = await createClient();
  const touched: Touched = { invoiceIds: [], expenseIds: [], remittanceIds: [] };
  const attachments: string[] = [];
  let undone = 0;
  let remittanceKept = false;
  for (const id of ids.data) {
    const result = await undoMatch(supabase, id);
    if (!result.ok) {
      if (undone > 0) revalidateBank(ctx.org.slug, touched);
      return fail(result, "undoBankMatches");
    }
    undone += 1;
    touched.invoiceIds.push(...result.touched.invoiceIds);
    if (result.undo.attachmentPath) attachments.push(result.undo.attachmentPath);
    if (result.undo.remittanceKeptSettled) remittanceKept = true;
  }
  if (attachments.length > 0) await removeAttachments(createAdminClient(), attachments);
  revalidateBank(ctx.org.slug, touched);
  return { ok: true, undone, remittanceKept };
}

/** Borra un extracto sin nada conciliado ni ignorado (y los movimientos que trajo). */
export async function deleteBankStatement(slug: string, statementId: string): Promise<ActionResult<{ deleted: number }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(statementId);
  if (!id.success) return invalidInput();
  const supabase = await createClient();
  const result = await deleteStatement(supabase, id.data);
  if (!result.ok) return fail(result, "deleteBankStatement");
  revalidateBank(ctx.org.slug);
  return { ok: true, deleted: result.deleted };
}

/** Olvida una regla aprendida. */
export async function deleteBankRule(slug: string, ruleId: string): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(ruleId);
  if (!id.success) return invalidInput();
  const supabase = await createClient();
  const { data, error } = await supabase.from("bank_rules").delete().eq("id", id.data).eq("org_id", ctx.org.id).select("id");
  if (error) return bankingFailure(error, "deleteBankRule");
  if (data.length === 0) return failure("banking.errors.ruleNotFound");
  revalidateBank(ctx.org.slug);
  return { ok: true };
}
