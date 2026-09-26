import "server-only";
import { randomUUID } from "node:crypto";
import type { CivilDate } from "@/domain/dates/civil-date";
import { type BillingType, buildDraftLine } from "@/domain/invoicing/draft-line";
import type { Enums, Json } from "@/lib/supabase/database.types";
import { type Db, DbError, loadVatRates } from "@/server/billing/context";
import { BillingRuleError } from "@/server/billing/manual";

export type DraftEditorLine = {
  /** Id de la línea si ya existe (se actualiza en su sitio y conserva su pendiente). */
  id?: string | null;
  description: string;
  quantity: string;
  unitPriceCents: number;
  discountBps: number;
  taxRateId: string;
  irpfApplies: boolean;
  billingType: BillingType;
  periodStart?: CivilDate | null;
  periodEnd?: CivilDate | null;
  contractLineId?: string | null;
  billableItemId?: string | null;
  rectifiesLineId?: string | null;
};

export type DraftEditorInput = {
  invoiceId?: string | null;
  /** updated_at que tenía el borrador al abrirlo: si ha cambiado, no se pisa (draft_changed). */
  expectedUpdatedAt?: string | null;
  header: {
    issuerId?: string;
    clientId?: string;
    seriesId?: string | null;
    issuedOn?: CivilDate | null;
    operationOn?: CivilDate | null;
    dueOn?: CivilDate | null;
    paymentTermsDays?: number | null;
    language?: Enums<"app_locale">;
    irpfBps: number;
    paymentMethod?: Enums<"payment_method">;
    notes?: string | null;
    rectificationReason?: string;
  };
  lines: DraftEditorLine[];
  /** Pendientes que se quitan del borrador a propósito y no se deben volver a facturar. */
  waiveItemIds?: string[];
  waiveReason?: string | null;
};

/**
 * Guarda un borrador completo (cabecera + todas sus líneas) en una transacción. Los importes
 * de cada línea se calculan aquí, con el dominio; la base de datos suma la cabecera.
 */
export async function saveDraft(db: Db, orgId: string, input: DraftEditorInput): Promise<string> {
  const vat = await loadVatRates(db, orgId);
  const lines = input.lines.map((l, position) => {
    const taxRate = vat.get(l.taxRateId);
    if (!taxRate) throw new BillingRuleError("billing.errors.vatRateRequired");
    return buildDraftLine(
      {
        id: l.id ?? randomUUID(),
        position,
        description: l.description,
        quantity: l.quantity,
        unitPriceCents: l.unitPriceCents,
        discountBps: l.discountBps,
        taxRate,
        irpfApplies: l.irpfApplies,
        billingType: l.billingType,
        periodStart: l.periodStart,
        periodEnd: l.periodEnd,
        contractLineId: l.contractLineId,
        rectifiesLineId: l.rectifiesLineId,
        billableItemId: l.billableItemId,
      },
      input.header.irpfBps,
    );
  });

  const h = input.header;
  const header: { [key: string]: Json } = { irpf_bps: h.irpfBps };
  if (h.issuerId !== undefined) header.issuer_id = h.issuerId;
  if (h.clientId !== undefined) header.client_id = h.clientId;
  if (h.seriesId !== undefined) header.series_id = h.seriesId;
  if (h.issuedOn !== undefined) header.issued_on = h.issuedOn;
  if (h.operationOn !== undefined) header.operation_on = h.operationOn;
  if (h.dueOn !== undefined) header.due_on = h.dueOn;
  if (h.paymentTermsDays !== undefined) header.payment_terms_days = h.paymentTermsDays;
  if (h.language !== undefined) header.language = h.language;
  if (h.paymentMethod !== undefined) header.payment_method = h.paymentMethod;
  if (h.notes !== undefined) header.notes = h.notes;
  if (h.rectificationReason !== undefined) header.rectification_reason = h.rectificationReason;

  const { data, error } = await db.rpc("save_invoice_draft", {
    p: {
      invoice_id: input.invoiceId ?? null,
      expected_updated_at: input.expectedUpdatedAt ?? null,
      header,
      lines: lines as unknown as Json,
      waive_item_ids: input.waiveItemIds ?? [],
      waive_reason: input.waiveReason ?? null,
    },
  });
  if (error) throw new DbError(error, "saveDraft");
  return data;
}
