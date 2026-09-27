"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { fromDateTimeLocal } from "@/domain/dates/zoned-time";
import type { ActionResult } from "@/lib/action-result";
import type { TablesUpdate } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { emptyToNull } from "@/lib/validation/fiscal";
import {
  dbFailure,
  type Failure,
  failure,
  forbidden,
  idSchema,
  invalidInput,
  partnerContext,
} from "@/server/action-utils";
import {
  type ActivityFormInput,
  activityFormSchema,
  type ClientFormInput,
  clientFormSchema,
  type ClientFormValues,
  type ContactFormInput,
  contactFormSchema,
  normalizeClientTaxId,
} from "./schema";
import { isClientManualStatus } from "@/domain/clients/status";

type Supabase = Awaited<ReturnType<typeof createClient>>;

// El índice único parcial de `clients` (org, NIF) entre los no archivados: un cliente, una ficha.
const isDuplicateTaxId = (error: PostgrestError) => error.code === "23505" && error.message.includes("clients_tax_id_idx");

/** Vuelve a pintar el listado y la ficha; también el tablero si cambia algo que enseña (nombre, archivado). */
function revalidateClient(slug: string, clientId: string, { pipeline = false } = {}) {
  revalidatePath(`/${slug}/clients`);
  revalidatePath(`/${slug}/clients/${clientId}`);
  if (pipeline) revalidatePath(`/${slug}/pipeline`);
}

function toClientRow(values: ClientFormValues) {
  return {
    display_name: values.display_name,
    legal_name: emptyToNull(values.legal_name),
    tax_id_kind: values.tax_id_kind,
    tax_id: emptyToNull(normalizeClientTaxId(values.tax_id_kind, values.tax_id) ?? ""),
    address_line: emptyToNull(values.address_line),
    postal_code: emptyToNull(values.postal_code),
    city: emptyToNull(values.city),
    province: emptyToNull(values.province),
    country_code: values.country_code,
    sector: emptyToNull(values.sector),
    website: emptyToNull(values.website),
    owner_member_id: emptyToNull(values.owner_member_id),
    is_business: values.is_business,
    preferred_language: values.preferred_language,
    payment_terms_days: values.payment_terms_days === "" ? null : Number(values.payment_terms_days),
    notes: emptyToNull(values.notes),
  } satisfies TablesUpdate<"clients">;
}

/** "Ya existe un cliente con ese NIF": dice cuál, para ir a su ficha en lugar de duplicarla. */
async function duplicateTaxIdFailure(
  supabase: Supabase,
  orgId: string,
  taxId: string | null,
  exceptId: string | null,
  key: "duplicateTaxId" | "restoreDuplicateTaxId",
): Promise<Failure> {
  if (taxId) {
    let query = supabase
      .from("clients")
      .select("display_name")
      .eq("org_id", orgId)
      .eq("tax_id", taxId)
      .is("archived_at", null);
    if (exceptId) query = query.neq("id", exceptId);
    const { data } = await query.limit(1).maybeSingle();
    if (data) return failure(`clients.errors.${key}`, { name: data.display_name });
  }
  return failure("clients.errors.duplicateTaxIdUnknown");
}

/** null si el cliente existe en la org y se puede tocar; si no, el error para el toast. */
async function writableClient(supabase: Supabase, orgId: string, clientId: string): Promise<Failure | null> {
  const { data, error } = await supabase
    .from("clients")
    .select("id, archived_at")
    .eq("id", clientId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) return dbFailure(error, "clients.load");
  if (!data) return failure("clients.errors.notFound");
  if (data.archived_at) return failure("clients.errors.archived");
  return null;
}

/** Crea o actualiza un cliente. Devuelve su id para abrir la ficha. */
export async function saveClient(
  slug: string,
  clientId: string | null,
  input: ClientFormInput,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const parsed = clientFormSchema.safeParse(input);
  const id = clientId === null ? null : idSchema.safeParse(clientId);
  if (!parsed.success || (id && !id.success)) return invalidInput();

  const orgId = ctx.org.id;
  const supabase = await createClient();
  const row = toClientRow(parsed.data);

  if (id) {
    const blocked = await writableClient(supabase, orgId, id.data);
    if (blocked) return blocked;
    const { data, error } = await supabase.from("clients").update(row).eq("id", id.data).eq("org_id", orgId).select("id");
    if (error) {
      return isDuplicateTaxId(error)
        ? duplicateTaxIdFailure(supabase, orgId, row.tax_id, id.data, "duplicateTaxId")
        : dbFailure(error, "saveClient.update");
    }
    if (data.length === 0) return forbidden();
    revalidateClient(ctx.org.slug, id.data, { pipeline: true });
    return { ok: true, id: id.data };
  }

  const { data, error } = await supabase
    .from("clients")
    .insert({ ...row, org_id: orgId })
    .select("id")
    .single();
  if (error) {
    return isDuplicateTaxId(error)
      ? duplicateTaxIdFailure(supabase, orgId, row.tax_id, null, "duplicateTaxId")
      : dbFailure(error, "saveClient.insert");
  }
  revalidateClient(ctx.org.slug, data.id, { pipeline: true });
  return { ok: true, id: data.id };
}

/** Archiva un cliente (nunca se borra) o lo restaura. Sus contactos, deals y actividad se conservan. */
export async function setClientArchived(slug: string, clientId: string, archived: boolean): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(clientId);
  if (!id.success || typeof archived !== "boolean") return invalidInput();

  const orgId = ctx.org.id;
  const supabase = await createClient();
  const update = supabase
    .from("clients")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", id.data)
    .eq("org_id", orgId);
  const { data, error } = await (archived ? update.is("archived_at", null) : update.not("archived_at", "is", null)).select(
    "id",
  );
  if (error) {
    // Al restaurarlo, otro cliente activo puede tener ya su NIF.
    if (!archived && isDuplicateTaxId(error)) {
      const { data: own } = await supabase.from("clients").select("tax_id").eq("id", id.data).eq("org_id", orgId).maybeSingle();
      return duplicateTaxIdFailure(supabase, orgId, own?.tax_id ?? null, id.data, "restoreDuplicateTaxId");
    }
    return dbFailure(error, "setClientArchived");
  }
  if (data.length === 0) return failure("clients.errors.notFound");

  revalidateClient(ctx.org.slug, id.data, { pipeline: true });
  return { ok: true };
}

/**
 * Marca a mano el estado del cliente (contacto pendiente, lead, activo…) o lo vuelve a dejar en
 * «Automático» (null). No toca contratos ni métricas: es lo que se ve en la lista y en la ficha.
 */
export async function setClientManualStatus(slug: string, clientId: string, status: string | null): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(clientId);
  if (!id.success || (status !== null && !isClientManualStatus(status))) return invalidInput();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clients")
    .update({ manual_status: status })
    .eq("id", id.data)
    .eq("org_id", ctx.org.id)
    .select("id");
  if (error) return dbFailure(error, "setClientManualStatus");
  if (data.length === 0) return failure("clients.errors.notFound");
  revalidateClient(ctx.org.slug, id.data, { pipeline: false });
  return { ok: true };
}

/** Crea o actualiza un contacto. Marcarlo como principal desmarca al anterior. */
export async function saveContact(
  slug: string,
  clientId: string,
  contactId: string | null,
  input: ContactFormInput,
): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const parsed = contactFormSchema.safeParse(input);
  const client = idSchema.safeParse(clientId);
  const contact = contactId === null ? null : idSchema.safeParse(contactId);
  if (!parsed.success || !client.success || (contact && !contact.success)) return invalidInput();

  const orgId = ctx.org.id;
  const supabase = await createClient();
  const blocked = await writableClient(supabase, orgId, client.data);
  if (blocked) return blocked;

  if (contact) {
    const { data, error } = await supabase
      .from("contacts")
      .select("id")
      .eq("id", contact.data)
      .eq("client_id", client.data)
      .eq("org_id", orgId)
      .is("archived_at", null)
      .maybeSingle();
    if (error) return dbFailure(error, "saveContact.load");
    if (!data) return failure("clients.errors.contactNotFound");
  }

  // Un solo principal por cliente (índice único parcial): antes hay que desmarcar el anterior.
  let previousPrimary: string[] = [];
  if (parsed.data.is_primary) {
    let clear = supabase
      .from("contacts")
      .update({ is_primary: false })
      .eq("org_id", orgId)
      .eq("client_id", client.data)
      .eq("is_primary", true)
      .is("archived_at", null);
    if (contact) clear = clear.neq("id", contact.data);
    const { data, error } = await clear.select("id");
    if (error) return dbFailure(error, "saveContact.clearPrimary");
    previousPrimary = data.map((r) => r.id);
  }
  const restorePrimary = async () => {
    if (previousPrimary.length === 0) return;
    const { error } = await supabase.from("contacts").update({ is_primary: true }).in("id", previousPrimary).eq("org_id", orgId);
    if (error) console.error("[clients] saveContact.restorePrimary", error);
  };

  const values = parsed.data;
  const row = {
    full_name: values.full_name,
    role: emptyToNull(values.role),
    email: emptyToNull(values.email),
    phone: emptyToNull(values.phone),
    is_primary: values.is_primary,
    is_billing: values.is_billing,
    notes: emptyToNull(values.notes),
  } satisfies TablesUpdate<"contacts">;

  if (contact) {
    const { data, error } = await supabase
      .from("contacts")
      .update(row)
      .eq("id", contact.data)
      .eq("client_id", client.data)
      .eq("org_id", orgId)
      .select("id");
    if (error || data.length === 0) {
      await restorePrimary();
      return error ? dbFailure(error, "saveContact.update") : forbidden();
    }
  } else {
    const { error } = await supabase.from("contacts").insert({ ...row, org_id: orgId, client_id: client.data });
    if (error) {
      await restorePrimary();
      return dbFailure(error, "saveContact.insert");
    }
  }

  revalidateClient(ctx.org.slug, client.data);
  return { ok: true };
}

/** Archiva un contacto: deja de recibir facturas y de salir en la ficha, pero su historial se conserva. */
export async function archiveContact(slug: string, clientId: string, contactId: string): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const client = idSchema.safeParse(clientId);
  const contact = idSchema.safeParse(contactId);
  if (!client.success || !contact.success) return invalidInput();

  const orgId = ctx.org.id;
  const supabase = await createClient();
  const blocked = await writableClient(supabase, orgId, client.data);
  if (blocked) return blocked;

  const { data, error } = await supabase
    .from("contacts")
    .update({ archived_at: new Date().toISOString(), is_primary: false })
    .eq("id", contact.data)
    .eq("client_id", client.data)
    .eq("org_id", orgId)
    .is("archived_at", null)
    .select("id");
  if (error) return dbFailure(error, "archiveContact");
  if (data.length === 0) return failure("clients.errors.contactNotFound");

  revalidateClient(ctx.org.slug, client.data);
  return { ok: true };
}

/**
 * Registra una llamada, reunión, email o nota. La hora llega como hora de pared de la org.
 * `client_visible`: sale en «Lo que hemos hecho» del portal del cliente (por defecto, no).
 */
export async function createActivity(
  slug: string,
  clientId: string,
  input: ActivityFormInput & { client_visible?: boolean },
): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const parsed = activityFormSchema.safeParse(input);
  const client = idSchema.safeParse(clientId);
  if (!parsed.success || !client.success) return invalidInput();
  const occurredAt = fromDateTimeLocal(parsed.data.occurred_at, ctx.org.timezone);
  if (!occurredAt) return failure("clients.validation.dateTime");

  const orgId = ctx.org.id;
  const supabase = await createClient();
  const blocked = await writableClient(supabase, orgId, client.data);
  if (blocked) return blocked;

  // Las FKs compuestas solo garantizan la misma org: el deal y el contacto tienen que ser de este cliente.
  const { deal_id, contact_id } = parsed.data;
  const [deal, contact] = await Promise.all([
    deal_id
      ? supabase
          .from("deals")
          .select("id")
          .eq("id", deal_id)
          .eq("client_id", client.data)
          .eq("org_id", orgId)
          .is("archived_at", null)
          .maybeSingle()
      : null,
    contact_id
      ? supabase
          .from("contacts")
          .select("id")
          .eq("id", contact_id)
          .eq("client_id", client.data)
          .eq("org_id", orgId)
          .is("archived_at", null)
          .maybeSingle()
      : null,
  ]);
  if (deal?.error) return dbFailure(deal.error, "createActivity.deal");
  if (contact?.error) return dbFailure(contact.error, "createActivity.contact");
  if (deal_id && !deal?.data) return failure("clients.errors.invalidDeal");
  if (contact_id && !contact?.data) return failure("clients.errors.invalidContact");

  const { error } = await supabase.from("activities").insert({
    org_id: orgId,
    client_id: client.data,
    deal_id: emptyToNull(deal_id),
    contact_id: emptyToNull(contact_id),
    kind: parsed.data.kind,
    title: parsed.data.title,
    body: emptyToNull(parsed.data.body),
    occurred_at: occurredAt.toISOString(),
    member_id: ctx.member.id,
    client_visible: input.client_visible === true,
  });
  if (error) return dbFailure(error, "createActivity");

  revalidateClient(ctx.org.slug, client.data);
  return { ok: true };
}

/** Borra una actividad: son notas, no documentos (la RLS lo permite a partir de socio). */
export async function deleteActivity(slug: string, clientId: string, activityId: string): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const client = idSchema.safeParse(clientId);
  const activity = idSchema.safeParse(activityId);
  if (!client.success || !activity.success) return invalidInput();

  const orgId = ctx.org.id;
  const supabase = await createClient();
  const blocked = await writableClient(supabase, orgId, client.data);
  if (blocked) return blocked;

  const { data, error } = await supabase
    .from("activities")
    .delete()
    .eq("id", activity.data)
    .eq("client_id", client.data)
    .eq("org_id", orgId)
    .select("id");
  if (error) return dbFailure(error, "deleteActivity");
  if (data.length === 0) return failure("clients.errors.activityNotFound");

  revalidateClient(ctx.org.slug, client.data);
  return { ok: true };
}
