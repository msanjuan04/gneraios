"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { BOARD_PAGE_SIZE, type BoardDeal } from "@/components/crm/board-types";
import type { ActionResult } from "@/lib/action-result";
import { createClient } from "@/lib/supabase/server";
import { emptyToNull } from "@/lib/validation/fiscal";
import { dbFailure, failure, forbidden, idSchema, invalidInput, memberContext, partnerContext } from "@/server/action-utils";
import { fetchStageDeals } from "@/server/crm/board";
import {
  type DealFormInput,
  dealFormSchema,
  moneyToCents,
  type MoveDealInput,
  moveDealSchema,
  percentToBps,
} from "./schema";

// El trigger `deals_guard` exige motivo al perder (hint para distinguirlo de otros P0001).
const knownDealErrors = (error: PostgrestError) =>
  error.hint === "loss_reason_required" ? "pipeline.errors.lossReasonRequired" : undefined;

function revalidateDeal(slug: string, clientId?: string) {
  revalidatePath(`/${slug}/pipeline`);
  revalidatePath(`/${slug}/clients`);
  if (clientId) revalidatePath(`/${slug}/clients/${clientId}`);
}

/** Crea o edita un deal. Sin cliente elegido, crea el cliente a la vez: así nace un lead. */
export async function saveDeal(
  slug: string,
  dealId: string | null,
  input: DealFormInput,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const parsed = dealFormSchema.safeParse(input);
  const id = dealId === null ? null : idSchema.safeParse(dealId);
  if (!parsed.success || (id && !id.success)) return invalidInput();
  const v = parsed.data;
  const supabase = await createClient();
  const orgId = ctx.org.id;

  let clientId = v.client_id;
  let createdClient = false;
  if (!clientId) {
    const { data, error } = await supabase
      .from("clients")
      .insert({
        org_id: orgId,
        display_name: v.new_client_name.trim(),
        owner_member_id: emptyToNull(v.owner_member_id) ?? ctx.member.id,
      })
      .select("id")
      .single();
    if (error) return dbFailure(error, "saveDeal.client");
    clientId = data.id;
    createdClient = true;
  }

  const row = {
    title: v.title,
    client_id: clientId,
    stage_id: v.stage_id,
    est_one_off_cents: moneyToCents(v.est_one_off) ?? 0,
    est_mrr_cents: moneyToCents(v.est_mrr) ?? 0,
    probability_bps: percentToBps(v.probability) ?? null,
    source_id: emptyToNull(v.source_id),
    brought_by_member_id: emptyToNull(v.brought_by_member_id),
    owner_member_id: emptyToNull(v.owner_member_id),
    next_action: emptyToNull(v.next_action),
    next_action_on: emptyToNull(v.next_action_on),
    loss_reason_id: emptyToNull(v.loss_reason_id),
    loss_note: emptyToNull(v.loss_note),
  };

  const result = id
    ? await supabase.from("deals").update(row).eq("id", id.data).eq("org_id", orgId).select("id").maybeSingle()
    : await supabase.from("deals").insert({ ...row, org_id: orgId }).select("id").single();

  if (result.error || !result.data) {
    // Si el cliente se creó solo para este deal, no se deja huérfano.
    if (createdClient) {
      await supabase.from("clients").update({ archived_at: new Date().toISOString() }).eq("id", clientId);
    }
    return result.error ? dbFailure(result.error, "saveDeal", knownDealErrors) : failure("pipeline.errors.notFound");
  }

  revalidateDeal(ctx.org.slug, clientId);
  return { ok: true, id: result.data.id };
}

/** Mueve un deal de etapa (drag & drop o teclado). Perder exige motivo. */
export async function moveDeal(slug: string, input: MoveDealInput): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const parsed = moveDealSchema.safeParse(input);
  if (!parsed.success) return invalidInput();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("deals")
    .update({
      stage_id: parsed.data.stage_id,
      ...(parsed.data.loss_reason_id !== undefined && {
        loss_reason_id: emptyToNull(parsed.data.loss_reason_id),
        loss_note: emptyToNull(parsed.data.loss_note ?? ""),
      }),
    })
    .eq("id", parsed.data.deal_id)
    .eq("org_id", ctx.org.id)
    .select("id, client_id")
    .maybeSingle();
  if (error) return dbFailure(error, "moveDeal", knownDealErrors);
  if (!data) return failure("pipeline.errors.notFound");

  revalidateDeal(ctx.org.slug, data.client_id);
  return { ok: true };
}

/** Archiva un deal (no se borra: su historial alimenta el embudo). */
export async function archiveDeal(slug: string, dealId: string): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(dealId);
  if (!id.success) return invalidInput();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("deals")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id.data)
    .eq("org_id", ctx.org.id)
    .select("client_id")
    .maybeSingle();
  if (error) return dbFailure(error, "archiveDeal");
  if (!data) return failure("pipeline.errors.notFound");

  revalidateDeal(ctx.org.slug, data.client_id);
  return { ok: true };
}

export type DealHistoryEntry = { fromStageId: string | null; toStageId: string; at: string; byInitials: string | null };

/** Historial de etapas de un deal, para su ficha. */
export async function getDealHistory(slug: string, dealId: string): Promise<DealHistoryEntry[]> {
  const ctx = await memberContext(slug);
  const id = idSchema.safeParse(dealId);
  if (!ctx || !id.success) return [];
  const supabase = await createClient();
  const [{ data: history }, { data: members }] = await Promise.all([
    supabase
      .from("deal_stage_history")
      .select("from_stage_id, to_stage_id, changed_at, changed_by")
      .eq("org_id", ctx.org.id)
      .eq("deal_id", id.data)
      .order("changed_at", { ascending: false }),
    supabase.from("members").select("user_id, initials").eq("org_id", ctx.org.id),
  ]);
  const initialsByUser = new Map((members ?? []).map((m) => [m.user_id, m.initials]));
  return (history ?? []).map((h) => ({
    fromStageId: h.from_stage_id,
    toStageId: h.to_stage_id,
    at: h.changed_at,
    byInitials: h.changed_by ? (initialsByUser.get(h.changed_by) ?? null) : null,
  }));
}

/** La siguiente página de una columna del tablero («Ver más»): cualquier miembro puede leerla. */
export async function loadStageDeals(slug: string, stageId: string, offset: number): Promise<ActionResult<{ deals: BoardDeal[]; total: number }>> {
  const ctx = await memberContext(slug);
  if (!ctx) return forbidden();
  if (!idSchema.safeParse(stageId).success || !Number.isInteger(offset) || offset < 0 || offset > 100_000) return invalidInput();
  const page = await fetchStageDeals(ctx.org.id, stageId, offset, BOARD_PAGE_SIZE, ctx.org.timezone);
  return { ok: true, ...page };
}
