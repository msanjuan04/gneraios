// Sin `import "server-only"`: lo usa también el test de guardado. Solo se importa desde el servidor.
//
// Guardar una factura leída de un PDF: se vuelve a validar con los datos de la org (nunca se fía de
// los importes que manda el navegador: se recalculan), se da de alta con import_historical_invoice
// (ya emitida, con su número, que sube el contador de la serie, y su cobro con su propia fecha) y
// se guarda y enlaza su PDF original. Cada factura es independiente: si una falla, las demás siguen.

import { z } from "zod";
import type { ExistingInvoice } from "@/components/invoice-import/types";
import { PAYMENT_METHODS } from "@/app/[org]/invoices/schema";
import { BILLING_TYPES, buildImportPayload, type FormIssue, type ImportForm, PAYMENT_STATUSES } from "@/domain/invoice-import/form";
import type { Json, Tables } from "@/lib/supabase/database.types";
import type { Db } from "@/server/billing/context";
import { findByNumber } from "./existing";
import { loadImportSetup } from "./setup";
import { attachOriginal, type OriginalFile } from "./storage";

const text = (max: number) => z.string().max(max);
const date = z.union([z.literal(""), z.iso.date()]);

/** El formulario tal y como llega del navegador (los importes, como texto: se recalculan aquí). */
export const importFormSchema = z.object({
  clientId: z.guid(),
  // La propuesta de cliente no viaja al guardar (el cliente ya existe): se ignora si llega.
  newClient: z.unknown().optional(),
  issuerId: z.guid(),
  seriesId: z.guid(),
  number: text(40),
  issuedOn: date,
  operationOn: date,
  dueOn: date,
  irpfBps: z.number().int().min(0).max(10_000),
  lines: z
    .array(
      z.object({
        key: text(80),
        description: text(500),
        quantity: text(20),
        unitPrice: text(30),
        discount: text(10),
        taxRateId: z.guid(),
        irpfApplies: z.boolean(),
        billingType: z.enum(BILLING_TYPES),
        periodStart: date,
        periodEnd: date,
      }),
    )
    .min(1)
    .max(200),
  payment: z.object({
    status: z.enum(PAYMENT_STATUSES),
    paidOn: date,
    amount: text(30),
    method: z.enum(PAYMENT_METHODS),
    reference: text(200),
  }),
  pdf: z.object({
    vatCents: z.number().int().nullable(),
    irpfCents: z.number().int().nullable(),
    totalCents: z.number().int().nullable(),
  }),
});

/** Hints de import_historical_invoice (supabase/migrations/…_datos.sql) con su texto en invoiceImport.errors.db.* */
export const DB_HINTS = [
  "future_date",
  "issuer_inactive",
  "series_invalid",
  "number_format_mismatch",
  "series_order_conflict",
  "series_external_numbering",
  "totals_mismatch",
  "no_lines",
  "client_not_found",
  "counter_below_used",
  "import_invalid",
] as const;
type DbHint = (typeof DB_HINTS)[number];

export type SaveOutcome =
  | { ok: true; invoiceId: string; number: string; clientId: string; attached: boolean }
  | { ok: false; code: "invalid"; issues: FormIssue[] }
  | { ok: false; code: "duplicate"; existing: ExistingInvoice | null }
  | { ok: false; code: DbHint; detail: string | null }
  | { ok: false; code: "forbidden" | "db_error" };

export type SaveContext = { db: Db; admin: Db; org: Pick<Tables<"orgs">, "id" | "timezone" | "settings"> };

export async function saveImportedInvoice(ctx: SaveContext, form: ImportForm, file: OriginalFile): Promise<SaveOutcome> {
  const clientId = form.clientId;
  if (!clientId) return { ok: false, code: "invalid", issues: [{ code: "client_required", severity: "error", field: "client" }] };
  const setup = await loadImportSetup(ctx.db, ctx.org, { clientIds: [clientId] });
  if (!setup.clients.some((c) => c.id === clientId)) return { ok: false, code: "client_not_found", detail: null };

  const built = buildImportPayload(form, setup);
  if (!built.ok) return { ok: false, code: "invalid", issues: built.issues };

  // Ya está (importada antes o emitida desde GNERAI OS): no se vuelve a crear.
  const existing = await findByNumber(ctx.db, ctx.org.id, form.issuerId, built.payload.number);
  if (existing) return { ok: false, code: "duplicate", existing };

  const { data, error } = await ctx.db.rpc("import_historical_invoice", { p: built.payload as unknown as Json });
  if (error) {
    if (error.hint === "number_taken") return { ok: false, code: "duplicate", existing: await findByNumber(ctx.db, ctx.org.id, form.issuerId, built.payload.number) };
    if (error.hint && (DB_HINTS as readonly string[]).includes(error.hint)) {
      return { ok: false, code: error.hint as DbHint, detail: typeof error.details === "string" && error.details ? error.details : null };
    }
    if (error.code === "42501") return { ok: false, code: "forbidden" };
    console.error("[invoice-import] save.rpc", error.code, error.hint);
    return { ok: false, code: "db_error" };
  }
  const invoiceId = data;
  const attached = await attachOriginal(ctx.db, ctx.admin, { orgId: ctx.org.id, invoiceId, file });
  return { ok: true, invoiceId, number: built.payload.number, clientId, attached: attached.ok };
}
