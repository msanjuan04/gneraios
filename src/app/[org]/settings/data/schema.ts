import { z } from "zod";
import type { ImportBillingType } from "@/domain/dataio/classify";
import { type ColumnMapping, fieldsFor, type ImportKind, sanitizeMapping } from "@/domain/dataio/fields";
import type { PaidMode } from "@/domain/dataio/invoices-import";
import type { DateOrder, DecimalSeparator } from "@/domain/dataio/values";

/**
 * Mapeo y opciones de una importación: lo que guarda `import_jobs.mapping` y lo que envía el
 * formulario de mapeo. Compartido por los componentes (cliente) y las acciones (servidor).
 */

export const BILLING_TYPES = ["one_off", "monthly", "yearly", "usage"] as const satisfies readonly ImportBillingType[];
export const PAID_MODES = ["column", "all", "none"] as const satisfies readonly PaidMode[];

export type ImportOptions = {
  /** Emisor de todas las facturas (si el fichero no trae el NIF del emisor). */
  issuerId: string | null;
  paidMode: PaidMode;
  /** IVA cuando el fichero no permite saberlo; null = error en esas facturas. */
  defaultVatBps: number | null;
  /** null = deducido de las columnas. */
  decimal: DecimalSeparator | null;
  dateOrder: DateOrder | null;
};

export type StoredMapping = {
  columns: ColumnMapping;
  options: ImportOptions;
  /** Tipos de línea corregidos a mano, por número de fila. */
  lineTypes: Record<string, ImportBillingType>;
};

export const DEFAULT_OPTIONS: ImportOptions = { issuerId: null, paidMode: "all", defaultVatBps: null, decimal: null, dateOrder: null };

const optionsSchema = z.object({
  issuerId: z.guid().nullable().catch(null),
  paidMode: z.enum(PAID_MODES).catch("all"),
  defaultVatBps: z.number().int().min(0).max(10_000).nullable().catch(null),
  decimal: z.enum([",", "."]).nullable().catch(null),
  dateOrder: z.enum(["dmy", "mdy"]).nullable().catch(null),
});

const lineTypesSchema = z.record(z.string().regex(/^\d{1,6}$/), z.enum(BILLING_TYPES));

/** Lee el mapeo guardado (o el que llega del formulario) sin fiarse de él: lo desconocido se descarta. */
export function readStoredMapping(kind: ImportKind, value: unknown, columns: number): StoredMapping {
  const record = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const rawColumns = record.columns && typeof record.columns === "object" ? (record.columns as Record<string, unknown>) : {};
  const options = optionsSchema.safeParse({ ...DEFAULT_OPTIONS, ...(typeof record.options === "object" ? record.options : {}) });
  const lineTypes = lineTypesSchema.safeParse(record.lineTypes ?? {});
  return {
    columns: sanitizeMapping(kind, rawColumns, columns),
    options: options.success ? options.data : DEFAULT_OPTIONS,
    lineTypes: lineTypes.success ? lineTypes.data : {},
  };
}

/** Lo que envía el formulario de mapeo. */
export const mappingInputSchema = z.object({
  columns: z.record(z.string(), z.number().int().min(0).max(199)),
  options: optionsSchema,
});

export type MappingInput = z.input<typeof mappingInputSchema>;

/** Campos que se enseñan en el formulario de mapeo, en su orden. */
export function mappingFields(kind: ImportKind) {
  return fieldsFor(kind);
}
