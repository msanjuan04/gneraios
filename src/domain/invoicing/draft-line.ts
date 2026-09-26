// Líneas de borrador tal como las recibe la RPC save_invoice_draft / apply_billing_run: los
// importes van ya calculados con la única implementación del redondeo (src/domain/tax).

import type { CivilDate } from "../dates/civil-date";
import type { Bps, Cents } from "../money";
import { computeLine, type VatRegime } from "../tax/totals";

export type BillingType = "one_off" | "monthly" | "yearly" | "usage";

export type TaxRateRef = { id: string; rateBps: Bps; regime: VatRegime; legalNote: string | null };

/** Fila de invoice_lines en el formato del JSON de las RPC (snake_case, como la tabla). */
export type DraftLinePayload = {
  id: string;
  position: number;
  description: string;
  quantity: string;
  unit_price_cents: Cents;
  discount_bps: Bps;
  base_cents: Cents;
  tax_rate_id: string | null;
  vat_bps: Bps;
  vat_regime: VatRegime;
  vat_cents: Cents;
  irpf_applies: boolean;
  irpf_cents: Cents;
  legal_note: string | null;
  billing_type: BillingType;
  period_start: CivilDate | null;
  period_end: CivilDate | null;
  contract_line_id: string | null;
  rectifies_line_id: string | null;
  billable_item_id?: string | null;
};

export type DraftLineInput = {
  id: string;
  position: number;
  description: string;
  quantity: string | number;
  unitPriceCents: Cents;
  discountBps: Bps;
  taxRate: TaxRateRef;
  /** La línea está sujeta a IRPF (se aplica el tipo de la factura). */
  irpfApplies: boolean;
  billingType: BillingType;
  periodStart?: CivilDate | null;
  periodEnd?: CivilDate | null;
  contractLineId?: string | null;
  rectifiesLineId?: string | null;
  billableItemId?: string | null;
};

/** "2" → "2", 1.5 → "1.5": la cantidad viaja como texto para no perder decimales. */
function quantityText(quantity: string | number): string {
  return typeof quantity === "number" ? String(quantity) : quantity.trim();
}

/** Calcula los importes de la línea con el IRPF de la factura. */
export function buildDraftLine(input: DraftLineInput, invoiceIrpfBps: Bps): DraftLinePayload {
  const amounts = computeLine({
    quantity: input.quantity,
    unitPriceCents: input.unitPriceCents,
    discountBps: input.discountBps,
    vatBps: input.taxRate.rateBps,
    irpfBps: invoiceIrpfBps,
    irpfApplies: input.irpfApplies,
  });
  return {
    id: input.id,
    position: input.position,
    description: input.description.trim(),
    quantity: quantityText(input.quantity),
    unit_price_cents: input.unitPriceCents,
    discount_bps: input.discountBps,
    base_cents: amounts.baseCents,
    tax_rate_id: input.taxRate.id,
    vat_bps: input.taxRate.rateBps,
    vat_regime: input.taxRate.regime,
    vat_cents: amounts.vatCents,
    irpf_applies: input.irpfApplies,
    irpf_cents: amounts.irpfCents,
    legal_note: input.taxRate.legalNote?.trim() || null,
    billing_type: input.billingType,
    period_start: input.periodStart ?? null,
    period_end: input.periodEnd ?? null,
    contract_line_id: input.contractLineId ?? null,
    rectifies_line_id: input.rectifiesLineId ?? null,
    billable_item_id: input.billableItemId ?? null,
  };
}

/** Una línea guardada, vuelta a calcular con otro IRPF de factura (sin tocar nada más). */
export function recomputeDraftLine(line: DraftLinePayload, invoiceIrpfBps: Bps): DraftLinePayload {
  const amounts = computeLine({
    quantity: line.quantity,
    unitPriceCents: line.unit_price_cents,
    discountBps: line.discount_bps,
    vatBps: line.vat_bps,
    irpfBps: invoiceIrpfBps,
    irpfApplies: line.irpf_applies,
  });
  return { ...line, base_cents: amounts.baseCents, vat_cents: amounts.vatCents, irpf_cents: amounts.irpfCents };
}

/** ¿Los importes guardados son los que da el dominio? (comprobación antes de emitir). */
export function lineAmountsMatch(line: DraftLinePayload, invoiceIrpfBps: Bps): boolean {
  const expected = recomputeDraftLine(line, invoiceIrpfBps);
  return (
    expected.base_cents === line.base_cents &&
    expected.vat_cents === line.vat_cents &&
    expected.irpf_cents === line.irpf_cents
  );
}

/**
 * IRPF por defecto de una factura (ARCHITECTURE §7.1): el del emisor (SL 0 %, autónomo 15 % o
 * 7 %), y solo si el cliente es una empresa o un profesional español. Se puede cambiar en cada factura.
 */
export function defaultIrpfBps(
  issuer: { defaultIrpfBps: Bps },
  client: { isBusiness: boolean; taxIdKind: "es" | "eu_vat" | "foreign"; countryCode: string },
): Bps {
  return client.isBusiness && client.taxIdKind === "es" && client.countryCode === "ES" ? issuer.defaultIrpfBps : 0;
}

/** Plazo de pago: el del contrato, si no el del cliente, si no el de la org. */
export function resolvePaymentTermsDays(
  contractDays: number | null | undefined,
  clientDays: number | null | undefined,
  orgDays: number,
): number {
  return contractDays ?? clientDays ?? orgDays;
}
