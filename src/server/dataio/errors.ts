import "server-only";
import type { PostgrestError } from "@supabase/supabase-js";
import { error, type Issue } from "@/domain/dataio/issues";

/**
 * Hints que lanzan import_historical_invoice (supabase/migrations/…_datos.sql) y los triggers de
 * facturación. La simulación comprueba lo mismo antes, así que al confirmar solo aparecen si algo
 * ha cambiado entretanto; entonces se enseña el mensaje de la propia base de datos, que ya explica
 * el motivo (y con qué factura choca).
 */
const KNOWN_HINTS = new Set([
  "future_date",
  "issuer_inactive",
  "series_invalid",
  "number_format_mismatch",
  "number_taken",
  "series_order_conflict",
  "series_external_numbering",
  "totals_mismatch",
  "rectified_invalid",
  "rectification_reason_required",
  "no_lines",
  "client_not_found",
  "counter_below_used",
  "import_invalid",
  "invoice_immutable",
]);

/** Un error de PostgREST al confirmar, como motivo de la fila. Lo inesperado se registra y sale genérico. */
export function issueFromDbError(err: PostgrestError, where: string): Issue {
  if (err.hint && KNOWN_HINTS.has(err.hint)) return error("db_rejected", { params: { reason: err.message } });
  if (err.code === "23505" && /clients_tax_id_idx/.test(err.message)) return error("client_ambiguous");
  console.error(`[dataio] ${where}`, err);
  return error("db_error");
}
