import "server-only";
import type { PostgrestError } from "@supabase/supabase-js";
import { type Failure, failure } from "@/server/action-utils";
import { billingFailure } from "@/server/billing/errors";

/**
 * Hints que lanzan los triggers y las RPC del catálogo (supabase/migrations/…_catalogo.sql). Cada
 * uno tiene su mensaje en catalog.errors.<camelCase>. El de un IVA que no es IVA (vat_rate_required)
 * es el de facturación y sale de billing.errors.
 */
const CATALOG_HINTS = ["vat_rate_archived", "bundle_items_invalid", "bundle_item_repeated", "bundle_not_found", "catalog_org_fixed"] as const;

const known = new Set<string>(CATALOG_HINTS);
const camel = (hint: string) => hint.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/** Clave de i18n de un error esperado del catálogo, o undefined. */
export function catalogErrorKey(error: Pick<PostgrestError, "hint" | "code" | "message">): string | undefined {
  if (error.hint && known.has(error.hint)) return `catalog.errors.${camel(error.hint)}`;
  // Índice único parcial: ya hay un servicio (o un pack) activo que se llama así.
  if (error.code === "23505") return "catalog.errors.nameTaken";
  // FK compuesta: el IVA o un servicio no es de la org (o ya no existe).
  if (error.code === "23503") return "catalog.errors.reference";
  // Un check de textos o traducciones (el formulario ya los valida: no debería llegar).
  if (error.code === "23514") return error.message.includes("translations") ? "catalog.errors.translationsInvalid" : "catalog.errors.invalid";
  return undefined;
}

/** Error listo para el toast: los del catálogo, luego los de facturación y, si no, genérico. */
export async function catalogFailure(error: PostgrestError, where: string): Promise<Failure> {
  const key = catalogErrorKey(error);
  if (key) return failure(key);
  return billingFailure(error, where);
}
