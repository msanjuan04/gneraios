import "server-only";

import type { ActivityKind } from "@/app/[org]/clients/schema";
import type { LeadTemperature } from "@/domain/crm";
import type { CivilDate } from "@/domain/dates/civil-date";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/server/billing/context";

/**
 * La ficha de un lead: lo poco que hay que saber de alguien con quien todavía solo se habla.
 * Nada de contratos, facturas, proyectos, SEO ni webs: eso llega cuando se convierte en cliente.
 */

export type LeadMessage = {
  id: string;
  kind: ActivityKind;
  title: string;
  body: string | null;
  occurredAt: string;
  direction: "incoming" | "outgoing" | "internal" | null;
  channel: string | null;
  counterpart: string | null;
  externalReference: string | null;
  memberName: string | null;
};

export type LeadQuote = {
  id: string;
  number: string | null;
  title: string;
  state: string;
  issuedOn: CivilDate | null;
  validUntil: CivilDate | null;
  oneOffCents: number;
  monthlyCents: number;
  landingUrl: string | null;
  /** Si se guardó copia del PDF que vio el cliente. */
  hasPdf: boolean;
};

export type LeadDeal = {
  id: string;
  title: string;
  stageName: string;
  stageKind: "open" | "won" | "lost";
  estOneOffCents: number;
  estMrrCents: number;
  probabilityBps: number;
  nextAction: string | null;
  nextActionOn: CivilDate | null;
  ownerName: string | null;
  sourceName: string | null;
  temperature: LeadTemperature | null;
};

export type LeadContact = { id: string; fullName: string; role: string | null; email: string | null; phone: string | null; isPrimary: boolean };

export type LeadDetail = {
  id: string;
  displayName: string;
  sector: string | null;
  website: string | null;
  city: string | null;
  notes: string | null;
  createdAt: string;
  deals: LeadDeal[];
  contacts: LeadContact[];
  messages: LeadMessage[];
  quotes: LeadQuote[];
  /** Los correos del buzón conectado: cuántos hay y de quién es el turno. */
  mail: { total: number; awaitingOurReply: boolean; lastAt: string | null };
};

/** null si no existe, no se ve (RLS) o ya es un cliente de verdad (esa tiene su propia ficha). */
export async function loadLead(orgId: string, clientId: string): Promise<LeadDetail | null> {
  const db = await createClient();
  const { data: client, error } = await db
    .from("clients")
    .select("id, display_name, sector, website, city, notes, created_at")
    .eq("org_id", orgId)
    .eq("id", clientId)
    .maybeSingle();
  if (error) throw error;
  if (!client) return null;

  const [deals, contacts, activities, quotes, members, sources] = await Promise.all([
    db
      .from("deals_board")
      .select("id, title, stage_id, stage_kind, stage_position, est_one_off_cents, est_mrr_cents, probability_bps, next_action, next_action_on, owner_member_id, source_id, temperature, last_contact_at, last_contact_direction")
      .eq("org_id", orgId)
      .eq("client_id", clientId)
      .order("stage_position"),
    db.from("contacts").select("id, full_name, role, email, phone, is_primary").eq("org_id", orgId).eq("client_id", clientId).is("archived_at", null).order("is_primary", { ascending: false }).order("full_name"),
    fetchAll(
      (from, to) =>
        db
          .from("activities")
          .select("id, kind, title, body, occurred_at, direction, channel, counterpart, external_reference, member_id")
          .eq("org_id", orgId)
          .eq("client_id", clientId)
          .order("occurred_at", { ascending: false })
          .range(from, to),
      "lead.activities",
    ),
    db
      .from("quotes_overview")
      .select("id, number, title, state, issued_on, valid_until, one_off_cents, monthly_cents")
      .eq("org_id", orgId)
      .eq("client_id", clientId)
      .order("created_at", { ascending: false }),
    db.from("members").select("id, full_name").eq("org_id", orgId),
    db.from("pipeline_stages").select("id, name").eq("org_id", orgId),
  ]);
  for (const result of [deals, contacts, quotes, members, sources]) if (result.error) throw result.error;

  const memberName = new Map((members.data ?? []).map((m) => [m.id, m.full_name]));
  const stageName = new Map((sources.data ?? []).map((s) => [s.id, s.name]));

  // De las propuestas: cuáles tienen landing y de cuáles se guardó el PDF enviado.
  const quoteIds = (quotes.data ?? []).flatMap((q) => (q.id ? [q.id] : []));
  const [landings, snapshots] = await Promise.all([
    quoteIds.length ? db.from("quotes").select("id, landing_url").in("id", quoteIds) : Promise.resolve({ data: [], error: null }),
    quoteIds.length ? db.from("quote_sent_versions").select("quote_id").in("quote_id", quoteIds) : Promise.resolve({ data: [], error: null }),
  ]);
  const landingOf = new Map((landings.data ?? []).map((row) => [row.id, row.landing_url]));
  const withPdf = new Set((snapshots.data ?? []).map((row) => row.quote_id));

  // El correo del buzón conectado: aquí solo el recuento y de quién es el turno; la conversación
  // entera vive en su propia página (/leads/<id>/mail), que es donde se responde.
  const mailRows = await db
    .from("mail_messages")
    .select("direction, sent_at")
    .eq("org_id", orgId)
    .eq("client_id", clientId)
    .order("sent_at", { ascending: false })
    .limit(500);
  if (mailRows.error) throw mailRows.error;
  const mail = {
    total: mailRows.data?.length ?? 0,
    awaitingOurReply: (mailRows.data ?? [])[0]?.direction === "incoming",
    lastAt: (mailRows.data ?? [])[0]?.sent_at ?? null,
  };

  return {
    id: client.id,
    mail,
    displayName: client.display_name,
    sector: client.sector,
    website: client.website,
    city: client.city,
    notes: client.notes,
    createdAt: client.created_at,
    deals: (deals.data ?? []).flatMap((deal) =>
      deal.id && deal.title && deal.stage_id
        ? [
            {
              id: deal.id,
              title: deal.title,
              stageName: stageName.get(deal.stage_id) ?? "—",
              stageKind: (deal.stage_kind ?? "open") as LeadDeal["stageKind"],
              estOneOffCents: deal.est_one_off_cents ?? 0,
              estMrrCents: deal.est_mrr_cents ?? 0,
              probabilityBps: deal.probability_bps ?? 0,
              nextAction: deal.next_action,
              nextActionOn: deal.next_action_on,
              ownerName: deal.owner_member_id ? (memberName.get(deal.owner_member_id) ?? null) : null,
              sourceName: null,
              temperature: deal.temperature ?? null,
            },
          ]
        : [],
    ),
    contacts: (contacts.data ?? []).map((c) => ({ id: c.id, fullName: c.full_name, role: c.role, email: c.email, phone: c.phone, isPrimary: c.is_primary })),
    messages: activities.map((a) => ({
      id: a.id,
      kind: a.kind as ActivityKind,
      title: a.title,
      body: a.body,
      occurredAt: a.occurred_at,
      direction: a.direction as LeadMessage["direction"],
      channel: a.channel,
      counterpart: a.counterpart,
      externalReference: a.external_reference,
      memberName: a.member_id ? (memberName.get(a.member_id) ?? null) : null,
    })),
    quotes: (quotes.data ?? []).flatMap((q) =>
      q.id
        ? [
            {
              id: q.id,
              number: q.number,
              title: q.title ?? "—",
              state: q.state ?? "draft",
              issuedOn: q.issued_on,
              validUntil: q.valid_until,
              oneOffCents: q.one_off_cents ?? 0,
              monthlyCents: q.monthly_cents ?? 0,
              landingUrl: landingOf.get(q.id) ?? null,
              hasPdf: withPdf.has(q.id),
            },
          ]
        : [],
    ),
  };
}
