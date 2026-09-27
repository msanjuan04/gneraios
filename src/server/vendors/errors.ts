import type { PostgrestError } from "@supabase/supabase-js";

/**
 * Errores esperados de la base de datos al guardar un proveedor (supabase/migrations/…_control.sql
 * y …_proveedores.sql) → claves de i18n (`vendors.errors.*`). Lo que no esté aquí sale como error
 * genérico.
 */
export function knownVendorError(error: Pick<PostgrestError, "code" | "message" | "details">): string | undefined {
  const where = `${error.message ?? ""} ${error.details ?? ""}`;
  if (error.code === "23505" && where.includes("vendors_tax_id_idx")) return "vendors.errors.duplicateTaxId";
  if (error.code === "23503") return "vendors.errors.reference";
  // Un check o un valor que no admite la columna: el formulario ya lo comprueba antes.
  if (error.code === "23514" || error.code === "22P02" || error.code === "23502") return "vendors.errors.invalid";
  if (error.code === "42501" || /row-level security/.test(error.message ?? "")) return "common.errorPermission";
  return undefined;
}
