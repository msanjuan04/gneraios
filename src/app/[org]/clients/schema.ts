import { z } from "zod";
import { parseMoneyInput } from "@/domain/money";
import { normalizeTaxId, validateSpanishTaxId } from "@/domain/tax-id";
import { locales } from "@/i18n/config";
import type { Enums, Tables } from "@/lib/supabase/database.types";
import { optionalEmail, requiredText, text } from "@/lib/validation/fiscal";

/**
 * Formularios del CRM de clientes (cliente, contacto y actividad), compartidos por
 * los paneles (cliente) y las acciones (servidor). Los mensajes son claves de
 * `clients.validation.*` o, si no están ahí, de `validation.*`.
 */

export type TaxIdKind = Enums<"tax_id_kind">;
export type ActivityKind = Enums<"activity_kind">;
export type ClientStatus = Enums<"client_status">;

export const TAX_ID_KINDS = ["es", "eu_vat", "foreign"] as const satisfies readonly TaxIdKind[];
export const ACTIVITY_KINDS = ["call", "meeting", "email", "note"] as const satisfies readonly ActivityKind[];
export const CLIENT_STATUSES = ["lead", "active", "paused", "former"] as const satisfies readonly ClientStatus[];

const EU_VAT = /^[A-Z]{2}[A-Z0-9]{2,12}$/;
// Lo que admite la columna `clients.tax_id` después del trigger que la normaliza.
const STORED_TAX_ID = /^[A-Z0-9]{2,20}$/;

/**
 * NIF tal y como se guarda según su tipo: "" si está vacío y null si no es válido.
 * - es: DNI, NIE o CIF con su carácter de control.
 * - eu_vat: prefijo de país + 2-12 caracteres, sin espacios ni guiones ("FR12345678901").
 * - foreign: libre, pero la base de datos solo guarda letras y números (2-20).
 */
export function normalizeClientTaxId(kind: TaxIdKind, value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "") return "";
  if (kind === "es") {
    const result = validateSpanishTaxId(trimmed);
    return result.valid ? result.normalized : null;
  }
  if (kind === "eu_vat") {
    const normalized = normalizeTaxId(trimmed);
    return EU_VAT.test(normalized) ? normalized : null;
  }
  const normalized = trimmed.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return STORED_TAX_ID.test(normalized) ? normalized : null;
}

const TAX_ID_MESSAGE: Record<TaxIdKind, string> = { es: "taxId", eu_vat: "euVat", foreign: "foreignTaxId" };

// "gnerai.com", "www.gnerai.com/es" o "https://gnerai.com".
const WEBSITE = /^(https?:\/\/)?([\p{L}\p{N}-]+\.)+\p{L}{2,}(:\d{2,5})?([/?#]\S*)?$/iu;
const PHONE = /^\+?[\d\s().-]{6,25}$/;
const DAYS = /^\d{1,3}$/;
const optionalId = z.union([z.literal(""), z.guid()]);

export const clientFormSchema = z
  .object({
    display_name: requiredText(200),
    legal_name: text(200),
    tax_id_kind: z.enum(TAX_ID_KINDS),
    tax_id: text(40),
    address_line: text(200),
    postal_code: text(12),
    city: text(80),
    province: text(80),
    country_code: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "countryCode"),
    sector: text(80),
    website: text(200).refine((v) => v === "" || WEBSITE.test(v), "website"),
    owner_member_id: optionalId,
    is_business: z.boolean(),
    preferred_language: z.enum(locales),
    // Vacío = el plazo por defecto de la org (`orgs.settings.payment_terms_days`).
    payment_terms_days: z
      .string()
      .trim()
      .refine((v) => v === "" || (DAYS.test(v) && Number(v) <= 365), "days"),
    notes: text(2000),
  })
  .superRefine((values, ctx) => {
    if (normalizeClientTaxId(values.tax_id_kind, values.tax_id) === null) {
      ctx.addIssue({ code: "custom", path: ["tax_id"], message: TAX_ID_MESSAGE[values.tax_id_kind] });
    }
  });

export type ClientFormInput = z.input<typeof clientFormSchema>;
export type ClientFormValues = z.output<typeof clientFormSchema>;

export const CLIENT_COLUMNS =
  "id, display_name, legal_name, tax_id, tax_id_kind, address_line, postal_code, city, province, country_code, sector, website, owner_member_id, is_business, preferred_language, payment_terms_days, notes, archived_at, created_at";

export type ClientRow = Pick<
  Tables<"clients">,
  | "id"
  | "display_name"
  | "legal_name"
  | "tax_id"
  | "tax_id_kind"
  | "address_line"
  | "postal_code"
  | "city"
  | "province"
  | "country_code"
  | "sector"
  | "website"
  | "owner_member_id"
  | "is_business"
  | "preferred_language"
  | "payment_terms_days"
  | "notes"
  | "archived_at"
  | "created_at"
>;

/** Cliente nuevo: de empresa, en España, en español y llevado por quien lo crea. */
export function newClientDefaults(ownerMemberId: string): ClientFormInput {
  return {
    display_name: "",
    legal_name: "",
    tax_id_kind: "es",
    tax_id: "",
    address_line: "",
    postal_code: "",
    city: "",
    province: "",
    country_code: "ES",
    sector: "",
    website: "",
    owner_member_id: ownerMemberId,
    is_business: true,
    preferred_language: "es",
    payment_terms_days: "",
    notes: "",
  };
}

/** Valores del formulario a partir de la fila guardada. */
export function clientFormDefaults(client: ClientRow): ClientFormInput {
  return {
    display_name: client.display_name,
    legal_name: client.legal_name ?? "",
    tax_id_kind: client.tax_id_kind,
    tax_id: client.tax_id ?? "",
    address_line: client.address_line ?? "",
    postal_code: client.postal_code ?? "",
    city: client.city ?? "",
    province: client.province ?? "",
    country_code: client.country_code,
    sector: client.sector ?? "",
    website: client.website ?? "",
    owner_member_id: client.owner_member_id ?? "",
    is_business: client.is_business,
    preferred_language: client.preferred_language,
    payment_terms_days: client.payment_terms_days === null ? "" : String(client.payment_terms_days),
    notes: client.notes ?? "",
  };
}

export const contactFormSchema = z.object({
  full_name: requiredText(120),
  role: text(80),
  email: optionalEmail,
  phone: text(40).refine((v) => v === "" || PHONE.test(v), "phone"),
  is_primary: z.boolean(),
  is_billing: z.boolean(),
  notes: text(1000),
});

export type ContactFormInput = z.input<typeof contactFormSchema>;

export type ContactRow = Pick<
  Tables<"contacts">,
  "id" | "full_name" | "role" | "email" | "phone" | "is_primary" | "is_billing" | "notes"
>;

export function contactFormDefaults(contact?: ContactRow, first = false): ContactFormInput {
  if (!contact) {
    // El primer contacto suele ser el principal y el que recibe las facturas.
    return { full_name: "", role: "", email: "", phone: "", is_primary: first, is_billing: first, notes: "" };
  }
  return {
    full_name: contact.full_name,
    role: contact.role ?? "",
    email: contact.email ?? "",
    phone: contact.phone ?? "",
    is_primary: contact.is_primary,
    is_billing: contact.is_billing,
    notes: contact.notes ?? "",
  };
}

export const activityFormSchema = z.object({
  kind: z.enum(ACTIVITY_KINDS),
  title: requiredText(200),
  body: text(10_000),
  /** Hora de pared en la zona de la org, como la da <input type="datetime-local">. */
  occurred_at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/, "dateTime"),
  deal_id: optionalId,
  contact_id: optionalId,
});

export type ActivityFormInput = z.input<typeof activityFormSchema>;

// ---------------------------------------------------------------------------
// Cobros sin factura
// ---------------------------------------------------------------------------

export type PaymentMethod = Enums<"payment_method">;

/**
 * Un cobro sin factura (client_receipts): el día en que entró el dinero, el importe escrito a la
 * española (en negativo, una devolución), el concepto y, si es de un proyecto, el proyecto.
 */
export function clientReceiptSchema(today: string) {
  return z.object({
    amount: z.string().superRefine((value, ctx) => {
      const cents = parseMoneyInput(value);
      if (cents === null) ctx.addIssue({ code: "custom", message: value.trim() === "" ? "required" : "money" });
      else if (cents === 0) ctx.addIssue({ code: "custom", message: "amountZero" });
    }),
    received_on: z.iso.date("date").refine((v) => v <= today, "receivedInFuture"),
    method: z.enum(["transfer", "sepa_debit", "card", "cash", "other"] satisfies PaymentMethod[]),
    concept: requiredText(300),
    reference: text(200),
    project_id: z.union([z.guid(), z.literal("")]),
    notes: text(2000),
  });
}

export type ClientReceiptInput = z.input<ReturnType<typeof clientReceiptSchema>>;
