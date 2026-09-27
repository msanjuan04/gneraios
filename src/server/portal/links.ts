import "server-only";
import type {
  AcceptanceView,
  ClientPortalCardData,
  PortalActivityItem,
  PortalFileItem,
  PortalProjectItem,
  QuoteShareData,
  ShareLinkView,
} from "@/components/portal/types";
import { publicLinkState, resolvePortalSections } from "@/domain/portal";
import { publicEnv } from "@/lib/env";
import { nowInZone } from "@/lib/clock";
import { createClient } from "@/lib/supabase/server";
import { DbError } from "@/server/billing/context";
import { getPortalProjects } from "@/server/projects/portal";
import { newPortalToken } from "./token";

/**
 * Lado del socio: crear, revocar y renovar enlaces (RPC con su sesión: RLS y rol de partner) y lo
 * que enseñan la tarjeta «Compartir enlace» del presupuesto y «Portal del cliente». Nunca se lee
 * token_hash (no hay privilegio de columna): se piden siempre las columnas una a una.
 */

type Supabase = Awaited<ReturnType<typeof createClient>>;

const LINK_COLUMNS = "id, kind, created_at, expires_at, revoked_at, view_count, last_viewed_at, created_by";

type LinkRow = {
  id: string;
  kind: "quote" | "client";
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  view_count: number;
  last_viewed_at: string | null;
  created_by: string | null;
};

/** URL pública de un enlace: el token solo existe aquí, en el momento de crearlo. */
export function portalUrl(kind: "quote" | "client", token: string): string {
  const base = publicEnv.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  return `${base}/p/${kind === "quote" ? "q" : "c"}/${token}`;
}

async function creatorNames(supabase: Supabase, orgId: string, userIds: (string | null)[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase.from("members").select("user_id, full_name").eq("org_id", orgId).in("user_id", ids);
  if (error) throw new DbError(error, "portal.creators");
  return new Map((data ?? []).map((m) => [m.user_id, m.full_name]));
}

function toLinkView(row: LinkRow, names: Map<string, string>, now: Date): ShareLinkView {
  return {
    id: row.id,
    kind: row.kind,
    status: publicLinkState({ revokedAt: row.revoked_at, expiresAt: row.expires_at }, now),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    viewCount: row.view_count,
    lastViewedAt: row.last_viewed_at,
    createdBy: row.created_by ? (names.get(row.created_by) ?? null) : null,
  };
}

/** El enlace vivo de un destino (o el último, aunque esté revocado o caducado, para ver sus visitas). */
async function latestLink(supabase: Supabase, orgId: string, column: "quote_id" | "client_id", target: string): Promise<ShareLinkView | null> {
  const { data, error } = await supabase
    .from("public_links")
    .select(LINK_COLUMNS)
    .eq("org_id", orgId)
    .eq(column, target)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new DbError(error, "portal.link");
  const row = data?.[0] as LinkRow | undefined;
  if (!row) return null;
  return toLinkView(row, await creatorNames(supabase, orgId, [row.created_by]), new Date());
}

/** Crea el enlace (revoca el que hubiera) y devuelve su URL, que solo se ve esta vez. */
export async function createShareLink(
  supabase: Supabase,
  orgId: string,
  kind: "quote" | "client",
  targetId: string,
): Promise<{ url: string; link: ShareLinkView }> {
  const { token, hash } = newPortalToken();
  const { error } = await supabase.rpc("create_public_link", { p_kind: kind, p_target: targetId, p_token_hash: hash });
  if (error) throw new DbError(error, "portal.createLink");
  const link = await latestLink(supabase, orgId, kind === "quote" ? "quote_id" : "client_id", targetId);
  if (!link) throw new Error("[portal] el enlace recién creado no se encuentra");
  return { url: portalUrl(kind, token), link };
}

export async function getQuoteShareData(
  supabase: Supabase,
  orgId: string,
  quote: { id: string; status: "draft" | "sent" | "accepted" | "rejected"; state: string },
): Promise<QuoteShareData> {
  const [link, acceptanceRes] = await Promise.all([
    latestLink(supabase, orgId, "quote_id", quote.id),
    supabase
      .from("quote_acceptances")
      .select("signer_name, signer_email, signature, accepted_at, ip_address, user_agent, pdf_sha256, pdf_path")
      .eq("org_id", orgId)
      .eq("quote_id", quote.id)
      .maybeSingle(),
  ]);
  if (acceptanceRes.error) throw new DbError(acceptanceRes.error, "portal.acceptance");
  const a = acceptanceRes.data;
  const acceptance: AcceptanceView | null = a
    ? {
        signerName: a.signer_name,
        signerEmail: a.signer_email,
        signature: a.signature,
        acceptedAt: a.accepted_at,
        ipAddress: a.ip_address,
        userAgent: a.user_agent,
        pdfSha256: a.pdf_sha256,
        hasPdf: Boolean(a.pdf_path),
      }
    : null;
  const blockedReason: QuoteShareData["blockedReason"] =
    quote.status === "draft" ? "draft" : quote.status !== "sent" ? "answered" : quote.state === "expired" ? "expired" : null;
  return { quoteId: quote.id, shareable: blockedReason === null, blockedReason, link, acceptance };
}

/**
 * Todo lo de la tarjeta «Portal del cliente» de su ficha: el enlace, las secciones, los próximos
 * pasos, los entregables, las actividades (para marcar cuáles ve), sus contratos y sus proyectos
 * (qué ve de cada uno sale de getPortalProjects, lo mismo que lee el portal).
 */
export async function getClientPortalCardData(orgId: string, clientId: string): Promise<ClientPortalCardData> {
  const supabase = await createClient();
  const [clientRes, link, settingsRes, filesRes, activitiesRes, contractsRes, orgRes, seoRes, projectsRes, portalProjects] = await Promise.all([
    supabase.from("clients").select("archived_at").eq("org_id", orgId).eq("id", clientId).maybeSingle(),
    latestLink(supabase, orgId, "client_id", clientId),
    supabase.from("client_portal_settings").select("sections, next_steps").eq("org_id", orgId).eq("client_id", clientId).maybeSingle(),
    supabase
      .from("client_files")
      .select("id, kind, title, file_name, size_bytes, url, uploaded_at, created_at, contract_id")
      .eq("org_id", orgId)
      .eq("client_id", clientId)
      .order("created_at", { ascending: false }),
    supabase
      .from("activities")
      .select("id, kind, title, occurred_at, client_visible")
      .eq("org_id", orgId)
      .eq("client_id", clientId)
      .order("occurred_at", { ascending: false })
      .limit(50),
    supabase
      .from("contracts")
      .select("id, title")
      .eq("org_id", orgId)
      .eq("client_id", clientId)
      .is("archived_at", null)
      .order("created_at", { ascending: false }),
    supabase.from("orgs").select("timezone").eq("id", orgId).single(),
    supabase.from("seo_properties").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("client_id", clientId).is("archived_at", null),
    // Los que podrían enseñarse (sin archivar ni cancelar), para enlazar también a los ocultos.
    supabase
      .from("projects")
      .select("id, name")
      .eq("org_id", orgId)
      .eq("client_id", clientId)
      .is("archived_at", null)
      .neq("status", "cancelled")
      .order("name"),
    getPortalProjects(supabase, orgId, clientId),
  ]);
  for (const res of [clientRes, settingsRes, filesRes, activitiesRes, contractsRes, orgRes, seoRes, projectsRes]) {
    if (res.error) throw new DbError(res.error, "portal.card");
  }
  const timeZone = orgRes.data?.timezone ?? "Europe/Madrid";
  const titles = new Map((contractsRes.data ?? []).map((c) => [c.id, c.title]));

  const files: PortalFileItem[] = (filesRes.data ?? [])
    // Una subida que no se confirmó (se cerró el navegador a medias) no cuenta.
    .filter((f) => f.kind === "link" || f.uploaded_at !== null)
    .map((f) => ({
      id: f.id,
      kind: f.kind,
      title: f.title,
      fileName: f.file_name,
      sizeBytes: f.size_bytes,
      url: f.url,
      addedOn: nowInZone(timeZone, new Date(f.uploaded_at ?? f.created_at)).date,
      contractTitle: f.contract_id ? (titles.get(f.contract_id) ?? null) : null,
      uploaded: f.kind === "link" || f.uploaded_at !== null,
    }));
  const activities: PortalActivityItem[] = (activitiesRes.data ?? []).map((a) => ({
    id: a.id,
    kind: a.kind,
    title: a.title,
    occurredAt: a.occurred_at,
    visible: a.client_visible,
  }));
  const visibleIds = new Set(portalProjects.map((p) => p.id));
  const projects: PortalProjectItem[] = [
    ...portalProjects.map((p) => ({ id: p.id, name: p.name, visible: true, visibleTasks: p.tasks.length })),
    ...(projectsRes.data ?? []).filter((p) => !visibleIds.has(p.id)).map((p) => ({ id: p.id, name: p.name, visible: false, visibleTasks: 0 })),
  ];

  return {
    clientId,
    archived: Boolean(clientRes.data?.archived_at),
    link,
    sections: resolvePortalSections(settingsRes.data?.sections),
    nextSteps: settingsRes.data?.next_steps ?? "",
    files,
    activities,
    contracts: (contractsRes.data ?? []).map((c) => ({ id: c.id, title: c.title })),
    projects,
    hasWebData: (seoRes.count ?? 0) > 0,
  };
}
