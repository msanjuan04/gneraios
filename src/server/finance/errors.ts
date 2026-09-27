import "server-only";
import type { PostgrestError } from "@supabase/supabase-js";
import { dbFailure, type Failure } from "@/server/action-utils";

/**
 * Hints que lanzan los triggers y las RPC de finanzas (supabase/migrations/…_control.sql y
 * …_repercutir_gastos.sql). Cada uno tiene su mensaje en finance.errors.<camelCase>.
 */
const KNOWN_HINTS = [
  "category_archived",
  "expense_generated",
  "expense_origin_fixed",
  "subscription_schedule_locked",
  "subscription_not_found",
  "shareholdings_total",
  "expense_rebilled",
  "rebill_taken",
  "rebill_empty",
  "rebill_draft_invalid",
] as const;

const known = new Set<string>(KNOWN_HINTS);

const camel = (hint: string) => hint.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/** Índices únicos y claves ajenas con su mensaje propio. */
const CONSTRAINT_KEYS: [string, string][] = [
  ["vendors_tax_id_idx", "finance.errors.vendorDuplicateTaxId"],
  ["expense_categories_name_idx", "finance.errors.categoryDuplicate"],
  ["cash_accounts_iban_idx", "finance.errors.ibanDuplicate"],
  ["cash_balances_account_id_balance_on_key", "finance.errors.balanceDuplicate"],
  ["expenses_external_id_idx", "finance.errors.externalIdDuplicate"],
  ["expenses_org_id_subscription_id_fkey", "finance.errors.subscriptionHasExpenses"],
];

/** Clave de i18n de un error esperado de finanzas, o undefined. */
export function financeErrorKey(error: Pick<PostgrestError, "hint" | "code" | "message" | "details">): string | undefined {
  if (error.hint && known.has(error.hint)) return `finance.errors.${camel(error.hint)}`;
  const text = `${error.message ?? ""} ${error.details ?? ""}`;
  for (const [constraint, key] of CONSTRAINT_KEYS) if (text.includes(constraint)) return key;
  if (error.code === "23503") return "finance.errors.reference";
  if (error.code === "23514") return "finance.errors.amountsInvalid";
  return undefined;
}

/** Error de finanzas listo para el cliente: los esperados con su mensaje; el resto, registrado y genérico. */
export function financeFailure(error: PostgrestError, where: string): Promise<Failure> {
  return dbFailure(error, where, financeErrorKey);
}
