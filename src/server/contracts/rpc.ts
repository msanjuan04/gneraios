import "server-only";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { MilestonePayload } from "@/app/[org]/contracts/schema";
import type { Db } from "@/server/billing/context";

/**
 * save_contract_milestones (supabase/migrations/20260926150000_hitos_contrato.sql): reescribe
 * todos los hitos de un contrato en una transacción; el 100 % se comprueba al confirmar.
 *
 * database.generated.ts se generó justo antes de esa migración y todavía no conoce la
 * función, así que esta es la única llamada sin tipar. Con el próximo `pnpm db:types` el
 * cast sobra (y sigue compilando).
 */
export async function saveContractMilestones(
  db: Db,
  contractId: string,
  milestones: readonly MilestonePayload[],
): Promise<{ error: PostgrestError | null }> {
  const untyped = db as unknown as SupabaseClient;
  const { error } = await untyped.rpc("save_contract_milestones", { p_contract_id: contractId, p: milestones });
  return { error };
}
