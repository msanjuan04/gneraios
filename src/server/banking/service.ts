// Sin "server-only": lo usa también el seed de la demo (confirma como lo haría un socio). Solo se
// importa desde código de servidor.
//
// Lo que hace un socio con un movimiento: confirmar una propuesta (se vuelve a calcular con el estado
// de ahora y se aplica exactamente esa), confirmar de una vez todas las de confianza alta, repartir a
// mano entre facturas, gastos o remesas, crear un gasto, ignorar y deshacer. Todo pasa por las RPC
// del banco, que son atómicas y vuelven a comprobar los importes.

import type { PostgrestError } from "@supabase/supabase-js";
import {
  type Allocation,
  type BankTx,
  learnRule,
  type RuleDraft,
  type Suggestion,
  suggestAll,
  suggestMatches,
} from "@/domain/banking/matcher";
import type { PaymentMethod } from "@/domain/finance/expense";
import type { Enums, Json } from "@/lib/supabase/database.types";
import { type Db, DbError } from "@/server/billing/context";
import { loadMatchContext, loadPendingTransactions, windowOf } from "./sources";

export type IgnoreReason = Enums<"bank_ignore_reason">;

/** Lo que ha cambiado (para volver a pintar las pantallas afectadas). */
export type Touched = { invoiceIds: string[]; expenseIds: string[]; remittanceIds: string[] };

export type ServiceResult<T extends object = object> = ({ ok: true } & T & { touched: Touched }) | { ok: false; error: PostgrestError | { hint: string; message: string } };

const none = (): Touched => ({ invoiceIds: [], expenseIds: [], remittanceIds: [] });

function touchedBy(allocations: readonly Pick<Allocation, "kind" | "id">[]): Touched {
  const touched = none();
  for (const a of allocations) {
    if (a.kind === "invoice") touched.invoiceIds.push(a.id);
    if (a.kind === "expense") touched.expenseIds.push(a.id);
    if (a.kind === "remittance") touched.remittanceIds.push(a.id);
  }
  return touched;
}

function rulePayload(rule: RuleDraft | null) {
  return rule
    ? { direction: rule.direction, field: rule.field, pattern: rule.pattern, vendor_id: rule.vendorId, category_id: rule.categoryId, client_id: rule.clientId }
    : null;
}

/** Aplica unos repartos a un movimiento (bank_apply: todo o nada). */
export async function applyAllocations(
  db: Db,
  input: { transactionId: string; allocations: readonly Allocation[]; method: PaymentMethod; rule: RuleDraft | null },
): Promise<ServiceResult<{ matchIds: string[] }>> {
  const { data, error } = await db.rpc("bank_apply", {
    p: {
      transaction_id: input.transactionId,
      allocations: input.allocations.map((a) => ({ kind: a.kind, id: a.id, amount_cents: a.amountCents, method: input.method })),
      rule: rulePayload(input.rule),
    } as unknown as Json,
  });
  if (error) return { ok: false, error };
  const result = data as { match_ids: string[] };
  return { ok: true, matchIds: result.match_ids, touched: touchedBy(input.allocations) };
}

/** La regla que se aprende al confirmar una propuesta (con un cliente o con un proveedor y una categoría). */
export function ruleForSuggestion(tx: BankTx, suggestion: Suggestion): RuleDraft | null {
  const s = suggestion.subject;
  if ((suggestion.kind === "invoice" || suggestion.kind === "invoices" || suggestion.kind === "payment") && s.clientId) {
    return learnRule(tx, { clientId: s.clientId });
  }
  if (suggestion.kind === "expense" && s.categoryId) return learnRule(tx, { vendorId: s.vendorId ?? null, categoryId: s.categoryId });
  return null;
}

/** Ignora un movimiento con su motivo (o cambia el motivo). */
export async function ignoreMovement(db: Db, transactionId: string, reason: IgnoreReason, note: string | null): Promise<ServiceResult> {
  const { error } = await db.rpc("bank_ignore", { p_transaction_id: transactionId, p_reason: reason, p_note: note ?? undefined });
  if (error) return { ok: false, error };
  return { ok: true, touched: none() };
}

export async function unignoreMovement(db: Db, transactionId: string): Promise<ServiceResult> {
  const { error } = await db.rpc("bank_unignore", { p_transaction_id: transactionId });
  if (error) return { ok: false, error };
  return { ok: true, touched: none() };
}

/** Aplica una propuesta ya calculada (los repartos o el ignorar), aprendiendo la regla si toca. */
async function applySuggestion(db: Db, tx: BankTx, suggestion: Suggestion): Promise<ServiceResult<{ matchIds: string[] }>> {
  if (suggestion.kind === "ignore") {
    const result = await ignoreMovement(db, tx.id, suggestion.ignoreReason ?? "other", null);
    return result.ok ? { ...result, matchIds: [] } : result;
  }
  if (suggestion.kind === "new_expense" || suggestion.allocations.length === 0) {
    return { ok: false, error: { hint: "bank_needs_form", message: "Hay que revisar el gasto antes de crearlo" } };
  }
  return applyAllocations(db, {
    transactionId: tx.id,
    allocations: suggestion.allocations,
    method: suggestion.method,
    rule: ruleForSuggestion(tx, suggestion),
  });
}

/**
 * Confirma una propuesta de un movimiento: se vuelve a calcular con el estado de ahora y se aplica
 * la que tiene esa clave. Si ya no está (alguien ha cobrado esa factura, se ha importado otro
 * extracto…), no se aplica nada.
 */
export async function confirmSuggestion(db: Db, orgId: string, transactionId: string, key: string): Promise<ServiceResult<{ matchIds: string[]; kind: Suggestion["kind"] }>> {
  const [tx] = await loadPendingTransactions(db, orgId, { ids: [transactionId] });
  if (!tx) return { ok: false, error: { hint: "bank_suggestion_stale", message: "El movimiento ya no está pendiente" } };
  const context = await loadMatchContext(db, orgId, windowOf([tx])!);
  const suggestion = suggestMatches(tx, context).find((s) => s.key === key);
  if (!suggestion) return { ok: false, error: { hint: "bank_suggestion_stale", message: "La propuesta ya no es válida" } };
  const result = await applySuggestion(db, tx, suggestion);
  return result.ok ? { ...result, kind: suggestion.kind } : result;
}

export type BulkResult = { applied: number; failed: number; matchIds: string[]; ignoredIds: string[]; touched: Touched };

/**
 * Confirma de una vez las propuestas de confianza alta de una cuenta (las que, con todos los
 * movimientos a la vez, no compiten con otra). Cada una va en su propia transacción: si una falla
 * (algo ha cambiado), las demás siguen.
 */
export async function confirmAllHigh(db: Db, orgId: string, accountId: string): Promise<BulkResult> {
  const result: BulkResult = { applied: 0, failed: 0, matchIds: [], ignoredIds: [], touched: none() };
  const pending = await loadPendingTransactions(db, orgId, { accountId });
  const window = windowOf(pending);
  if (!window) return result;
  const context = await loadMatchContext(db, orgId, window);
  const suggestions = suggestAll(pending, context);
  // Del movimiento más antiguo al más reciente, como se concilia a mano.
  for (const tx of [...pending].sort((a, b) => a.bookedOn.localeCompare(b.bookedOn) || a.id.localeCompare(b.id))) {
    const best = suggestions.get(tx.id)?.[0];
    if (!best || best.confidence !== "alta" || best.kind === "new_expense") continue;
    const applied = await applySuggestion(db, tx, best);
    if (!applied.ok) {
      result.failed += 1;
      continue;
    }
    result.applied += 1;
    result.matchIds.push(...applied.matchIds);
    if (best.kind === "ignore") result.ignoredIds.push(tx.id);
    result.touched.invoiceIds.push(...applied.touched.invoiceIds);
    result.touched.expenseIds.push(...applied.touched.expenseIds);
    result.touched.remittanceIds.push(...applied.touched.remittanceIds);
  }
  return result;
}

/** Fila del gasto que se crea desde un movimiento (importes ya calculados con el dominio de Finanzas). */
export type BankExpenseRow = {
  issuerId: string;
  vendorId: string | null;
  newVendorName: string | null;
  categoryId: string;
  description: string;
  vendorInvoiceNumber: string | null;
  issuedOn: string;
  dueOn: string | null;
  baseCents: number;
  vatBps: number;
  vatCents: number;
  vatDeductible: boolean;
  irpfBps: number;
  irpfCents: number;
  totalCents: number;
  paymentMethod: PaymentMethod;
  memberId: string | null;
  notes: string | null;
};

/** Crea un gasto pagado con la fecha del movimiento y lo enlaza (bank_create_expense: todo o nada). */
export async function createExpenseFromMovement(
  db: Db,
  input: { transactionId: string; expense: BankExpenseRow; rule: RuleDraft | null },
): Promise<ServiceResult<{ expenseId: string; matchId: string; vendorId: string | null }>> {
  const e = input.expense;
  const { data, error } = await db.rpc("bank_create_expense", {
    p: {
      transaction_id: input.transactionId,
      expense: {
        issuer_id: e.issuerId,
        vendor_id: e.vendorId,
        new_vendor_name: e.newVendorName,
        category_id: e.categoryId,
        description: e.description,
        vendor_invoice_number: e.vendorInvoiceNumber,
        issued_on: e.issuedOn,
        due_on: e.dueOn,
        base_cents: e.baseCents,
        vat_bps: e.vatBps,
        vat_cents: e.vatCents,
        vat_deductible: e.vatDeductible,
        irpf_bps: e.irpfBps,
        irpf_cents: e.irpfCents,
        total_cents: e.totalCents,
        payment_method: e.paymentMethod,
        member_id: e.memberId,
        notes: e.notes,
      },
      rule: rulePayload(input.rule),
    } as unknown as Json,
  });
  if (error) return { ok: false, error };
  const r = data as { expense_id: string; match_id: string; vendor_id: string | null };
  return { ok: true, expenseId: r.expense_id, matchId: r.match_id, vendorId: r.vendor_id, touched: { ...none(), expenseIds: [r.expense_id] } };
}

export type UndoResult = {
  transactionId: string;
  deletedPayment: boolean;
  deletedExpense: boolean;
  expenseUnpaid: boolean;
  remittanceKeptSettled: boolean;
  attachmentPath: string | null;
  invoiceId: string | null;
};

/** Deshace un enlace (y lo que creó la confirmación). */
export async function undoMatch(db: Db, matchId: string): Promise<ServiceResult<{ undo: UndoResult }>> {
  const { data, error } = await db.rpc("bank_undo_match", { p_match_id: matchId });
  if (error) return { ok: false, error };
  const r = data as {
    transaction_id: string;
    deleted_payment: boolean;
    deleted_expense: boolean;
    expense_unpaid: boolean;
    remittance_kept_settled: boolean;
    attachment_path: string | null;
    invoice_id: string | null;
  };
  return {
    ok: true,
    undo: {
      transactionId: r.transaction_id,
      deletedPayment: r.deleted_payment,
      deletedExpense: r.deleted_expense,
      expenseUnpaid: r.expense_unpaid,
      remittanceKeptSettled: r.remittance_kept_settled,
      attachmentPath: r.attachment_path,
      invoiceId: r.invoice_id,
    },
    touched: { ...none(), invoiceIds: r.invoice_id ? [r.invoice_id] : [] },
  };
}

/** Borra un extracto sin decisiones (y los movimientos que trajo). */
export async function deleteStatement(db: Db, statementId: string): Promise<ServiceResult<{ deleted: number }>> {
  const { data, error } = await db.rpc("bank_delete_statement", { p_statement_id: statementId });
  if (error) return { ok: false, error };
  return { ok: true, deleted: data, touched: none() };
}

/** Lanza si la llamada ha fallado (para el seed y los scripts). */
export function unwrap<T extends object>(result: ServiceResult<T>, where: string): T & { touched: Touched } {
  if (!result.ok) {
    const error = result.error as PostgrestError;
    throw new DbError({ message: error.message, hint: error.hint ?? "", details: error.details ?? "", code: error.code ?? "", name: "PostgrestError" } as PostgrestError, where);
  }
  return result;
}
