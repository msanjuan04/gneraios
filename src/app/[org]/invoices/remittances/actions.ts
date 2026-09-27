"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import type { RemittancePreview } from "@/components/collections/types";
import { checkRemittance, type ItemCheckInput, normalizeBic, normalizeCreditorId } from "@/domain/collections";
import { normalizeIban } from "@/domain/tax-id";
import type { ActionResult } from "@/lib/action-result";
import { nowInZone } from "@/lib/clock";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { emptyToNull } from "@/lib/validation/fiscal";
import { failure, forbidden, idSchema, invalidInput, ownerContext, partnerContext } from "@/server/action-utils";
import { loadCreditor } from "@/server/collections/creditors";
import { collectionsFailure } from "@/server/collections/errors";
import { composeRemittanceFile, type FileItem, localDateTime, remittanceFilePath } from "@/server/collections/generate";
import { loadSepaSources, type SepaSource } from "@/server/collections/sources";
import type { OrgContext } from "@/server/session";
import {
  type CreditorFormInput,
  creditorFormSchema,
  type RemittanceDraftInput,
  remittanceDraftSchema,
  type ReturnFormInput,
  returnFormSchema,
  type SettleFormInput,
  settleFormSchema,
} from "./schema";

type Supabase = Awaited<ReturnType<typeof createClient>>;

const BUCKET = "remittances";

/** Remesas, las facturas y clientes tocados y el dashboard (lo pendiente de cobro cambia). */
function revalidateCollections(slug: string, opts: { remittanceIds?: string[]; invoiceIds?: string[]; clientIds?: string[] } = {}) {
  revalidatePath(`/${slug}/invoices/remittances`);
  for (const id of new Set(opts.remittanceIds ?? [])) revalidatePath(`/${slug}/invoices/remittances/${id}`);
  if ((opts.invoiceIds ?? []).length > 0) revalidatePath(`/${slug}/invoices`);
  for (const id of new Set(opts.invoiceIds ?? [])) revalidatePath(`/${slug}/invoices/${id}`);
  for (const id of new Set(opts.clientIds ?? [])) revalidatePath(`/${slug}/clients/${id}`);
  revalidatePath(`/${slug}`);
}

const today = (ctx: OrgContext) => nowInZone(ctx.org.timezone).date;

/** Facturas y clientes de una remesa (para revalidar sus páginas). */
async function remittanceInvoices(supabase: Supabase, remittanceId: string) {
  const { data } = await supabase.from("sepa_remittance_items_overview").select("invoice_id, client_id").eq("remittance_id", remittanceId);
  return {
    invoiceIds: (data ?? []).flatMap((r) => (r.invoice_id ? [r.invoice_id] : [])),
    clientIds: (data ?? []).flatMap((r) => (r.client_id ? [r.client_id] : [])),
  };
}

// ---------------------------------------------------------------------------
// Datos de acreedor (owner)
// ---------------------------------------------------------------------------

/**
 * Guarda los datos de acreedor de un emisor. Lo que coincide con el emisor (razón social, IBAN) no
 * se guarda dos veces: queda vacío y se usa el del emisor. Confirmar el ICS lo firma quien lo hace.
 */
export async function saveCreditor(slug: string, issuerId: string, input: CreditorFormInput): Promise<ActionResult> {
  const ctx = await ownerContext(slug);
  if (!ctx) return forbidden();
  const issuer = idSchema.safeParse(issuerId);
  const parsed = creditorFormSchema.safeParse(input);
  if (!issuer.success || !parsed.success) return invalidInput();
  const v = parsed.data;
  const supabase = await createClient();
  const current = await loadCreditor(supabase, ctx.org.id, issuer.data);
  if (!current) return failure("collections.errors.issuerNotFound");

  const creditorId = emptyToNull(normalizeCreditorId(v.creditor_id));
  const iban = v.iban ? normalizeIban(v.iban) : null;
  const name = emptyToNull(v.name);
  const keepConfirmation =
    v.confirmed && current.stored.confirmedAt !== null && current.stored.creditorId === creditorId ? current.stored.confirmedAt : null;
  const { error } = await supabase.from("sepa_creditors").upsert(
    {
      org_id: ctx.org.id,
      issuer_id: issuer.data,
      creditor_identifier: creditorId,
      creditor_identifier_confirmed_at: v.confirmed && creditorId ? (keepConfirmation ?? new Date().toISOString()) : null,
      name: name && name !== current.issuerLegalName ? name : null,
      iban: iban && iban !== current.issuerIban ? iban : null,
      bic: emptyToNull(normalizeBic(v.bic)),
    },
    { onConflict: "issuer_id" },
  );
  if (error) return collectionsFailure(error, "saveCreditor");
  revalidateCollections(ctx.org.slug);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Borrador y vista previa
// ---------------------------------------------------------------------------

/**
 * Guarda la remesa en borrador con su selección completa de facturas. El id lo reserva la página
 * de alta: repetir el guardado (doble clic, reintento) no crea otra remesa.
 */
export async function saveRemittanceDraft(
  slug: string,
  input: RemittanceDraftInput,
): Promise<ActionResult<{ id: string; updatedAt: string }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const parsed = remittanceDraftSchema.safeParse(input);
  if (!parsed.success) return invalidInput();
  const v = parsed.data;
  const supabase = await createClient();
  const { data: id, error } = await supabase.rpc("sepa_save_remittance", {
    p: {
      remittance_id: v.remittance_id,
      expected_updated_at: v.expected_updated_at,
      issuer_id: v.issuer_id,
      collection_on: v.collection_on,
      notes: emptyToNull(v.notes),
      invoice_ids: v.invoice_ids,
    },
  });
  if (error) return collectionsFailure(error, "saveRemittanceDraft");
  const { data: fresh, error: reloadError } = await supabase.from("sepa_remittances").select("updated_at").eq("id", id).single();
  if (reloadError) return collectionsFailure(reloadError, "saveRemittanceDraft.reload");
  revalidateCollections(ctx.org.slug, { remittanceIds: [id] });
  return { ok: true, id, updatedAt: fresh.updated_at };
}

const previewSchema = z.object({
  remittance_id: z.guid(),
  issuer_id: z.guid(),
  collection_on: z.iso.date(),
  invoice_ids: z.array(z.guid()).min(1).max(500),
});

const toCheck = (s: SepaSource): ItemCheckInput => ({
  id: s.invoiceId,
  invoiceNumber: s.number,
  amountCents: s.outstandingCents,
  mandate: s.mandate,
});

/**
 * Vista previa del fichero con la selección actual, sin guardar nada. Sirve aunque el ICS aún no
 * esté confirmado (usa el guardado o el que sale del NIF) y deja fuera los recibos con problemas.
 */
export async function previewRemittance(
  slug: string,
  input: z.input<typeof previewSchema>,
): Promise<ActionResult<{ preview: RemittancePreview }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const parsed = previewSchema.safeParse(input);
  if (!parsed.success) return invalidInput();
  const v = parsed.data;
  const supabase = await createClient();
  try {
    const [creditor, sources] = await Promise.all([
      loadCreditor(supabase, ctx.org.id, v.issuer_id),
      loadSepaSources(supabase, ctx.org.id, v.issuer_id, { invoiceIds: v.invoice_ids, exceptRemittanceId: v.remittance_id }),
    ]);
    if (!creditor) return failure("collections.errors.issuerNotFound");
    const free = sources.filter((s) => s.otherRemittance === null);
    const check = checkRemittance({ today: today(ctx), collectionOn: v.collection_on, creditor: creditor.config, items: free.map(toCheck) });
    if (!check.canPreview || !check.creditor.creditorId || !check.creditor.source) return failure("collections.errors.previewUnavailable");

    const t = await getTranslations("collections.file");
    const items: FileItem[] = free.flatMap((s) =>
      !check.items[s.invoiceId] && s.mandate && s.number
        ? [{ itemId: s.invoiceId, invoiceNumber: s.number, amountCents: s.outstandingCents, mandate: s.mandate }]
        : [],
    );
    const file = composeRemittanceFile({
      remittanceId: v.remittance_id,
      collectionOn: v.collection_on,
      createdAt: localDateTime(new Date(), ctx.org.timezone),
      creditor: { creditorId: check.creditor.creditorId, name: creditor.config.name ?? "", iban: creditor.config.iban ?? "", bic: creditor.config.bic },
      items,
      remittanceInfo: (number) => t("remittanceInfo", { number }),
    });
    return {
      ok: true,
      preview: {
        xml: file.xml,
        creditorIdSource: check.creditor.source,
        included: items.length,
        excluded: v.invoice_ids.length - items.length,
        totalCents: file.totalCents,
      },
    };
  } catch (error) {
    console.error("[collections] previewRemittance", error);
    return failure("common.errorGeneric");
  }
}

// ---------------------------------------------------------------------------
// Generar, enviar, cobrar y devolver
// ---------------------------------------------------------------------------

const versionSchema = z.string().min(1).max(64).nullable();

/**
 * Genera el fichero de una remesa en borrador: comprueba todo (ICS confirmado, fecha, mandatos,
 * cuentas e importes), compone el pain.008, lo guarda en Storage y congela la remesa. Si la base de
 * datos ve que algo ha cambiado desde la comprobación, no congela nada y el fichero se descarta.
 */
export async function generateRemittance(
  slug: string,
  remittanceId: string,
  expectedUpdatedAt: string | null,
): Promise<ActionResult<{ messageId: string }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(remittanceId);
  const version = versionSchema.safeParse(expectedUpdatedAt);
  if (!id.success || !version.success) return invalidInput();
  const supabase = await createClient();

  const { data: remittance, error } = await supabase
    .from("sepa_remittances")
    .select("id, issuer_id, collection_on, status, updated_at")
    .eq("org_id", ctx.org.id)
    .eq("id", id.data)
    .maybeSingle();
  if (error) return collectionsFailure(error, "generateRemittance.load");
  if (!remittance) return failure("collections.errors.remittanceNotFound");
  if (remittance.status !== "draft") return failure("collections.errors.remittanceNotDraft");
  if (version.data && version.data !== remittance.updated_at) return failure("collections.errors.remittanceChanged");

  let uploaded: string | null = null;
  const admin = createAdminClient();
  try {
    const { data: rows, error: itemsError } = await supabase
      .from("sepa_remittance_items")
      .select("id, invoice_id")
      .eq("remittance_id", remittance.id);
    if (itemsError) return collectionsFailure(itemsError, "generateRemittance.items");
    const [creditor, sources] = await Promise.all([
      loadCreditor(supabase, ctx.org.id, remittance.issuer_id),
      loadSepaSources(supabase, ctx.org.id, remittance.issuer_id, {
        invoiceIds: rows.map((r) => r.invoice_id),
        exceptRemittanceId: remittance.id,
      }),
    ]);
    if (!creditor) return failure("collections.errors.issuerNotFound");
    const byInvoice = new Map(sources.map((s) => [s.invoiceId, s]));
    if (sources.length !== rows.length || sources.some((s) => s.otherRemittance !== null)) {
      return failure("collections.errors.remittanceChanged");
    }

    const check = checkRemittance({
      today: today(ctx),
      collectionOn: remittance.collection_on,
      creditor: creditor.config,
      items: sources.map(toCheck),
    });
    if (!check.canGenerate || check.creditor.source !== "confirmed" || !check.creditor.creditorId) {
      return failure(
        check.creditor.source !== "confirmed" ? "collections.errors.creditorUnconfirmed" : "collections.errors.cannotGenerate",
      );
    }

    const t = await getTranslations("collections.file");
    const items: FileItem[] = rows.map((r) => {
      const s = byInvoice.get(r.invoice_id)!;
      return { itemId: r.id, invoiceNumber: s.number!, amountCents: s.outstandingCents, mandate: s.mandate! };
    });
    const now = new Date();
    const file = composeRemittanceFile({
      remittanceId: remittance.id,
      collectionOn: remittance.collection_on,
      createdAt: localDateTime(now, ctx.org.timezone),
      creditor: { creditorId: check.creditor.creditorId, name: creditor.config.name!, iban: creditor.config.iban!, bic: creditor.config.bic },
      items,
      remittanceInfo: (number) => t("remittanceInfo", { number }),
    });

    const path = remittanceFilePath(ctx.org.id, remittance.id, file.messageId);
    const { error: uploadError } = await admin.storage
      .from(BUCKET)
      .upload(path, new TextEncoder().encode(file.xml), { contentType: "application/xml", upsert: true });
    if (uploadError) {
      console.error("[collections] generateRemittance.upload", uploadError);
      return failure("collections.errors.fileFailed");
    }
    uploaded = path;

    const { error: freezeError } = await supabase.rpc("sepa_mark_generated", {
      p: {
        remittance_id: remittance.id,
        expected_updated_at: remittance.updated_at,
        message_id: file.messageId,
        generated_at: now.toISOString(),
        file_path: path,
        creditor: { creditor_id: file.creditor.creditorId, name: file.creditor.name, iban: file.creditor.iban, bic: file.creditor.bic },
        items: file.items,
      } satisfies Json,
    });
    if (freezeError) return await collectionsFailure(freezeError, "generateRemittance.freeze");
    uploaded = null;

    revalidateCollections(ctx.org.slug, { remittanceIds: [remittance.id] });
    return { ok: true, messageId: file.messageId };
  } catch (error) {
    console.error("[collections] generateRemittance", error);
    return failure("common.errorGeneric");
  } finally {
    // Lo que no ha llegado a congelarse no es la copia de nada: fuera de Storage.
    if (uploaded) await admin.storage.from(BUCKET).remove([uploaded]);
  }
}

/** Una remesa generada que aún no se ha enviado vuelve a borrador; su fichero se descarta. */
export async function revertRemittanceToDraft(slug: string, remittanceId: string): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(remittanceId);
  if (!id.success) return invalidInput();
  const supabase = await createClient();
  const { data: path, error } = await supabase.rpc("sepa_revert_to_draft", { p_remittance_id: id.data });
  if (error) return collectionsFailure(error, "revertRemittanceToDraft");
  if (path) {
    const { error: removeError } = await createAdminClient().storage.from(BUCKET).remove([path]);
    if (removeError) console.error("[collections] revertRemittanceToDraft.remove", removeError);
  }
  revalidateCollections(ctx.org.slug, { remittanceIds: [id.data] });
  return { ok: true };
}

/** El socio ha subido el fichero al banco. */
export async function markRemittanceSent(slug: string, remittanceId: string): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(remittanceId);
  if (!id.success) return invalidInput();
  const supabase = await createClient();
  const { error } = await supabase.rpc("sepa_mark_sent", { p_remittance_id: id.data });
  if (error) return collectionsFailure(error, "markRemittanceSent");
  revalidateCollections(ctx.org.slug, { remittanceIds: [id.data] });
  return { ok: true };
}

/** «Marcar cobrada»: un cobro por cada recibo no devuelto, de una vez y una sola vez. */
export async function settleRemittance(
  slug: string,
  remittanceId: string,
  input: SettleFormInput,
): Promise<ActionResult<{ created: number }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(remittanceId);
  const parsed = settleFormSchema(today(ctx)).safeParse(input);
  if (!id.success || !parsed.success) return invalidInput();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("sepa_settle_remittance", {
    p_remittance_id: id.data,
    p_settled_on: parsed.data.settled_on,
  });
  if (error) return collectionsFailure(error, "settleRemittance");
  revalidateCollections(ctx.org.slug, { remittanceIds: [id.data], ...(await remittanceInvoices(supabase, id.data)) });
  return { ok: true, created: data };
}

/** Devolución de un recibo: su factura vuelve a quedar pendiente, con el motivo. */
export async function returnRemittanceItem(slug: string, itemId: string, input: ReturnFormInput): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(itemId);
  const parsed = returnFormSchema(today(ctx)).safeParse(input);
  if (!id.success || !parsed.success) return invalidInput();
  const supabase = await createClient();
  const { error } = await supabase.rpc("sepa_return_item", {
    p_item_id: id.data,
    p_returned_on: parsed.data.returned_on,
    p_code: emptyToNull(parsed.data.code) ?? undefined,
    p_reason: emptyToNull(parsed.data.reason) ?? undefined,
  });
  if (error) return collectionsFailure(error, "returnRemittanceItem");
  await revalidateItem(supabase, ctx.org.slug, id.data);
  return { ok: true };
}

/** Deshace una devolución registrada por error. */
export async function undoRemittanceReturn(slug: string, itemId: string): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(itemId);
  if (!id.success) return invalidInput();
  const supabase = await createClient();
  const { error } = await supabase.rpc("sepa_undo_return", { p_item_id: id.data });
  if (error) return collectionsFailure(error, "undoRemittanceReturn");
  await revalidateItem(supabase, ctx.org.slug, id.data);
  return { ok: true };
}

async function revalidateItem(supabase: Supabase, slug: string, itemId: string) {
  const { data } = await supabase
    .from("sepa_remittance_items_overview")
    .select("remittance_id, invoice_id, client_id")
    .eq("id", itemId)
    .maybeSingle();
  revalidateCollections(slug, {
    remittanceIds: data?.remittance_id ? [data.remittance_id] : [],
    invoiceIds: data?.invoice_id ? [data.invoice_id] : [],
    clientIds: data?.client_id ? [data.client_id] : [],
  });
}

/**
 * Borra una remesa que aún no se ha enviado (en borrador o con su fichero generado). No revalida su
 * página: volvería a pintarla ya borrada (un 404) antes de que el cliente navegue al listado.
 */
export async function deleteRemittance(slug: string, remittanceId: string): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(remittanceId);
  if (!id.success) return invalidInput();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sepa_remittances")
    .delete()
    .eq("org_id", ctx.org.id)
    .eq("id", id.data)
    .in("status", ["draft", "generated"])
    .select("file_path");
  if (error) return collectionsFailure(error, "deleteRemittance");
  if (data.length === 0) return failure("collections.errors.remittanceLocked");
  const path = data[0]?.file_path;
  if (path) {
    const { error: removeError } = await createAdminClient().storage.from(BUCKET).remove([path]);
    if (removeError) console.error("[collections] deleteRemittance.remove", removeError);
  }
  revalidatePath(`/${ctx.org.slug}/invoices/remittances`);
  return { ok: true };
}
