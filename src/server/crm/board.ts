import "server-only";
import { needsReply } from "@/domain/mail";

import { BOARD_PAGE_SIZE, type BoardColumn, type BoardDeal } from "@/components/crm/board-types";
import { type CivilDate, daysBetween } from "@/domain/dates/civil-date";
import { nowInZone } from "@/lib/clock";
import type { Database } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

type BoardRow = Database["public"]["Views"]["deals_board"]["Row"];

const COLUMNS = "id, client_id, client_name, title, stage_id, est_one_off_cents, est_mrr_cents, probability_bps, probability_override_bps, source_id, brought_by_member_id, owner_member_id, owner_initials, next_action, next_action_on, loss_reason_id, loss_note, stage_entered_at, last_contact_at, last_contact_direction, last_contact_text";

/** Una fila de `deals_board` → tarjeta. Los días se cuentan en fechas civiles de la zona de la org. */
export function toBoardDeal(d: BoardRow, timezone: string, today: CivilDate): BoardDeal | null {
  if (!d.id || !d.stage_id || !d.client_id) return null;
  const entered = d.stage_entered_at ? nowInZone(timezone, new Date(d.stage_entered_at)).date : today;
  return {
    id: d.id,
    title: d.title ?? "",
    clientId: d.client_id,
    clientName: d.client_name ?? "",
    stageId: d.stage_id,
    estOneOffCents: d.est_one_off_cents ?? 0,
    estMrrCents: d.est_mrr_cents ?? 0,
    probabilityBps: d.probability_bps ?? 0,
    probabilityOverrideBps: d.probability_override_bps,
    sourceId: d.source_id,
    broughtById: d.brought_by_member_id,
    ownerId: d.owner_member_id,
    ownerInitials: d.owner_initials,
    nextAction: d.next_action,
    nextActionOn: d.next_action_on,
    nextActionOverdue: d.next_action_on !== null && daysBetween(d.next_action_on, today) > 0,
    daysInStage: Math.max(0, daysBetween(entered, today)),
    lastContactDaysAgo: d.last_contact_at ? Math.max(0, daysBetween(nowInZone(timezone, new Date(d.last_contact_at)).date, today)) : null,
    // Un «ok perfecto» del cliente no es una pregunta: la pelota no está en nuestro tejado.
    lastContactDirection:
      d.last_contact_direction === "incoming" && !needsReply({ direction: "incoming", text: d.last_contact_text ?? "" }) ? "internal" : d.last_contact_direction,
    lossReasonId: d.loss_reason_id,
    lossNote: d.loss_note,
  };
}

/**
 * Una página de una columna: primero lo que tiene próxima acción más cercana, después lo que lleva
 * más tiempo en la etapa. `total` es cuántos deals hay en la etapa en total.
 */
export async function fetchStageDeals(orgId: string, stageId: string, offset: number, limit: number, timezone: string): Promise<{ deals: BoardDeal[]; total: number }> {
  const supabase = await createClient();
  const today = nowInZone(timezone).date;
  const { data, error, count } = await supabase
    .from("deals_board")
    .select(COLUMNS, { count: "exact" })
    .eq("org_id", orgId)
    .eq("stage_id", stageId)
    .order("next_action_on", { ascending: true, nullsFirst: false })
    .order("stage_entered_at", { ascending: true })
    .order("id")
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return { deals: (data ?? []).flatMap((row) => toBoardDeal(row as BoardRow, timezone, today) ?? []), total: count ?? 0 };
}

/** La primera página de cada columna, en paralelo. */
export async function fetchBoard(orgId: string, stageIds: readonly string[], timezone: string): Promise<BoardColumn[]> {
  return Promise.all(stageIds.map(async (stageId) => ({ stageId, ...(await fetchStageDeals(orgId, stageId, 0, BOARD_PAGE_SIZE, timezone)) })));
}

/** Un deal concreto (p. ej. el de `?deal=`), aunque no esté en la primera página de su columna. */
export async function fetchBoardDeal(orgId: string, dealId: string, timezone: string): Promise<BoardDeal | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("deals_board").select(COLUMNS).eq("org_id", orgId).eq("id", dealId).maybeSingle();
  if (error) throw error;
  return data ? toBoardDeal(data as BoardRow, timezone, nowInZone(timezone).date) : null;
}
