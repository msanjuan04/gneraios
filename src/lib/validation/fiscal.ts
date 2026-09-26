import { z } from "zod";
import { isValidSeriesFormat } from "@/domain/invoicing/number-format";
import { validateIban, validateSpanishTaxId } from "@/domain/tax-id";

/**
 * Esquemas compartidos por formularios (cliente) y acciones (servidor).
 * Los mensajes son claves de `validation.*` en i18n.
 */

export const text = (max: number) => z.string().trim().max(max, "tooLong");
export const requiredText = (max: number) => text(max).min(1, "required");

export const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.union([z.literal(""), z.email("email")]));

export const taxIdField = text(20).refine((v) => v === "" || validateSpanishTaxId(v).valid, "taxId");

export const ibanField = text(40).refine((v) => v === "" || validateIban(v), "iban");

/** Porcentaje escrito por el usuario (p. ej. "21" o "15,5") a puntos básicos. */
export const percentToBps = z
  .union([z.number(), z.string()])
  .transform((v) => (typeof v === "number" ? v : Number(String(v).replace(",", "."))))
  .refine((v) => Number.isFinite(v) && v >= 0 && v <= 100, "rate")
  .transform((v) => Math.round(v * 100));

export const seriesSchema = z
  .object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{1,12}$/, "required"),
    name: requiredText(80),
    kind: z.enum(["ordinary", "rectifying"]),
    format: requiredText(40),
    reset_yearly: z.boolean(),
    is_default: z.boolean(),
    last_number: z.number("lastNumber").int("lastNumber").min(0, "lastNumber").max(999_999, "lastNumber"),
  })
  .refine((s) => isValidSeriesFormat(s.format, s.reset_yearly), { path: ["format"], message: "format" });

export const issuerSchema = z.object({
  kind: z.enum(["company", "self_employed"]),
  legal_name: requiredText(200),
  trade_name: text(200),
  tax_id: taxIdField,
  address_line: text(200),
  postal_code: text(10),
  city: text(80),
  province: text(80),
  email: optionalEmail,
  iban: ibanField,
  default_irpf_bps: z.number().int().min(0).max(10_000),
  is_primary: z.boolean(),
  is_me: z.boolean(),
  pending_constitution: z.boolean(),
  active_from: z.union([z.literal(""), z.iso.date()]),
  registry_info: text(500),
});

export const taxRateSchema = z
  .object({
    include: z.boolean(),
    kind: z.enum(["vat", "irpf"]),
    name: requiredText(80),
    rate_bps: z.number().int().min(0).max(10_000),
    regime: z.enum(["general", "exempt", "reverse_charge_eu", "not_subject"]).nullable(),
    legal_note: text(300),
    is_default: z.boolean(),
  })
  .refine((t) => (t.kind === "vat") === (t.regime !== null), { path: ["regime"], message: "required" })
  .refine((t) => t.kind !== "vat" || t.regime === "general" || t.rate_bps === 0, { path: ["rate_bps"], message: "rate" });

/** Texto vacío → null, que es lo que guarda la base de datos. */
export function emptyToNull(value: string): string | null {
  const v = value.trim();
  return v === "" ? null : v;
}
