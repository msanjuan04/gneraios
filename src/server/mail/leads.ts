import "server-only";

import { leadNameFor, leadTitleFor } from "@/domain/mail";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Abre un lead cuando escribe alguien que no conocemos: la ficha, su contacto y una oportunidad en
 * la primera etapa. Lo llama la sincronización del buzón, que ya ha descartado los envíos
 * automáticos (`isAutomatedSender`).
 *
 * Los leads nuevos quedan como «Pendiente de contactar» (`manual_status`): así se ve cuáles hay que
 * revisar sin una columna nueva, y descartar uno es el borrado completo de siempre (`purge_client`).
 */

export type NewLead = { name?: string; address: string; subject: string };

/** Lo que hace falta de la configuración del pipeline para abrir una oportunidad. */
type PipelineEntry = { stageId: string; sourceId: string | null };

const entryCache = new Map<string, Promise<PipelineEntry | null>>();

/** La primera etapa abierta y la fuente «correo», si la org tiene una. Una vez por org y proceso. */
function pipelineEntry(orgId: string): Promise<PipelineEntry | null> {
  let entry = entryCache.get(orgId);
  if (!entry) {
    entry = loadPipelineEntry(orgId);
    // Un fallo no se queda en la caché: la siguiente sincronización lo vuelve a intentar.
    entry.catch(() => entryCache.delete(orgId));
    entryCache.set(orgId, entry);
  }
  return entry;
}

async function loadPipelineEntry(orgId: string): Promise<PipelineEntry | null> {
  const admin = createAdminClient();
  const [stages, sources] = await Promise.all([
    admin.from("pipeline_stages").select("id, kind, position").eq("org_id", orgId).is("archived_at", null).order("position"),
    admin.from("acquisition_sources").select("id, name").eq("org_id", orgId).is("archived_at", null),
  ]);
  if (stages.error) throw stages.error;
  if (sources.error) throw sources.error;
  const first = (stages.data ?? []).find((stage) => stage.kind === "open");
  if (!first) return null;
  const source = (sources.data ?? []).find((item) => /correo|e-?mail/i.test(item.name));
  return { stageId: first.id, sourceId: source?.id ?? null };
}

/**
 * Crea el lead y devuelve el id de la ficha, o null si no se pudo (sin etapa abierta, por ejemplo).
 * No duplica: si la dirección ya es un contacto de alguna ficha, devuelve esa.
 */
export async function createLeadFromMail(orgId: string, lead: NewLead): Promise<string | null> {
  const admin = createAdminClient();
  const address = lead.address.trim().toLowerCase();

  const existing = await admin.from("contacts").select("client_id").eq("org_id", orgId).eq("email", address).is("archived_at", null).limit(1).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data.client_id;

  const entry = await pipelineEntry(orgId);
  if (!entry) return null;

  const name = leadNameFor({ name: lead.name, address });
  const client = await admin
    .from("clients")
    .insert({ org_id: orgId, display_name: name, manual_status: "pending_contact" })
    .select("id")
    .single();
  if (client.error) throw client.error;

  const clientId = client.data.id;
  const contact = await admin.from("contacts").insert({ org_id: orgId, client_id: clientId, full_name: name, email: address, is_primary: true });
  const deal = await admin.from("deals").insert({
    org_id: orgId,
    client_id: clientId,
    title: leadTitleFor(lead.subject, "Correo recibido"),
    stage_id: entry.stageId,
    source_id: entry.sourceId,
    next_action: "Revisar y contestar el correo",
  });
  if (contact.error || deal.error) {
    // A medias no se deja: una ficha sin contacto u oportunidad no se encuentra después.
    await admin.from("deals").delete().eq("org_id", orgId).eq("client_id", clientId);
    await admin.from("contacts").delete().eq("org_id", orgId).eq("client_id", clientId);
    await admin.from("clients").delete().eq("org_id", orgId).eq("id", clientId);
    throw contact.error ?? deal.error;
  }
  return clientId;
}
