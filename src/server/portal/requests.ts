import "server-only";
import { resolvePortalSections } from "@/domain/portal";
import { createAdminClient } from "@/lib/supabase/admin";
import { pushSoon } from "@/server/push/soon";
import { allowPortalAction, resolvePortalLink } from "./access";

/**
 * «Pedir algo» desde el portal: portal_create_request crea el deal (primera etapa abierta,
 * fuente «Portal»), la nota con la petición y el aviso al socio responsable, en una transacción.
 */

export type RequestOutcome = { ok: true } | { ok: false; error: "rate_limited" | "link" | "unavailable" | "generic" };

export async function createPortalRequest(input: { token: string; subject: string; description: string; urgent: boolean }): Promise<RequestOutcome> {
  const admin = createAdminClient();
  const resolved = await resolvePortalLink(input.token, { admin });
  if (resolved.status !== "active" || resolved.link.kind !== "client") return { ok: false, error: "link" };
  const { link } = resolved;
  const clientId = link.clientId;
  if (!clientId) return { ok: false, error: "link" };

  // La sección tiene que estar encendida para ese cliente.
  const { data: settings, error: settingsError } = await admin
    .from("client_portal_settings")
    .select("sections")
    .eq("org_id", link.orgId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (settingsError) throw settingsError;
  if (!resolvePortalSections(settings?.sections).requests) return { ok: false, error: "link" };

  if (!(await allowPortalAction(admin, link.tokenHash, "request"))) return { ok: false, error: "rate_limited" };

  const { error } = await admin.rpc("portal_create_request", {
    p_token_hash: link.tokenHash,
    p: { subject: input.subject, description: input.description, urgent: input.urgent },
  });
  if (!error) {
    pushSoon(link.orgId);
    return { ok: true };
  }
  if (error.hint === "portal_link_invalid") return { ok: false, error: "link" };
  if (error.hint === "portal_client_archived" || error.hint === "portal_request_unavailable") return { ok: false, error: "unavailable" };
  console.error("[portal] petición", error);
  return { ok: false, error: "generic" };
}
