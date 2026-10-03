import "server-only";

import { isClient, type LeadSummary } from "@/domain/crm";
import { daysBetween } from "@/domain/dates/civil-date";
import { nowInZone } from "@/lib/clock";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/server/billing/context";
import { getCrmConfig } from "@/server/crm/config";

/**
 * Lo que necesita la portada de Leads: una carpeta por oportunidad abierta de quien todavía no es
 * cliente, con lo que se le ha propuesto, lo que nos hemos dicho y de quién es el turno.
 *
 * El turno y los días no se guardan: salen del último mensaje (actividades y buzón, lo mira la
 * vista `deals_board`). La temperatura sí, porque es un juicio nuestro.
 */

export type LeadBoard = {
  leads: LeadSummary[];
  stages: { id: string; name: string; position: number; kind: string }[];
};

export async function loadLeadBoard(orgId: string, timezone: string): Promise<LeadBoard> {
  const db = await createClient();
  const [crm, deals, clients] = await Promise.all([
    getCrmConfig(orgId),
    fetchAll(
      (from, to) =>
        db
          .from("deals_board")
          .select(
            "id, client_id, client_name, title, stage_id, stage_kind, est_one_off_cents, est_mrr_cents, probability_bps, next_action, next_action_on, last_contact_at, last_contact_direction, temperature",
          )
          .eq("org_id", orgId)
          .eq("stage_kind", "open")
          .range(from, to),
      "leads.board.deals",
    ),
    fetchAll(
      (from, to) => db.from("clients_overview").select("id, status, manual_status").eq("org_id", orgId).range(from, to),
      "leads.board.clients",
    ),
  ]);

  // Quién sigue siendo lead: lo demás son clientes de verdad y su sitio es Clientes.
  const stillLead = new Set(
    clients
      .filter((row) => row.id && !isClient({ status: row.status ?? null, manualStatus: row.manual_status ?? null }))
      .map((row) => row.id as string),
  );
  const open = deals.filter(
    (deal): deal is typeof deal & { id: string; client_id: string; title: string; stage_id: string } =>
      Boolean(deal.id && deal.client_id && deal.title && deal.stage_id) && stillLead.has(deal.client_id as string),
  );
  if (open.length === 0) return { leads: [], stages: crm.stages };

  const [quotes, messages] = await Promise.all([countQuotes(orgId, open.map((deal) => deal.id)), countMessages(orgId, [...new Set(open.map((deal) => deal.client_id))])]);
  const stageNames = new Map(crm.stages.map((stage) => [stage.id, stage]));
  const today = nowInZone(timezone).date;

  const leads = open.map((deal): LeadSummary => {
    const stage = stageNames.get(deal.stage_id);
    return {
      dealId: deal.id,
      clientId: deal.client_id,
      clientName: deal.client_name ?? "",
      title: deal.title,
      stageId: deal.stage_id,
      stageName: stage?.name ?? "",
      stagePosition: stage?.position ?? 0,
      temperature: deal.temperature ?? null,
      estOneOffCents: deal.est_one_off_cents ?? 0,
      estMrrCents: deal.est_mrr_cents ?? 0,
      probabilityBps: deal.probability_bps ?? 0,
      nextAction: deal.next_action ?? null,
      nextActionOn: deal.next_action_on ?? null,
      lastContactDaysAgo: deal.last_contact_at
        ? Math.max(0, daysBetween(nowInZone(timezone, new Date(deal.last_contact_at)).date, today))
        : null,
      // Si el último mensaje fue suyo, la pelota es nuestra.
      awaitingOurReply: deal.last_contact_direction === "incoming",
      quotes: quotes.get(deal.id) ?? 0,
      messages: messages.get(deal.client_id) ?? 0,
    };
  });

  return { leads, stages: crm.stages };
}

/** Cuántos presupuestos tiene cada oportunidad (los borradores también cuentan como trabajo hecho). */
async function countQuotes(orgId: string, dealIds: readonly string[]): Promise<Map<string, number>> {
  const db = await createClient();
  const { data, error } = await db.from("quotes").select("deal_id").eq("org_id", orgId).in("deal_id", dealIds).is("archived_at", null);
  if (error) throw error;
  const counts = new Map<string, number>();
  for (const row of data ?? []) if (row.deal_id) counts.set(row.deal_id, (counts.get(row.deal_id) ?? 0) + 1);
  return counts;
}

/** Cuántos correos hay con cada ficha (los del buzón conectado). */
async function countMessages(orgId: string, clientIds: readonly string[]): Promise<Map<string, number>> {
  const db = await createClient();
  const { data, error } = await db.from("mail_messages").select("client_id").eq("org_id", orgId).in("client_id", clientIds);
  if (error) throw error;
  const counts = new Map<string, number>();
  for (const row of data ?? []) if (row.client_id) counts.set(row.client_id, (counts.get(row.client_id) ?? 0) + 1);
  return counts;
}
