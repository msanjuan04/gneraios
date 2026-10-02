"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { createClient } from "@/lib/supabase/server";
import { dbFailure, failure, forbidden, idSchema, invalidInput, ownerContext, partnerContext } from "@/server/action-utils";
import { type CompanyDocumentInput, companyDocumentSchema } from "./company-schema";

// Expediente de la sociedad: la ficha de cada documento (título, categoría, estado, fecha, socio)
// la cambia un socio; el fichero no se toca (otro fichero = otro documento). Archivar es de owner.

const revalidate = (slug: string) => revalidatePath(`/${slug}/finance/company`);

export async function updateCompanyDocument(slug: string, documentId: string, input: CompanyDocumentInput): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(documentId);
  const parsed = companyDocumentSchema.safeParse(input);
  if (!id.success || !parsed.success) return invalidInput();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("org_documents")
    .update({
      title: parsed.data.title,
      category: parsed.data.category,
      status: parsed.data.status,
      effective_on: parsed.data.effective_on || null,
      member_id: parsed.data.member_id || null,
      description: parsed.data.description || null,
    })
    .eq("org_id", ctx.org.id)
    .eq("id", id.data)
    .is("archived_at", null)
    .select("id")
    .maybeSingle();
  if (error) return dbFailure(error, "updateCompanyDocument");
  if (!data) return failure("finance.company.errors.notFound");
  revalidate(ctx.org.slug);
  return { ok: true };
}

/** Archivar: desaparece del expediente; el fichero se conserva (nunca se borra un documento legal). */
export async function archiveCompanyDocument(slug: string, documentId: string): Promise<ActionResult> {
  const ctx = await ownerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(documentId);
  if (!id.success) return invalidInput();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("org_documents")
    .update({ archived_at: new Date().toISOString() })
    .eq("org_id", ctx.org.id)
    .eq("id", id.data)
    .is("archived_at", null)
    .select("id")
    .maybeSingle();
  if (error) return dbFailure(error, "archiveCompanyDocument");
  if (!data) return failure("finance.company.errors.notFound");
  revalidate(ctx.org.slug);
  return { ok: true };
}
