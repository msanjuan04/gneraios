"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseReportMonth } from "@/domain/reports";
import type { ActionResult } from "@/lib/action-result";
import { createClient } from "@/lib/supabase/server";
import { dbFailure, type Failure, failure, forbidden, idSchema, invalidInput, partnerContext } from "@/server/action-utils";
import { BillingRuleError, DbError } from "@/server/billing/context";
import { prepareReportEmail } from "./email";

/**
 * Acciones del informe mensual. Con la sesión del socio: la RLS vuelve a comprobar que puede
 * escribir en outbound_emails de su org.
 */

const optionsSchema = z.object({ includeHours: z.boolean().optional() }).strict();

async function describe(error: unknown, where: string): Promise<Failure> {
  if (error instanceof BillingRuleError) return failure(error.key);
  if (error instanceof DbError) return dbFailure(error.error, error.where);
  console.error(`[reports] ${where}`, error);
  return failure("common.errorGeneric");
}

/**
 * «Preparar email»: deja el informe del mes (`month` = "2026-08") en Facturas → Por enviar, en el
 * idioma del cliente y para sus contactos de facturación, para que un socio lo revise y lo envíe.
 * El PDF se genera al enviarlo. Si ya había uno por revisar de ese mes, devuelve ese.
 */
export async function prepareClientReportEmail(
  slug: string,
  clientId: string,
  month: string,
  options: { includeHours?: boolean } = {},
): Promise<ActionResult<{ emailId: string; existing: boolean; recipients: number }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(clientId);
  const reportMonth = parseReportMonth(month);
  const opts = optionsSchema.safeParse(options);
  if (!id.success || !reportMonth || !opts.success) return invalidInput();
  const supabase = await createClient();
  try {
    const prepared = await prepareReportEmail(supabase, {
      orgId: ctx.org.id,
      clientId: id.data,
      month: reportMonth,
      includeHours: opts.data.includeHours ?? false,
    });
    if (!prepared) return failure("reports.errors.clientNotFound");
    revalidatePath(`/${ctx.org.slug}/invoices/outbox`);
    revalidatePath(`/${ctx.org.slug}/invoices`);
    revalidatePath(`/${ctx.org.slug}/clients/${id.data}`);
    revalidatePath(`/${ctx.org.slug}`);
    return { ok: true, ...prepared };
  } catch (error) {
    return describe(error, "prepareClientReportEmail");
  }
}
