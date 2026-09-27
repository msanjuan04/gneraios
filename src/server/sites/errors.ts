import type { PostgrestError } from "@supabase/supabase-js";

/**
 * Errores esperados de la base de datos (supabase/migrations/20260926380000_webs.sql) → claves de
 * i18n (`sites.errors.*`). Lo que no esté aquí sale como error genérico.
 */
export function knownSiteError(error: PostgrestError): string | undefined {
  const where = `${error.message} ${error.details ?? ""}`;
  if (error.code === "23505" && where.includes("sites_org_id_url_key")) return "sites.errors.duplicate";
  if (error.code === "23503" && where.includes("client")) return "sites.errors.clientNotFound";
  if (error.code === "23514" && where.includes("url")) return "sites.errors.invalidUrl";
  if (error.code === "42501" || /row-level security/.test(error.message)) return "common.errorPermission";
  return undefined;
}
