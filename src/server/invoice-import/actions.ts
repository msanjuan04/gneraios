"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { newClientDefaults } from "@/app/[org]/clients/schema";
import { saveClient } from "@/app/[org]/clients/actions";
import { addPayment } from "@/app/[org]/invoices/actions";
import type { PaymentFormInput } from "@/app/[org]/invoices/schema";
import type { CreatedClient, ExistingInvoice, ImportSetupData } from "@/components/invoice-import/types";
import { normalizeKey } from "@/domain/dataio/text";
import { classifyTaxId } from "@/domain/dataio/values";
import type { NewClientDraft } from "@/domain/invoice-import/form";
import { taxIdKey } from "@/domain/invoice-import/match";
import type { ActionResult } from "@/lib/action-result";
import { createClient } from "@/lib/supabase/server";
import { failure, forbidden, idSchema, invalidInput, partnerContext } from "@/server/action-utils";
import { DbError } from "@/server/billing/context";
import { claudeConfigured } from "./claude";
import { findByNumber } from "./existing";
import { loadImportSetup } from "./setup";

/**
 * Lo que necesita el panel de «Importar facturas emitidas» al abrirse: emisores, series, tipos,
 * clientes y, si se abre desde la ficha de un cliente (o un proyecto suyo), ese cliente. Solo socios.
 */
export async function getInvoiceImportSetup(slug: string, clientId: string | null): Promise<ActionResult<ImportSetupData>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const locked = clientId === null ? null : idSchema.safeParse(clientId);
  if (locked && !locked.success) return invalidInput();
  try {
    const setup = await loadImportSetup(await createClient(), ctx.org);
    const lockedClient = locked ? setup.clients.find((c) => c.id === locked.data) : null;
    if (locked && !lockedClient) return failure("invoiceImport.errors.clientNotFound");
    return { ok: true, setup, lockedClient: lockedClient ? { id: lockedClient.id, name: lockedClient.name } : null, claude: claudeConfigured() };
  } catch (error) {
    console.error("[invoice-import] setup", error instanceof DbError ? error.where : error);
    return failure("common.errorGeneric");
  }
}

/** ¿Hay ya una factura con este emisor y número? (Al cambiarlos en el formulario.) */
export async function checkExistingInvoice(slug: string, issuerId: string, number: string): Promise<ActionResult<{ existing: ExistingInvoice | null }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const issuer = idSchema.safeParse(issuerId);
  const value = z.string().trim().min(1).max(40).safeParse(number);
  if (!issuer.success || !value.success) return { ok: true, existing: null };
  try {
    return { ok: true, existing: await findByNumber(await createClient(), ctx.org.id, issuer.data, value.data) };
  } catch (error) {
    console.error("[invoice-import] existing", error instanceof DbError ? error.where : error);
    return failure("common.errorGeneric");
  }
}

const draftSchema = z.object({
  key: z.string().min(1).max(200),
  draft: z.object({
    name: z.string().trim().min(1).max(200),
    legalName: z.string().trim().max(200),
    taxId: z.string().trim().max(40),
    address: z.string().trim().max(200),
    postalCode: z.string().trim().max(12),
    city: z.string().trim().max(80),
    province: z.string().trim().max(80),
    countryCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/),
  }),
});

/**
 * Da de alta los clientes que faltan con los datos de sus facturas, por el mismo camino que la
 * ficha de clientes (saveClient: mismas validaciones, RLS y responsable = quien importa). Si ya
 * hay un cliente con ese NIF (o se crea en el mismo lote), se usa ese. Cada uno es independiente.
 */
export async function createClientsForImport(
  slug: string,
  drafts: { key: string; draft: NewClientDraft }[],
): Promise<ActionResult<{ results: CreatedClient[] }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const parsed = z.array(draftSchema).max(500).safeParse(drafts);
  if (!parsed.success) return invalidInput();
  const supabase = await createClient();
  const byIdentity = new Map<string, { clientId: string; name: string; created: boolean }>();
  const results: CreatedClient[] = [];

  for (const { key, draft } of parsed.data) {
    const taxKey = taxIdKey(draft.taxId);
    const identity = taxKey ? `nif:${taxKey}` : `name:${normalizeKey(draft.name)}`;
    const known = byIdentity.get(identity);
    if (known) {
      results.push({ key, ...known, created: false });
      continue;
    }
    const classified = draft.taxId ? classifyTaxId(draft.taxId, draft.countryCode) : null;
    if (classified && !classified.ok) {
      results.push({ key, error: (await failure("invoiceImport.errors.clientTaxId", { name: draft.name })).error });
      continue;
    }
    const taxId = classified?.ok ? classified.value : "";
    if (taxId) {
      const { data } = await supabase.from("clients").select("id, display_name").eq("org_id", ctx.org.id).eq("tax_id", taxId).is("archived_at", null).maybeSingle();
      if (data) {
        const found = { clientId: data.id, name: data.display_name, created: false };
        byIdentity.set(identity, found);
        results.push({ key, ...found });
        continue;
      }
    }
    const saved = await saveClient(slug, null, {
      ...newClientDefaults(ctx.member.id),
      display_name: draft.name,
      legal_name: draft.legalName,
      tax_id_kind: classified?.ok ? classified.kind : draft.countryCode === "ES" ? "es" : "foreign",
      tax_id: taxId,
      address_line: draft.address,
      postal_code: draft.postalCode,
      city: draft.city,
      province: draft.province,
      country_code: draft.countryCode,
    });
    if (!saved.ok) {
      results.push({ key, error: saved.error });
      continue;
    }
    const created = { clientId: saved.id, name: draft.name, created: true };
    byIdentity.set(identity, created);
    results.push({ key, ...created });
  }
  return { ok: true, results };
}

/**
 * Registra el cobro de una factura que ya estaba en la org (importada pendiente o emitida desde
 * GNERAI OS): exactamente lo mismo que «Registrar cobro» en la factura (addPayment: socio, factura
 * emitida, importe distinto de 0 y fecha no futura en la zona de la org). Vuelve a pintar además el
 * proyecto desde el que se importa.
 */
export async function recordImportPayment(
  slug: string,
  invoiceId: string,
  input: PaymentFormInput,
  opts: { projectId?: string | null } = {},
): Promise<ActionResult> {
  const result = await addPayment(slug, invoiceId, input);
  const project = opts.projectId ? idSchema.safeParse(opts.projectId) : null;
  if (result.ok && project?.success) revalidatePath(`/${slug}/projects/${project.data}`);
  return result;
}
