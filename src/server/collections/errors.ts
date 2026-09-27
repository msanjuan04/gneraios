import "server-only";
import type { PostgrestError } from "@supabase/supabase-js";
import { dbFailure, type Failure, failure } from "@/server/action-utils";
import { billingErrorKey } from "@/server/billing/errors";

/**
 * Hints que lanzan los triggers y las RPC de cobros (supabase/migrations/…_cobros.sql). Cada uno
 * tiene su mensaje en collections.errors.<camelCase>.
 */
const KNOWN_HINTS = [
  "remittance_not_draft",
  "remittance_not_generated",
  "remittance_not_sent",
  "remittance_not_settled",
  "remittance_locked",
  "remittance_changed",
  "remittance_not_found",
  "remittance_status_invalid",
  "remittance_empty",
  "invoice_in_open_remittance",
  "invoice_not_collectible",
  "collection_date_past",
  "settle_date_invalid",
  "return_date_invalid",
  "mandate_in_use",
  "mandate_invalid",
  "creditor_unconfirmed",
] as const;

const known = new Set<string>(KNOWN_HINTS);

// Índices únicos cuyo choque tiene un mensaje propio (PostgREST devuelve su nombre en el mensaje).
const UNIQUE_INDEXES: Record<string, string> = {
  client_mandates_reference_idx: "collections.errors.mandateReferenceTaken",
  client_mandates_active_idx: "collections.errors.mandateActiveExists",
  sepa_creditors_identifier_idx: "collections.errors.creditorIdTaken",
};

const camel = (hint: string) => hint.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/** Clave de i18n de un error esperado de cobros (o de facturación), o undefined. */
export function collectionsErrorKey(error: Pick<PostgrestError, "hint" | "code" | "message">): string | undefined {
  if (error.hint && known.has(error.hint)) return `collections.errors.${camel(error.hint)}`;
  if (error.code === "23505") {
    const index = Object.keys(UNIQUE_INDEXES).find((name) => error.message.includes(name));
    if (index) return UNIQUE_INDEXES[index];
  }
  return billingErrorKey(error);
}

/** Error de cobros listo para el cliente: los esperados con su mensaje; el resto, registrado y genérico. */
export async function collectionsFailure(error: PostgrestError, where: string): Promise<Failure> {
  const key = collectionsErrorKey(error);
  return key ? failure(key) : dbFailure(error, where);
}
