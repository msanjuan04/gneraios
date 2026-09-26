import "server-only";
import type { PostgrestError } from "@supabase/supabase-js";
import type { createClient } from "@/lib/supabase/server";

export type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Tabla de cada lista configurable del pipeline. */
export const NAME_LIST_TABLES = { sources: "acquisition_sources", reasons: "loss_reasons" } as const;
export type PositionTable = "pipeline_stages" | (typeof NAME_LIST_TABLES)[keyof typeof NAME_LIST_TABLES];

type Count = { count: number; error: null } | { count: null; error: PostgrestError };

/**
 * Deals de una etapa: sin archivar (los del tablero) o todos. Se cuentan en la base
 * de datos: una lista de filas se cortaría en el límite de la API (1000).
 */
export async function countStageDeals(
  supabase: Supabase,
  orgId: string,
  stageId: string,
  scope: "active" | "all",
): Promise<Count> {
  let query = supabase
    .from("deals")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("stage_id", stageId);
  if (scope === "active") query = query.is("archived_at", null);
  const { count, error } = await query;
  return error ? { count: null, error } : { count: count ?? 0, error: null };
}
