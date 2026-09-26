import "server-only";
import type { PostgrestError } from "@supabase/supabase-js";
import { type Failure, failure } from "@/server/action-utils";
import { billingFailure } from "@/server/billing/errors";

/**
 * Hints que lanzan las RPC y los triggers de presupuestos (supabase/migrations/…_presupuestos.sql).
 * Cada uno tiene su mensaje en quotes.errors.<camelCase>; los de facturación (IVA, líneas…)
 * siguen saliendo de billing.errors.
 */
const QUOTE_HINTS = [
  "quote_frozen",
  "quote_not_editable",
  "quote_changed",
  "quote_not_draft",
  "quote_number_fixed",
  "quote_status_invalid",
  "quote_no_lines",
  "quote_future_date",
  "quote_validity_past",
  "quote_already_accepted",
  "quote_line_dates",
  "quote_not_sent",
  "payment_plan_invalid",
  "payment_plan_required",
  "payment_plan_total",
  "payment_plan_order",
  "line_id_required",
] as const;

const known = new Set<string>(QUOTE_HINTS);
const camel = (hint: string) => hint.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/** Clave de i18n de un error esperado de presupuestos, o undefined. */
export function quoteErrorKey(error: Pick<PostgrestError, "hint" | "code">): string | undefined {
  if (error.hint && known.has(error.hint)) return `quotes.errors.${camel(error.hint)}`;
  // Una FK compuesta: el deal no es de ese cliente, o algo no es de la org.
  if (error.code === "23503") return "quotes.errors.reference";
  return undefined;
}

/** Error listo para el toast: los de presupuestos, luego los de facturación y, si no, genérico. */
export async function quoteFailure(error: PostgrestError, where: string): Promise<Failure> {
  const key = quoteErrorKey(error);
  if (key) return failure(key);
  return billingFailure(error, where);
}
