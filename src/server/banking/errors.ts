import "server-only";
import type { PostgrestError } from "@supabase/supabase-js";
import { dbFailure, type Failure } from "@/server/action-utils";
import { financeErrorKey } from "@/server/finance/errors";

/**
 * Hints que lanzan los triggers y las RPC del banco (supabase/migrations/…_banco.sql). Cada uno tiene
 * su mensaje en banking.errors.<camelCase>. Los de los gastos (categoría archivada, importes) son los
 * de Finanzas, porque el gasto se valida igual.
 */
const KNOWN_HINTS = [
  "bank_account_inactive",
  "bank_statement_invalid",
  "bank_statement_period",
  "bank_statement_duplicate",
  "bank_statement_in_use",
  "bank_transaction_not_found",
  "bank_transaction_ignored",
  "bank_transaction_matched",
  "bank_match_exceeds_movement",
  "bank_match_exceeds_target",
  "bank_match_exceeds_outstanding",
  "bank_match_direction",
  "bank_match_fixed",
  "bank_match_not_found",
  "bank_allocation_invalid",
  "bank_invoice_not_payable",
  "bank_remittance_not_collectible",
  // Los de la remesa que se cobra al confirmar.
  "remittance_not_sent",
  "settle_date_invalid",
  // Los del servidor (src/server/banking/service.ts).
  "bank_needs_form",
  "bank_suggestion_stale",
] as const;

const known = new Set<string>(KNOWN_HINTS);

const camel = (hint: string) => hint.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/** Clave de i18n de un error esperado del banco, o undefined. */
export function bankingErrorKey(error: Pick<PostgrestError, "hint" | "code" | "message" | "details">): string | undefined {
  if (error.hint && known.has(error.hint)) return `banking.errors.${camel(error.hint)}`;
  return financeErrorKey(error);
}

/** Error del banco listo para el cliente: los esperados con su mensaje; el resto, registrado y genérico. */
export function bankingFailure(error: PostgrestError, where: string): Promise<Failure> {
  return dbFailure(error, where, bankingErrorKey);
}
