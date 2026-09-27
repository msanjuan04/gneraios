import { z } from "zod";
import { text } from "@/lib/validation/fiscal";
import { BANK_CSV_ROLES, type BankCsvMapping } from "@/domain/banking/csv";

/**
 * Lo que llega del cliente a la pestaña Banco (repartos, ignorar, el mapeo de un CSV), compartido por
 * la ruta de subida, las acciones y los paneles. Los mensajes son claves de banking.validation.*.
 */

export const IGNORE_REASON_VALUES = ["internal_transfer", "partner_movement", "financing", "tax_settlement", "personal", "other"] as const;

const cents = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export const allocationSchema = z.object({
  kind: z.enum(["invoice", "payment", "expense", "remittance"]),
  id: z.guid(),
  amountCents: cents,
});
export type AllocationInput = z.input<typeof allocationSchema>;

export const allocationsSchema = z.array(allocationSchema).min(1).max(20);

export const ignoreSchema = z
  .object({
    reason: z.enum(IGNORE_REASON_VALUES),
    note: text(500),
  })
  .superRefine((v, ctx) => {
    if (v.reason === "other" && !v.note.trim()) ctx.addIssue({ code: "custom", path: ["note"], message: "noteRequired" });
  });
export type IgnoreInput = z.input<typeof ignoreSchema>;

const column = z.number().int().min(0).max(200).optional();

export const csvMappingSchema = z.object({
  headerRow: z.number().int().min(0).max(1000),
  columns: z.object(Object.fromEntries(BANK_CSV_ROLES.map((role) => [role, column])) as Record<(typeof BANK_CSV_ROLES)[number], typeof column>),
  decimal: z.enum([",", "."]),
  dateOrder: z.enum(["dmy", "mdy"]),
});

/** El mapeo de un CSV que manda el cliente (JSON en el formulario de subida), o null si no viene o no vale. */
export function readCsvMapping(value: FormDataEntryValue | null): BankCsvMapping | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  try {
    const parsed = csvMappingSchema.safeParse(JSON.parse(value));
    if (!parsed.success) return null;
    const columns = Object.fromEntries(Object.entries(parsed.data.columns).filter(([, v]) => v !== undefined)) as BankCsvMapping["columns"];
    return { ...parsed.data, columns };
  } catch {
    return null;
  }
}
