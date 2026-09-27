import { z } from "zod";
import { isSepaIban, isValidMandateReference, validateBic, validateCreditorId } from "@/domain/collections";
import { type CivilDate, compareCivil } from "@/domain/dates/civil-date";
import { validateIban } from "@/domain/tax-id";
import { requiredText, text } from "@/lib/validation/fiscal";

/**
 * Formularios de cobros (datos de acreedor, mandatos, remesas, cobro y devoluciones),
 * compartidos por los componentes (cliente) y las acciones (servidor). Los mensajes son claves de
 * `collections.validation.*` o, si no están ahí, de `validation.*`.
 */

/** Motivos de devolución SEPA más habituales (el banco los indica en el aviso de devolución). */
export const RETURN_CODES = ["AM04", "MD06", "MS02", "AC04", "AC06", "AC01", "MD01", "AG01", "MS03", "SL01"] as const;
export type ReturnCode = (typeof RETURN_CODES)[number];

const isoDate = z.iso.date("date");
const notFuture = (today: CivilDate) => isoDate.refine((v) => compareCivil(v, today) <= 0, "futureDate");

// ---------------------------------------------------------------------------
// Datos de acreedor (owner)
// ---------------------------------------------------------------------------

export const creditorFormSchema = z
  .object({
    /** Vacío: no se guarda ninguno (la app sigue proponiendo el del NIF). */
    creditor_id: text(40).refine((v) => v === "" || validateCreditorId(v), "creditorId"),
    confirmed: z.boolean(),
    /** Vacío: la razón social del emisor. */
    name: text(70),
    /** Vacío: el IBAN del emisor. */
    iban: text(40).refine((v) => v === "" || isSepaIban(v), "iban"),
    bic: text(15).refine((v) => v === "" || validateBic(v), "bic"),
  })
  .refine((v) => !v.confirmed || v.creditor_id !== "", { path: ["creditor_id"], message: "creditorIdRequired" });

export type CreditorFormInput = z.input<typeof creditorFormSchema>;

// ---------------------------------------------------------------------------
// Mandatos (socio)
// ---------------------------------------------------------------------------

export const mandateFormSchema = (today: CivilDate) =>
  z.object({
    issuer_id: z.guid("required"),
    reference: z.string().trim().min(1, "required").max(35, "tooLong").refine(isValidMandateReference, "mandateReference"),
    debtor_name: requiredText(70),
    iban: z
      .string()
      .trim()
      .min(1, "required")
      .max(40, "tooLong")
      .refine((v) => validateIban(v), "iban")
      .refine((v) => !validateIban(v) || isSepaIban(v), "ibanNotSepa"),
    bic: text(15).refine((v) => v === "" || validateBic(v), "bic"),
    signed_on: notFuture(today),
    notes: text(1000),
  });

export type MandateFormInput = z.input<ReturnType<typeof mandateFormSchema>>;

export const revokeMandateSchema = z.object({ reason: text(500) });
export type RevokeMandateInput = z.input<typeof revokeMandateSchema>;

// ---------------------------------------------------------------------------
// Remesas
// ---------------------------------------------------------------------------

/** Parámetros de /remittances/new: emisor y fecha de cobro. */
export const newRemittanceParamsSchema = z.object({ issuer: z.guid(), on: isoDate });

export const remittanceDraftSchema = z.object({
  remittance_id: z.guid(),
  expected_updated_at: z.string().min(1).max(64).nullable(),
  issuer_id: z.guid(),
  collection_on: isoDate,
  notes: text(1000),
  invoice_ids: z.array(z.guid()).max(500),
});
export type RemittanceDraftInput = z.input<typeof remittanceDraftSchema>;

export const settleFormSchema = (today: CivilDate) => z.object({ settled_on: notFuture(today) });
export type SettleFormInput = z.input<ReturnType<typeof settleFormSchema>>;

export const returnFormSchema = (today: CivilDate) =>
  z.object({
    returned_on: notFuture(today),
    code: z.union([z.literal(""), z.enum(RETURN_CODES)]),
    reason: text(500),
  });
export type ReturnFormInput = z.input<ReturnType<typeof returnFormSchema>>;
