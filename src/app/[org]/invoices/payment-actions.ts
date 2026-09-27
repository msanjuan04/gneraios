"use server";

import { revalidatePath } from "next/cache";
import { parseMoneyInput } from "@/domain/money";
import type { ActionResult } from "@/lib/action-result";
import { nowInZone } from "@/lib/clock";
import { createClient } from "@/lib/supabase/server";
import { emptyToNull } from "@/lib/validation/fiscal";
import { failure, forbidden, idSchema, invalidInput, partnerContext } from "@/server/action-utils";
import { billingFailure } from "@/server/billing/errors";
import { getPayableInvoices, type PayableInvoice } from "@/server/invoices/payables";
import { type ClientPaymentInput, clientPaymentSchema } from "./schema";

// «Registrar cobro» desde la ficha del cliente o desde un proyecto suyo: se eligen las facturas
// pendientes que paga el cobro y se registran todas a la vez. En la propia factura sigue estando
// su tarjeta de cobros (parciales, devoluciones y borrado).

/**
 * Al abrir el panel: las facturas pendientes del cliente, sus proyectos (para un cobro sin
 * factura) y el día de hoy en la org.
 */
export async function loadPaymentContext(
  slug: string,
  clientId: string,
): Promise<ActionResult<{ invoices: PayableInvoice[]; projects: { id: string; name: string }[]; today: string }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(clientId);
  if (!id.success) return invalidInput();
  try {
    const supabase = await createClient();
    const [invoices, projects] = await Promise.all([
      getPayableInvoices(ctx.org.id, id.data),
      supabase.from("projects").select("id, name").eq("org_id", ctx.org.id).eq("client_id", id.data).is("archived_at", null).order("name"),
    ]);
    if (projects.error) throw projects.error;
    return { ok: true, invoices, projects: projects.data, today: nowInZone(ctx.org.timezone).date };
  } catch (error) {
    console.error("[invoices] loadPaymentContext", error);
    return failure("common.errorGeneric");
  }
}

/**
 * Registra un cobro repartido entre una o varias facturas emitidas del cliente: una fila de
 * `payments` por factura, con la misma fecha (el día en que entró el dinero), método y
 * referencia, en un solo insert (o todas o ninguna).
 */
export async function recordClientPayment(
  slug: string,
  clientId: string,
  input: ClientPaymentInput,
  context: { projectId?: string } = {},
): Promise<ActionResult<{ count: number; totalCents: number }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const client = idSchema.safeParse(clientId);
  const project = context.projectId === undefined ? null : idSchema.safeParse(context.projectId);
  const parsed = clientPaymentSchema(nowInZone(ctx.org.timezone).date).safeParse(input);
  if (!client.success || !parsed.success || (project && !project.success)) return invalidInput();

  const supabase = await createClient();
  const ids = parsed.data.allocations.map((a) => a.invoice_id);
  const { data: invoices, error } = await supabase
    .from("invoices")
    .select("id, client_id, lifecycle, kind")
    .eq("org_id", ctx.org.id)
    .in("id", ids);
  if (error) return billingFailure(error, "recordClientPayment.load");
  if (invoices.length !== ids.length || invoices.some((i) => i.client_id !== client.data)) return failure("invoices.errors.notFound");
  if (invoices.some((i) => i.lifecycle !== "issued")) return failure("billing.errors.paymentNotIssued");
  if (invoices.some((i) => i.kind !== "ordinary")) return failure("invoices.errors.paymentNotOrdinary");

  const rows = parsed.data.allocations.map((a) => ({
    org_id: ctx.org.id,
    invoice_id: a.invoice_id,
    amount_cents: parseMoneyInput(a.amount)!,
    paid_on: parsed.data.paid_on,
    method: parsed.data.method,
    reference: emptyToNull(parsed.data.reference),
  }));
  const { error: insertError } = await supabase.from("payments").insert(rows);
  if (insertError) return billingFailure(insertError, "recordClientPayment");

  revalidatePath(`/${ctx.org.slug}/invoices`);
  for (const id of ids) revalidatePath(`/${ctx.org.slug}/invoices/${id}`);
  revalidatePath(`/${ctx.org.slug}/clients/${client.data}`);
  if (project?.success) revalidatePath(`/${ctx.org.slug}/projects/${project.data}`);
  revalidatePath(`/${ctx.org.slug}`);
  return { ok: true, count: rows.length, totalCents: rows.reduce((sum, r) => sum + r.amount_cents, 0) };
}
