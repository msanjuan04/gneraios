import { z } from "zod";
import { formatHasYear } from "@/domain/dataio/invoice-number";
import { isValidSeriesFormat } from "@/domain/invoicing/number-format";
import { formatIban } from "@/domain/tax-id";
import type { Tables } from "@/lib/supabase/database.types";
import { issuerSchema } from "@/lib/validation/fiscal";

/**
 * Emisor en Ajustes: el esquema del onboarding, con el socio vinculado en lugar
 * de "soy yo" (aquí el owner puede configurar el emisor de otro socio).
 */
export const issuerFormSchema = issuerSchema
  .omit({ is_me: true })
  .extend({ member_id: z.union([z.literal(""), z.guid()]) })
  .superRefine((issuer, ctx) => {
    // Sin fecha de alta la sociedad se muestra como pendiente de constitución.
    if (issuer.kind === "company" && !issuer.pending_constitution && issuer.active_from === "") {
      ctx.addIssue({ code: "custom", path: ["active_from"], message: "required" });
    }
  });

export type IssuerFormInput = z.input<typeof issuerFormSchema>;
export type IssuerFormValues = z.output<typeof issuerFormSchema>;

/** Último número usado en una serie (este año, o en total si no se reinicia). */
export const seriesNumberSchema = z.object({
  series_id: z.guid(),
  last_number: z.number("lastNumber").int("lastNumber").min(0, "lastNumber").max(999_999, "lastNumber"),
});

export type SeriesNumberInput = z.input<typeof seriesNumberSchema>;

/**
 * Una serie nueva de un emisor (p. ej. la de un histórico que numeraba «2026-BRK-001»). El código
 * y el nombre pueden ir vacíos: salen del formato. Se reinicia cada año si el formato lleva el año.
 */
export const seriesFormSchema = z.object({
  issuer_id: z.guid(),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{0,12}$/, "seriesCode"),
  name: z.string().trim().max(80, "tooLong"),
  kind: z.enum(["ordinary", "rectifying"]),
  format: z
    .string()
    .trim()
    .min(1, "required")
    .max(40, "tooLong")
    .refine((f) => isValidSeriesFormat(f, formatHasYear(f)), "seriesFormat"),
});

export type SeriesFormInput = z.input<typeof seriesFormSchema>;

/** Retenciones habituales de un autónomo: general, inicio de actividad y sin retención. */
export const IRPF_OPTIONS = [
  { bps: 1500, labelKey: "irpfGeneral" },
  { bps: 700, labelKey: "irpfNew" },
  { bps: 0, labelKey: "irpfNone" },
] as const;

/** Series con las que nace un emisor creado desde Ajustes: las mismas que en el onboarding. */
export const DEFAULT_SERIES = [
  { code: "F", kind: "ordinary", format: "{yyyy}-{n:4}", nameKey: "seriesDefaultOrdinary" },
  { code: "R", kind: "rectifying", format: "R{yyyy}-{n:4}", nameKey: "seriesDefaultRectifying" },
] as const;

export type IssuerRow = Pick<
  Tables<"issuers">,
  | "id"
  | "kind"
  | "legal_name"
  | "trade_name"
  | "tax_id"
  | "address_line"
  | "postal_code"
  | "city"
  | "province"
  | "email"
  | "iban"
  | "default_irpf_bps"
  | "member_id"
  | "is_primary"
  | "active_from"
  | "verifactu_from"
  | "fiscal_provider"
  | "registry_info"
>;

export const ISSUER_COLUMNS =
  "id, kind, legal_name, trade_name, tax_id, address_line, postal_code, city, province, email, iban, default_irpf_bps, member_id, is_primary, active_from, verifactu_from, fiscal_provider, registry_info";

/** Valores iniciales del formulario para un emisor nuevo (por defecto, un autónomo). */
export function newIssuerDefaults(isPrimary: boolean): IssuerFormInput {
  return {
    kind: "self_employed",
    legal_name: "",
    trade_name: "",
    tax_id: "",
    address_line: "",
    postal_code: "",
    city: "",
    province: "",
    email: "",
    iban: "",
    default_irpf_bps: 1500,
    is_primary: isPrimary,
    pending_constitution: false,
    active_from: "",
    registry_info: "",
    member_id: "",
  };
}

/** Valores del formulario a partir de la fila guardada. */
export function issuerFormDefaults(issuer: IssuerRow): IssuerFormInput {
  return {
    kind: issuer.kind,
    legal_name: issuer.legal_name,
    trade_name: issuer.trade_name ?? "",
    tax_id: issuer.tax_id ?? "",
    address_line: issuer.address_line ?? "",
    postal_code: issuer.postal_code ?? "",
    city: issuer.city ?? "",
    province: issuer.province ?? "",
    email: issuer.email ?? "",
    iban: issuer.iban ? formatIban(issuer.iban) : "",
    default_irpf_bps: issuer.default_irpf_bps,
    is_primary: issuer.is_primary,
    pending_constitution: issuer.kind === "company" && !issuer.active_from,
    active_from: issuer.active_from ?? "",
    registry_info: issuer.registry_info ?? "",
    member_id: issuer.member_id ?? "",
  };
}
