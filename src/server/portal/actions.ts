"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ShareLinkView } from "@/components/portal/types";
import { CLIENT_FILE_MAX_BYTES, PORTAL_SECTIONS } from "@/domain/portal";
import type { ActionResult } from "@/lib/action-result";
import { createClient } from "@/lib/supabase/server";
import { dbFailure, type Failure, failure, forbidden, idSchema, invalidInput, partnerContext } from "@/server/action-utils";
import { BillingRuleError, DbError } from "@/server/billing/context";
import { addClientLink, confirmClientUpload, prepareClientUpload, removeClientFile } from "./files";
import { createShareLink } from "./links";

/**
 * Acciones de los socios sobre los enlaces y el portal. Todas pasan por su sesión: las RPC y la
 * RLS vuelven a comprobar que es socio de la org. La URL de un enlace nuevo (con el token) solo
 * sale en la respuesta de createQuoteLink / createClientLink: no se guarda en ningún sitio.
 */

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Hints de las RPC del portal (supabase/migrations/…_portal.sql) con mensaje en portal.errors. */
const HINTS: Record<string, string> = {
  portal_quote_draft: "portal.errors.quoteDraft",
  portal_quote_closed: "portal.errors.quoteClosed",
  portal_quote_expired: "portal.errors.quoteExpired",
  portal_client_archived: "portal.errors.clientArchived",
  portal_link_revoked: "portal.errors.linkRevoked",
  portal_link_follows_quote: "portal.errors.linkFollowsQuote",
  token_invalid: "common.errorGeneric",
};

const known = (error: PostgrestError) => (error.hint ? HINTS[error.hint] : undefined);

async function describe(error: unknown, where: string): Promise<Failure> {
  if (error instanceof BillingRuleError) return failure(error.key);
  if (error instanceof DbError) return dbFailure(error.error, error.where, known);
  console.error(`[portal] ${where}`, error);
  return failure("common.errorGeneric");
}

async function clientOfOrg(supabase: Supabase, orgId: string, clientId: unknown): Promise<string | Failure> {
  const id = idSchema.safeParse(clientId);
  if (!id.success) return invalidInput();
  const { data, error } = await supabase.from("clients").select("id, archived_at").eq("org_id", orgId).eq("id", id.data).maybeSingle();
  if (error) return dbFailure(error, "portal.client");
  if (!data) return failure("portal.errors.clientNotFound");
  return data.id;
}

const revalidateClient = (slug: string, clientId: string) => revalidatePath(`/${slug}/clients/${clientId}`);

// ---------------------------------------------------------------------------
// Enlaces
// ---------------------------------------------------------------------------

/** «Compartir enlace» de un presupuesto enviado. La URL solo se ve ahora. */
export async function createQuoteLink(slug: string, quoteId: string): Promise<ActionResult<{ url: string; link: ShareLinkView }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(quoteId);
  if (!id.success) return invalidInput();
  const supabase = await createClient();
  try {
    const created = await createShareLink(supabase, ctx.org.id, "quote", id.data);
    revalidatePath(`/${ctx.org.slug}/quotes/${id.data}`);
    return { ok: true, ...created };
  } catch (error) {
    return describe(error, "createQuoteLink");
  }
}

/** El enlace de «Tu espacio» de un cliente. La URL solo se ve ahora. */
export async function createClientLink(slug: string, clientId: string): Promise<ActionResult<{ url: string; link: ShareLinkView }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const supabase = await createClient();
  const client = await clientOfOrg(supabase, ctx.org.id, clientId);
  if (typeof client !== "string") return client;
  try {
    const created = await createShareLink(supabase, ctx.org.id, "client", client);
    revalidateClient(ctx.org.slug, client);
    return { ok: true, ...created };
  } catch (error) {
    return describe(error, "createClientLink");
  }
}

export async function revokeLink(slug: string, linkId: string): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(linkId);
  if (!id.success) return invalidInput();
  const supabase = await createClient();
  const { error } = await supabase.rpc("revoke_public_link", { p_link_id: id.data });
  if (error) return dbFailure(error, "revokeLink", known);
  revalidatePath(`/${ctx.org.slug}`, "layout");
  return { ok: true };
}

/** Renueva el portal de un cliente un periodo más desde hoy, con el mismo enlace. */
export async function renewLink(slug: string, linkId: string): Promise<ActionResult<{ expiresAt: string }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(linkId);
  if (!id.success) return invalidInput();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("renew_public_link", { p_link_id: id.data });
  if (error) return dbFailure(error, "renewLink", known);
  revalidatePath(`/${ctx.org.slug}`, "layout");
  return { ok: true, expiresAt: data };
}

// ---------------------------------------------------------------------------
// Ajustes del portal
// ---------------------------------------------------------------------------

const settingsSchema = z.object({
  sections: z.partialRecord(z.enum(PORTAL_SECTIONS), z.boolean()),
  nextSteps: z.string().max(2000),
});

export type PortalSettingsInput = z.input<typeof settingsSchema>;

/** Secciones encendidas y «Próximos pasos» del portal de un cliente. */
export async function savePortalSettings(slug: string, clientId: string, input: PortalSettingsInput): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return invalidInput();
  const supabase = await createClient();
  const client = await clientOfOrg(supabase, ctx.org.id, clientId);
  if (typeof client !== "string") return client;
  const { error } = await supabase.from("client_portal_settings").upsert(
    {
      org_id: ctx.org.id,
      client_id: client,
      sections: parsed.data.sections,
      next_steps: parsed.data.nextSteps.trim() || null,
    },
    { onConflict: "org_id,client_id" },
  );
  if (error) return dbFailure(error, "savePortalSettings");
  revalidateClient(ctx.org.slug, client);
  return { ok: true };
}

/** Marca (o desmarca) una actividad como visible en «Lo que hemos hecho». */
export async function setActivityVisible(slug: string, clientId: string, activityId: string, visible: boolean): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const activity = idSchema.safeParse(activityId);
  if (!activity.success || typeof visible !== "boolean") return invalidInput();
  const supabase = await createClient();
  const client = await clientOfOrg(supabase, ctx.org.id, clientId);
  if (typeof client !== "string") return client;
  const { data, error } = await supabase
    .from("activities")
    .update({ client_visible: visible })
    .eq("org_id", ctx.org.id)
    .eq("client_id", client)
    .eq("id", activity.data)
    .select("id");
  if (error) return dbFailure(error, "setActivityVisible");
  if (!data?.length) return failure("portal.errors.activityNotFound");
  revalidateClient(ctx.org.slug, client);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Entregables y material
// ---------------------------------------------------------------------------

const title = z.string().trim().min(1).max(200);
const optionalContract = z.union([idSchema, z.literal(""), z.null()]).transform((v) => v || null);

const linkSchema = z.object({ title, url: z.string().trim().min(1).max(2000), contractId: optionalContract });
const uploadSchema = z.object({
  title,
  fileName: z.string().trim().min(1).max(200),
  sizeBytes: z.number().int().positive().max(CLIENT_FILE_MAX_BYTES),
  contentType: z.string().max(200).nullable(),
  contractId: optionalContract,
});

export async function addClientLinkFile(slug: string, clientId: string, input: z.input<typeof linkSchema>): Promise<ActionResult<{ id: string }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const parsed = linkSchema.safeParse(input);
  if (!parsed.success) return invalidInput();
  const supabase = await createClient();
  const client = await clientOfOrg(supabase, ctx.org.id, clientId);
  if (typeof client !== "string") return client;
  try {
    const id = await addClientLink(supabase, ctx.org.id, client, parsed.data);
    revalidateClient(ctx.org.slug, client);
    return { ok: true, id };
  } catch (error) {
    return describe(error, "addClientLinkFile");
  }
}

/** Primer paso de una subida: la URL firmada con la que el navegador sube el fichero a Storage. */
export async function prepareClientFileUpload(
  slug: string,
  clientId: string,
  input: z.input<typeof uploadSchema>,
): Promise<ActionResult<{ fileId: string; path: string; token: string }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const parsed = uploadSchema.safeParse(input);
  if (!parsed.success) {
    return parsed.error.issues.some((i) => i.path[0] === "sizeBytes") ? failure("portal.errors.fileTooLarge") : invalidInput();
  }
  const supabase = await createClient();
  const client = await clientOfOrg(supabase, ctx.org.id, clientId);
  if (typeof client !== "string") return client;
  try {
    return { ok: true, ...(await prepareClientUpload(supabase, ctx.org.id, client, parsed.data)) };
  } catch (error) {
    return describe(error, "prepareClientFileUpload");
  }
}

/** Segundo paso: el fichero ya está en Storage y pasa a verse en el portal. */
export async function confirmClientFileUpload(slug: string, clientId: string, fileId: string): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const file = idSchema.safeParse(fileId);
  if (!file.success) return invalidInput();
  const supabase = await createClient();
  const client = await clientOfOrg(supabase, ctx.org.id, clientId);
  if (typeof client !== "string") return client;
  try {
    await confirmClientUpload(supabase, ctx.org.id, client, file.data);
    revalidateClient(ctx.org.slug, client);
    return { ok: true };
  } catch (error) {
    return describe(error, "confirmClientFileUpload");
  }
}

export async function deleteClientFile(slug: string, clientId: string, fileId: string): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const file = idSchema.safeParse(fileId);
  if (!file.success) return invalidInput();
  const supabase = await createClient();
  const client = await clientOfOrg(supabase, ctx.org.id, clientId);
  if (typeof client !== "string") return client;
  try {
    await removeClientFile(supabase, ctx.org.id, client, file.data);
    revalidateClient(ctx.org.slug, client);
    return { ok: true };
  } catch (error) {
    return describe(error, "deleteClientFile");
  }
}
