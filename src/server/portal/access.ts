import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import type { Db } from "@/server/billing/context";
import { getSessionUser } from "@/server/session";
import { hashPortalToken, isPortalToken } from "./token";

/**
 * Acceso público (ARCHITECTURE.md §5). El navegador del cliente nunca habla con PostgREST: el
 * servidor recibe el token, calcula su hash y resuelve el enlace con la clave secreta a través de
 * portal_link (solo service_role). Todo lo que se lee después se filtra por la org y el destino
 * del enlace.
 */

export type LinkKind = "quote" | "client";

export type PortalLink = {
  id: string;
  kind: LinkKind;
  orgId: string;
  quoteId: string | null;
  clientId: string | null;
  expiresAt: string;
  /** El hash con el que se vuelve a validar el enlace en cada acción. */
  tokenHash: string;
};

export type LinkResolution =
  | { status: "active"; link: PortalLink }
  | { status: "expired" | "revoked"; link: PortalLink }
  | { status: "unknown" };

/** Límites de las acciones públicas por enlace (intentos por ventana de una hora). */
export const PORTAL_LIMITS = {
  quote: { limit: 10, windowSeconds: 3600 },
  request: { limit: 5, windowSeconds: 3600 },
} as const;

export type PortalAction = keyof typeof PORTAL_LIMITS;

function asObject(value: Json): Record<string, Json | undefined> {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

const str = (value: Json | undefined): string | null => (typeof value === "string" ? value : null);

/**
 * Resuelve un token. Con `track`, cuenta la visita (no la de un miembro de la org que lo abre para
 * probarlo: el servidor le pasa a la RPC el usuario de su sesión, si la tiene).
 */
export async function resolvePortalLink(token: string, opts: { track?: boolean; admin?: Db } = {}): Promise<LinkResolution> {
  if (!isPortalToken(token)) return { status: "unknown" };
  const tokenHash = hashPortalToken(token);
  const viewer = opts.track ? ((await getSessionUser())?.id ?? undefined) : undefined;
  const admin = opts.admin ?? createAdminClient();
  const { data, error } = await admin.rpc("portal_link", { p_token_hash: tokenHash, p_track: opts.track ?? false, p_viewer: viewer });
  if (error) throw error;
  const row = asObject(data);
  const status = str(row.status);
  const id = str(row.id);
  const orgId = str(row.org_id);
  const kind = str(row.kind);
  const expiresAt = str(row.expires_at);
  if (!status || status === "unknown" || !id || !orgId || !expiresAt || (kind !== "quote" && kind !== "client")) {
    return { status: "unknown" };
  }
  const link: PortalLink = { id, kind, orgId, quoteId: str(row.quote_id), clientId: str(row.client_id), expiresAt, tokenHash };
  if (status === "active") return { status, link };
  if (status === "expired" || status === "revoked") return { status, link };
  return { status: "unknown" };
}

/** Cuenta un intento de una acción pública y dice si está dentro del límite. */
export async function allowPortalAction(admin: Db, tokenHash: string, action: PortalAction): Promise<boolean> {
  const { limit, windowSeconds } = PORTAL_LIMITS[action];
  const { data, error } = await admin.rpc("portal_hit", {
    p_token_hash: tokenHash,
    p_action: action,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) throw error;
  return data === true;
}
