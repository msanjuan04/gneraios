import "server-only";
import { lineFormDefaults, planFormDefaults, type QuoteFormInput, readStoredPlan } from "@/app/[org]/quotes/schema";
import { readTemplateLines, templateAmounts, type TemplateLine } from "@/app/[org]/quotes/template-schema";
import type { QuoteFormOptions, QuoteTemplateItem } from "@/components/quotes/types";
import type { Tables } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

/** Lecturas de plantillas de presupuesto (RLS: cualquier miembro lee). */

type Supabase = Awaited<ReturnType<typeof createClient>>;
type Row = Tables<"quote_templates">;

const COLUMNS = "id, name, category, summary, title, language, notes, lines, payment_plan, uses_count, updated_at";

function toItem(row: Pick<Row, "id" | "name" | "category" | "summary" | "title" | "language" | "notes" | "lines" | "payment_plan" | "uses_count" | "updated_at">): QuoteTemplateItem {
  const lines = readTemplateLines(row.lines);
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    summary: row.summary,
    title: row.title,
    language: row.language,
    notes: row.notes,
    lines,
    plan: readStoredPlan(row.payment_plan),
    usesCount: row.uses_count,
    updatedAt: row.updated_at,
    amounts: templateAmounts(lines),
  };
}

/** Las plantillas vivas de la org, por categoría y nombre. */
export async function listQuoteTemplates(supabase: Supabase, orgId: string): Promise<QuoteTemplateItem[]> {
  const { data, error } = await supabase
    .from("quote_templates")
    .select(COLUMNS)
    .eq("org_id", orgId)
    .is("archived_at", null)
    .order("category")
    .order("name");
  if (error) throw error;
  return (data ?? []).map(toItem);
}

/** Una plantilla viva de la org; null si no existe (o está archivada). */
export async function getQuoteTemplate(supabase: Supabase, orgId: string, id: string): Promise<QuoteTemplateItem | null> {
  const { data, error } = await supabase.from("quote_templates").select(COLUMNS).eq("org_id", orgId).eq("id", id).is("archived_at", null).maybeSingle();
  if (error) throw error;
  return data ? toItem(data) : null;
}

/**
 * Lo que una plantilla aporta a un presupuesto nuevo: título, idioma, notas, líneas (copiadas, con
 * ids nuevos) y plan. Un tipo de IVA que ya no exista en la org cae al de por defecto.
 */
export function templateDefaults(
  template: QuoteTemplateItem,
  options: QuoteFormOptions,
  newId: () => string,
): Pick<QuoteFormInput, "title" | "language" | "notes" | "lines" | "plan"> {
  const vatIds = new Set(options.vatRates.filter((rate) => !rate.archived).map((rate) => rate.id));
  const vatFor = (line: TemplateLine) => (line.tax_rate_id && vatIds.has(line.tax_rate_id) ? line.tax_rate_id : (options.defaultVatRateId ?? ""));
  return {
    title: template.title ?? template.name,
    language: template.language,
    notes: template.notes ?? "",
    lines: template.lines.map((line) =>
      lineFormDefaults({
        id: newId(),
        billingType: line.billing_type,
        description: line.description,
        quantity: line.quantity,
        unitPriceCents: line.unit_price_cents,
        discountBps: line.discount_bps,
        taxRateId: vatFor(line),
        irpfApplies: line.irpf_applies,
        startsOn: null,
        endsOn: null,
        billingDay: line.billing_day,
      }),
    ),
    plan: planFormDefaults(template.plan),
  };
}
