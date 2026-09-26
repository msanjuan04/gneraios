import { z } from "zod";
import type { Tables } from "@/lib/supabase/database.types";
import { percentToBps, requiredText, taxRateSchema, text } from "@/lib/validation/fiscal";

export const VAT_REGIMES = ["general", "exempt", "reverse_charge_eu", "not_subject"] as const;

/**
 * Tipo de impuesto como se escribe en el formulario: el tipo en porcentaje ("21",
 * "15,5"), que se guarda en puntos básicos. Las reglas de régimen son las compartidas.
 */
export const taxRateFormSchema = z
  .object({
    kind: z.enum(["vat", "irpf"]),
    name: requiredText(80),
    rate_bps: z
      .string()
      .trim()
      .min(1, "required")
      .transform((value, ctx) => {
        const bps = percentToBps.safeParse(value);
        if (bps.success) return bps.data;
        ctx.addIssue({ code: "custom", message: "rate" });
        return z.NEVER;
      }),
    regime: z.enum(VAT_REGIMES).nullable(),
    legal_note: text(300),
    is_default: z.boolean(),
  })
  .superRefine((values, ctx) => {
    // Mismo requisito que la base de datos, con un mensaje más claro que "entre 0 y 100".
    if (values.kind === "vat" && values.regime !== null && values.regime !== "general" && values.rate_bps !== 0) {
      ctx.addIssue({ code: "custom", path: ["rate_bps"], message: "rateNotGeneral" });
    }
  })
  .transform((values) => ({ ...values, include: true }))
  .pipe(taxRateSchema);

export type TaxRateFormInput = z.input<typeof taxRateFormSchema>;
export type TaxRateFormValues = z.output<typeof taxRateFormSchema>;

export type TaxRateRow = Pick<
  Tables<"tax_rates">,
  "id" | "kind" | "name" | "rate_bps" | "regime" | "legal_note" | "is_default"
>;

/** 2100 → "21", 1550 → "15,5": lo que escribiría el usuario. */
function bpsToPercentInput(bps: number): string {
  return (bps / 100).toLocaleString("es-ES", { maximumFractionDigits: 2, useGrouping: false });
}

export function taxRateFormDefaults(rate?: TaxRateRow): TaxRateFormInput {
  if (!rate) return { kind: "vat", name: "", rate_bps: "", regime: "general", legal_note: "", is_default: false };
  return {
    kind: rate.kind,
    name: rate.name,
    rate_bps: bpsToPercentInput(rate.rate_bps),
    regime: rate.regime,
    legal_note: rate.legal_note ?? "",
    is_default: rate.is_default,
  };
}
