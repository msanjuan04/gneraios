import "server-only";
import type { FunnelDeal, StageChange } from "@/domain/pipeline";
import { createClient } from "@/lib/supabase/server";

// PostgREST corta cada respuesta en `max_rows` (1000, supabase/config.toml): se pagina.
const PAGE_SIZE = 1000;

type Page<T> = PromiseLike<{ data: T[] | null; error: unknown }>;

/** Todas las filas de una consulta, página a página. La consulta debe tener un orden estable. */
async function fetchAll<T>(page: (from: number, to: number) => Page<T>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

/**
 * Deals sin archivar de la org y su historial de etapas. El historial de los deals archivados
 * se descarta aquí: el embudo solo mira lo que sigue vivo. La RLS limita ambas tablas a las
 * orgs del usuario; el filtro por `org_id` se queda con esta.
 */
export async function loadFunnelData(orgId: string): Promise<{ deals: FunnelDeal[]; history: StageChange[] }> {
  const supabase = await createClient();
  const [dealRows, historyRows] = await Promise.all([
    fetchAll((from, to) =>
      supabase
        .from("deals")
        .select(
          "id, created_at, stage_id, source_id, brought_by_member_id, owner_member_id, loss_reason_id, est_one_off_cents, est_mrr_cents",
        )
        .eq("org_id", orgId)
        .is("archived_at", null)
        .order("created_at")
        .order("id")
        .range(from, to),
    ),
    fetchAll((from, to) =>
      supabase
        .from("deal_stage_history")
        .select("deal_id, from_stage_id, to_stage_id, changed_at")
        .eq("org_id", orgId)
        .order("changed_at")
        .order("id")
        .range(from, to),
    ),
  ]);

  const deals: FunnelDeal[] = dealRows.map((d) => ({
    id: d.id,
    createdAt: d.created_at,
    stageId: d.stage_id,
    sourceId: d.source_id,
    broughtById: d.brought_by_member_id,
    ownerId: d.owner_member_id,
    lossReasonId: d.loss_reason_id,
    estOneOffCents: d.est_one_off_cents,
    estMrrCents: d.est_mrr_cents,
  }));
  const live = new Set(deals.map((d) => d.id));
  const history: StageChange[] = historyRows
    .filter((h) => live.has(h.deal_id))
    .map((h) => ({ dealId: h.deal_id, fromStageId: h.from_stage_id, toStageId: h.to_stage_id, changedAt: h.changed_at }));

  return { deals, history };
}
