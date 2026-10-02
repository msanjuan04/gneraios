import { z } from "zod";
import { ORG_DOCUMENT_CATEGORIES, ORG_DOCUMENT_STATUSES } from "@/domain/company/types";
import { requiredText, text } from "@/lib/validation/fiscal";

// Formulario de un documento del expediente de la sociedad (subida y edición). Sin React ni Supabase.

const optionalDate = z.union([z.iso.date("date"), z.literal("")]);
const optionalId = z.union([z.guid(), z.literal("")]);

export const companyDocumentSchema = z.object({
  title: requiredText(200),
  category: z.enum(ORG_DOCUMENT_CATEGORIES),
  status: z.enum(ORG_DOCUMENT_STATUSES),
  effective_on: optionalDate.default(""),
  member_id: optionalId.default(""),
  description: text(5000).default(""),
});
export type CompanyDocumentInput = z.input<typeof companyDocumentSchema>;
export type CompanyDocumentValues = z.output<typeof companyDocumentSchema>;
