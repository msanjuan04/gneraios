import { z } from "zod";
import { CATALOG_CATEGORIES, type CatalogCategory } from "@/domain/catalog";
import { requiredText, text } from "@/lib/validation/fiscal";
import { QUOTE_BILLING_TYPES, type QuoteBillingType, quoteLineBaseCents } from "./summary";

// Plantillas de presupuesto (supabase/migrations/20261002160000_plantillas_presupuesto.sql): el
// formulario de la ficha (nombre, categoría, textos) y la forma de las líneas guardadas en jsonb.
// Sin React ni Supabase: lo usan el servidor, las acciones y los componentes.

export type { CatalogCategory };

export const templateFormSchema = z.object({
  name: requiredText(120),
  category: z.enum(CATALOG_CATEGORIES),
  summary: text(1000),
  title: text(200),
  notes: text(10_000),
});
export type TemplateFormInput = z.input<typeof templateFormSchema>;
export type TemplateFormValues = z.output<typeof templateFormSchema>;

/** «Guardar como plantilla» desde un presupuesto: la ficha y, opcionalmente, la plantilla que sustituye. */
export const saveAsTemplateSchema = z.object({
  name: requiredText(120),
  category: z.enum(CATALOG_CATEGORIES),
  summary: text(1000),
  replace_id: z.union([z.guid(), z.literal("")]).default(""),
});
export type SaveAsTemplateInput = z.input<typeof saveAsTemplateSchema>;

/** Una línea tal y como se guarda en quote_templates.lines. */
export const templateLineSchema = z.object({
  description: z.string().trim().min(1).max(500),
  billing_type: z.enum(QUOTE_BILLING_TYPES),
  quantity: z.union([z.number().positive(), z.string().min(1)]),
  unit_price_cents: z.number().int().min(0),
  discount_bps: z.number().int().min(0).max(10_000).default(0),
  /** Null: el IVA por defecto de la org al usarla (el tipo puede haberse archivado). */
  tax_rate_id: z.string().nullable().default(null),
  irpf_applies: z.boolean().default(true),
  billing_day: z.number().int().min(1).max(31).nullable().default(null),
});
export type TemplateLine = z.output<typeof templateLineSchema>;

/** Las líneas guardadas (jsonb) → líneas válidas. Lo que no tenga la forma esperada se descarta. */
export function readTemplateLines(value: unknown): TemplateLine[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const parsed = templateLineSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

export type TemplateAmounts = { oneOffCents: number; monthlyCents: number; yearlyCents: number; usageCount: number };

/** Base (sin IVA) de una línea, con el redondeo del dominio (el mismo que el editor de presupuestos). */
export function templateLineBaseCents(line: TemplateLine): number {
  try {
    return quoteLineBaseCents({ quantity: line.quantity, unitPriceCents: line.unit_price_cents, discountBps: line.discount_bps });
  } catch {
    return 0;
  }
}

/** Totales «desde» de una plantilla, por tipo y sin mezclar (como el listado de presupuestos). */
export function templateAmounts(lines: readonly TemplateLine[]): TemplateAmounts {
  const amounts: TemplateAmounts = { oneOffCents: 0, monthlyCents: 0, yearlyCents: 0, usageCount: 0 };
  for (const line of lines) {
    const type: QuoteBillingType = line.billing_type;
    if (type === "one_off") amounts.oneOffCents += templateLineBaseCents(line);
    else if (type === "monthly") amounts.monthlyCents += templateLineBaseCents(line);
    else if (type === "yearly") amounts.yearlyCents += templateLineBaseCents(line);
    else amounts.usageCount += 1;
  }
  return amounts;
}
