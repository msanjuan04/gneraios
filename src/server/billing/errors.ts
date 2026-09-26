import "server-only";
import type { PostgrestError } from "@supabase/supabase-js";
import { getTranslations } from "next-intl/server";
import { dbFailure, type Failure } from "@/server/action-utils";

/**
 * Hints que lanzan los triggers y las RPC de facturación (supabase/migrations/…_facturacion.sql).
 * Cada uno tiene su mensaje en billing.errors.<camelCase>.
 */
const KNOWN_HINTS = [
  "line_billed",
  "milestones_started",
  "milestone_billed",
  "milestones_total",
  "vat_rate_required",
  "pause_recurring_only",
  "version_date_invalid",
  "version_not_recurring",
  "contract_billed",
  "invoice_immutable",
  "invoice_lifecycle",
  "draft_changed",
  "draft_not_found",
  "item_taken",
  "item_invoiced",
  "line_foreign",
  "future_date",
  "issuer_inactive",
  "verifactu_required",
  "fiscal_data_missing",
  "no_lines",
  "totals_mismatch",
  "rectified_invalid",
  "series_invalid",
  "date_before_previous",
  "rectify_invalid",
  "rectification_reason_required",
  "already_rectified",
  "rectifying_series_missing",
  "invoice_not_voided",
  "invoice_not_issuing",
  "payment_not_issued",
  "series_in_use",
  "client_not_found",
  "contract_not_found",
  "line_not_found",
  "draft_party_locked",
] as const;

const known = new Set<string>(KNOWN_HINTS);

const camel = (hint: string) => hint.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/** Clave de i18n de un error esperado de facturación, o undefined. */
export function billingErrorKey(error: Pick<PostgrestError, "hint">): string | undefined {
  return error.hint && known.has(error.hint) ? `billing.errors.${camel(error.hint)}` : undefined;
}

/** "2026-09-26" → "26/09/2026" (para los mensajes). */
function civilToEs(value: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (value ?? "");
}

/**
 * Error de facturación listo para el cliente: los esperados con su mensaje (y sus datos, como
 * los campos fiscales que faltan); el resto, registrado y genérico. `fallbackKey` traduce otros
 * errores conocidos del contexto (p. ej. una FK que impide borrar algo ya facturado).
 */
export async function billingFailure(
  error: PostgrestError,
  where: string,
  fallbackKey?: (error: PostgrestError) => string | undefined,
): Promise<Failure> {
  const key = billingErrorKey(error);
  if (!key) return dbFailure(error, where, fallbackKey);
  const t = await getTranslations();
  if (error.hint === "fiscal_data_missing") {
    const fields = (error.details ?? "")
      .split(",")
      .filter(Boolean)
      .map((field) => t(`billing.fiscalFields.${field.replace(".", "_")}`))
      .join(", ");
    return { ok: false, error: t(key, { fields }) };
  }
  if (error.hint === "date_before_previous") {
    return { ok: false, error: t(key, { date: civilToEs(error.details) }) };
  }
  return { ok: false, error: t(key) };
}
