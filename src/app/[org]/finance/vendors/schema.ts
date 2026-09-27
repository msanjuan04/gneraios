import { z } from "zod";
import { readVendorKindFilter, VENDOR_KINDS, type VendorKind } from "@/domain/vendors";
import type { TablesUpdate } from "@/lib/supabase/database.types";
import { emptyToNull, ibanField, requiredText, text } from "@/lib/validation/fiscal";

/**
 * El formulario de un proveedor (Finanzas → Proveedores), compartido por el panel (cliente) y las
 * acciones (servidor). Comprueba lo mismo que la base de datos después de su trigger de
 * normalización (supabase/migrations/20260927150000_proveedores.sql), o algo más estricto: el
 * formato del email, el dígito de control del IBAN y la forma de la web.
 * Los mensajes son claves de `vendors.validation.*` o, si no están ahí, de `validation.*`.
 */

// Lo que admite `vendors.tax_id` después de quitarle todo lo que no son letras y números.
const STORED_TAX_ID = /^[A-Z0-9]{2,20}$/;
// Solo el espacio normal (la base de datos admite cualquier espacio): «+34 600 11 22 33».
const PHONE = /^\+?[\d ().-]{6,25}$/;
// "estudi.cat", "www.estudi.cat/portfolio" o "https://estudi.cat".
const WEBSITE = /^(https?:\/\/)?([\p{L}\p{N}-]+\.)+\p{L}{2,}(:\d{2,5})?([/?#]\S*)?$/iu;
const COUNTRY = /^[A-Z]{2}$/;

const optionalId = z.union([z.literal(""), z.guid()]);

export const vendorFormSchema = z.object({
  name: requiredText(200),
  kind: z.enum(VENDOR_KINDS),
  tax_id: text(40).refine((v) => v === "" || STORED_TAX_ID.test(v.replace(/[^A-Za-z0-9]/g, "").toUpperCase()), "taxIdVendor"),
  country_code: z.string().trim().toUpperCase().regex(COUNTRY, "countryCode"),
  contact_name: text(200),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254, "tooLong")
    .pipe(z.union([z.literal(""), z.email("email")])),
  phone: text(40).refine((v) => v === "" || PHONE.test(v), "phone"),
  iban: ibanField,
  website: text(300).refine((v) => v === "" || WEBSITE.test(v), "website"),
  default_category_id: optionalId,
  notes: text(2000),
});

export type VendorFormInput = z.input<typeof vendorFormSchema>;
export type VendorFormValues = z.output<typeof vendorFormSchema>;

/** Un formulario vacío (un proveedor nuevo). */
export function emptyVendorForm(kind: VendorKind = "company"): VendorFormInput {
  return {
    name: "",
    kind,
    tax_id: "",
    country_code: "ES",
    contact_name: "",
    email: "",
    phone: "",
    iban: "",
    website: "",
    default_category_id: "",
    notes: "",
  };
}

/** La fila que se guarda: lo vacío, null (el trigger normaliza el resto). */
export function vendorRow(values: VendorFormValues) {
  return {
    name: values.name,
    kind: values.kind,
    tax_id: emptyToNull(values.tax_id),
    country_code: values.country_code,
    contact_name: emptyToNull(values.contact_name),
    email: emptyToNull(values.email),
    phone: emptyToNull(values.phone),
    iban: emptyToNull(values.iban),
    website: emptyToNull(values.website),
    default_category_id: values.default_category_id || null,
    notes: emptyToNull(values.notes),
  } satisfies TablesUpdate<"vendors">;
}

/** El listado en la URL: ?kind=freelancer&archived=1&q=… (lo que no se entienda, fuera). */
export function readVendorListParams(params: Record<string, string | string[] | undefined>) {
  const one = (key: string) => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value) ?? "";
  };
  return {
    kind: readVendorKindFilter(one("kind")),
    showArchived: one("archived") === "1",
    query: one("q").trim().slice(0, 80),
    /** Abrir el alta nada más llegar (p. ej. desde ⌘K). */
    openNew: one("new") === "1",
  };
}
