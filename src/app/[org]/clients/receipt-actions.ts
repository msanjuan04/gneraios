"use server";

import { revalidatePath } from "next/cache";
import { parseMoneyInput } from "@/domain/money";
import type { ActionResult } from "@/lib/action-result";
import { nowInZone } from "@/lib/clock";
import { createClient } from "@/lib/supabase/server";
import { dbFailure, failure, forbidden, idSchema, invalidInput, partnerContext } from "@/server/action-utils";
import { type ClientReceiptInput, clientReceiptSchema } from "./schema";

// Cobros sin factura (client_receipts): lo que paga un cliente mientras no se factura desde
// GNERAI OS. Los registra un socio desde la ficha del cliente o desde un proyecto suyo.

/** La ficha del cliente, el proyecto (si lo hay), el histórico de Facturas y el dashboard. */
function revalidateReceipt(slug: string, clientId: string, projectIds: (string | null | undefined)[] = []) {
  revalidatePath(`/${slug}/clients/${clientId}`);
  for (const id of new Set(projectIds.filter(Boolean))) revalidatePath(`/${slug}/projects/${id}`);
  revalidatePath(`/${slug}/invoices/history`);
  revalidatePath(`/${slug}`);
}

const receiptHint = (error: { hint?: string | null }) =>
  error.hint === "receipt_project_client" ? "clients.collections.errors.projectClient" : undefined;

/** Crea (sin id) o corrige un cobro sin factura. */
export async function saveClientReceipt(
  slug: string,
  clientId: string,
  input: ClientReceiptInput,
  receiptId: string | null = null,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const client = idSchema.safeParse(clientId);
  const receipt = receiptId === null ? null : idSchema.safeParse(receiptId);
  const parsed = clientReceiptSchema(nowInZone(ctx.org.timezone).date).safeParse(input);
  if (!client.success || !parsed.success || (receipt && !receipt.success)) return invalidInput();

  const values = {
    received_on: parsed.data.received_on,
    amount_cents: parseMoneyInput(parsed.data.amount)!,
    method: parsed.data.method,
    concept: parsed.data.concept,
    reference: parsed.data.reference || null,
    project_id: parsed.data.project_id || null,
    notes: parsed.data.notes || null,
  };
  const supabase = await createClient();

  if (receipt?.success) {
    const { data: before } = await supabase
      .from("client_receipts")
      .select("project_id")
      .eq("org_id", ctx.org.id)
      .eq("id", receipt.data)
      .maybeSingle();
    const { data, error } = await supabase
      .from("client_receipts")
      .update(values)
      .eq("org_id", ctx.org.id)
      .eq("client_id", client.data)
      .eq("id", receipt.data)
      .select("id");
    if (error) return dbFailure(error, "saveClientReceipt.update", receiptHint);
    if (data.length === 0) return failure("clients.collections.errors.notFound");
    revalidateReceipt(ctx.org.slug, client.data, [before?.project_id, values.project_id]);
    return { ok: true, id: receipt.data };
  }

  const { data, error } = await supabase
    .from("client_receipts")
    .insert({ org_id: ctx.org.id, client_id: client.data, ...values })
    .select("id")
    .single();
  if (error) return dbFailure(error, "saveClientReceipt.insert", receiptHint);
  revalidateReceipt(ctx.org.slug, client.data, [values.project_id]);
  return { ok: true, id: data.id };
}

export async function deleteClientReceipt(slug: string, clientId: string, receiptId: string): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const client = idSchema.safeParse(clientId);
  const receipt = idSchema.safeParse(receiptId);
  if (!client.success || !receipt.success) return invalidInput();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("client_receipts")
    .delete()
    .eq("org_id", ctx.org.id)
    .eq("client_id", client.data)
    .eq("id", receipt.data)
    .select("id, project_id");
  if (error) return dbFailure(error, "deleteClientReceipt");
  if (data.length === 0) return failure("clients.collections.errors.notFound");
  revalidateReceipt(ctx.org.slug, client.data, [data[0]?.project_id]);
  return { ok: true };
}
