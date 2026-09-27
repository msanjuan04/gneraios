"use server";

import { revalidatePath } from "next/cache";
import {
  type MandateFormInput,
  mandateFormSchema,
  type RevokeMandateInput,
  revokeMandateSchema,
} from "@/app/[org]/invoices/remittances/schema";
import { normalizeBic, normalizeMandateReference } from "@/domain/collections";
import { normalizeIban } from "@/domain/tax-id";
import type { ActionResult } from "@/lib/action-result";
import { nowInZone } from "@/lib/clock";
import { createClient } from "@/lib/supabase/server";
import { emptyToNull } from "@/lib/validation/fiscal";
import { failure, forbidden, idSchema, invalidInput, partnerContext } from "@/server/action-utils";
import { collectionsFailure } from "./errors";

/** La ficha del cliente y las remesas (sus candidatas dependen de los mandatos). */
function revalidateMandates(slug: string, clientId: string) {
  revalidatePath(`/${slug}/clients/${clientId}`);
  revalidatePath(`/${slug}/invoices/remittances`);
}

/**
 * Registra un mandato firmado (o corrige uno que aún no se ha usado en ninguna remesa). Un
 * mandato usado no cambia sus datos: se revoca y se registra otro (lo impide la base de datos).
 */
export async function saveClientMandate(
  slug: string,
  clientId: string,
  mandateId: string | null,
  input: MandateFormInput,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const client = idSchema.safeParse(clientId);
  const mandate = mandateId === null ? null : idSchema.safeParse(mandateId);
  const parsed = mandateFormSchema(nowInZone(ctx.org.timezone).date).safeParse(input);
  if (!client.success || (mandate && !mandate.success) || !parsed.success) return invalidInput();
  const v = parsed.data;
  const values = {
    issuer_id: v.issuer_id,
    reference: normalizeMandateReference(v.reference),
    debtor_name: v.debtor_name,
    iban: normalizeIban(v.iban),
    bic: v.bic ? normalizeBic(v.bic) : null,
    signed_on: v.signed_on,
    notes: emptyToNull(v.notes),
  };

  const supabase = await createClient();
  const result = mandate
    ? await supabase
        .from("client_mandates")
        .update(values)
        .eq("org_id", ctx.org.id)
        .eq("client_id", client.data)
        .eq("id", mandate.data)
        .select("id")
        .maybeSingle()
    : await supabase
        .from("client_mandates")
        .insert({ ...values, org_id: ctx.org.id, client_id: client.data })
        .select("id")
        .single();
  if (result.error) return collectionsFailure(result.error, "saveClientMandate");
  if (!result.data) return failure("collections.errors.mandateNotFound");
  revalidateMandates(ctx.org.slug, client.data);
  return { ok: true, id: result.data.id };
}

/** Revoca un mandato (el cliente lo ha cancelado, ha cambiado de banco…). Queda en el historial. */
export async function revokeClientMandate(slug: string, mandateId: string, input: RevokeMandateInput): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(mandateId);
  const parsed = revokeMandateSchema.safeParse(input);
  if (!id.success || !parsed.success) return invalidInput();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("client_mandates")
    .update({ revoked_at: new Date().toISOString(), revoke_reason: emptyToNull(parsed.data.reason) })
    .eq("org_id", ctx.org.id)
    .eq("id", id.data)
    .is("revoked_at", null)
    .select("client_id")
    .maybeSingle();
  if (error) return collectionsFailure(error, "revokeClientMandate");
  if (!data) return failure("collections.errors.mandateNotFound");
  revalidateMandates(ctx.org.slug, data.client_id);
  return { ok: true };
}

/** Borra un mandato registrado por error. Uno que ya ha ido en una remesa no se borra: se revoca. */
export async function deleteClientMandate(slug: string, mandateId: string): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(mandateId);
  if (!id.success) return invalidInput();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("client_mandates")
    .delete()
    .eq("org_id", ctx.org.id)
    .eq("id", id.data)
    .select("client_id")
    .maybeSingle();
  if (error) return collectionsFailure(error, "deleteClientMandate");
  if (!data) return failure("collections.errors.mandateNotFound");
  revalidateMandates(ctx.org.slug, data.client_id);
  return { ok: true };
}
