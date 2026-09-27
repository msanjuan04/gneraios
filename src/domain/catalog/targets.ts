import type { CivilDate } from "../dates/civil-date";
import type { DraftLineInput, TaxRateRef } from "../invoicing/draft-line";
import { centsToInput, discountToInput, quantityToInput } from "./input";
import type { CatalogLine } from "./lines";
import type { CatalogBillingType } from "./types";

/**
 * Adaptadores: una línea del catálogo → la línea que espera cada editor, tal cual, para añadirla a
 * su formulario sin tocar nada. Los tipos son los de cada módulo, escritos aquí porque el dominio
 * no importa de la app; CatalogPicker (src/components/catalog) los tipa con los originales, así
 * que si un editor cambia su línea, no compila, y los tests los validan con sus propios esquemas.
 *
 * Lo que decide cada adaptador es lo que no viene del catálogo:
 * - Presupuesto: sin fechas (empieza con el contrato, al aceptarlo) y el día de cobro de la org.
 * - Contrato: las recurrentes empiezan hoy y las mensuales se cobran el día de la org.
 * - Factura: sin periodo (el editor lo pide si hace falta).
 */

export const CATALOG_TARGETS = ["quote", "contract", "invoice"] as const;
export type CatalogTarget = (typeof CATALOG_TARGETS)[number];

/** Línea del editor de presupuestos: `QuoteLineInput` (src/app/[org]/quotes/schema.ts). */
export type QuoteLineFormInput = {
  id: string;
  billing_type: CatalogBillingType;
  description: string;
  quantity: string;
  unit_price: string;
  discount: string;
  tax_rate_id: string;
  irpf_applies: boolean;
  starts_on: string;
  ends_on: string;
  billing_day: string;
};

/** Línea de contrato: `LineFormInput` (src/app/[org]/contracts/schema.ts). */
export type ContractLineFormInput = {
  billing_type: CatalogBillingType;
  description: string;
  quantity: string;
  unit_price: string;
  discount: string;
  tax_rate_id: string;
  irpf_applies: boolean;
  starts_on: string;
  ends_on: string;
  billing_day: string;
  prorate_first: boolean;
};

/** Línea del borrador de factura: `DraftLineInput` (src/app/[org]/invoices/schema.ts). */
export type InvoiceLineFormInput = {
  id: string;
  description: string;
  quantity: string;
  unit_price: string;
  discount: string;
  tax_rate_id: string;
  irpf_applies: boolean;
  billing_type: CatalogBillingType;
  period_start: string;
  period_end: string;
};

/** Lo que tienen en común las tres, escrito como en un formulario. */
function economics(line: CatalogLine) {
  return {
    description: line.description,
    quantity: quantityToInput(line.quantity),
    unit_price: centsToInput(line.unitPriceCents),
    discount: discountToInput(line.discountBps),
    tax_rate_id: line.taxRateId,
    irpf_applies: line.irpfApplies,
  };
}

/** (a) Presupuesto. `id`: el de la línea nueva (el editor lo genera, como al añadir una a mano). */
export function toQuoteLineInput(line: CatalogLine, id: string): QuoteLineFormInput {
  return {
    id,
    billing_type: line.billingType,
    ...economics(line),
    // Vacías: empieza con el contrato (el día que se acepte) y se cobra el día de la org.
    starts_on: "",
    ends_on: "",
    billing_day: "",
  };
}

/**
 * (b) Contrato. Como una línea nueva del editor (newLineDefaults): las recurrentes empiezan `today`
 * y el día de facturación es el de la org (solo cuenta en las mensuales).
 */
export function toContractLineInput(line: CatalogLine, ctx: { today: CivilDate; billingDay: number }): ContractLineFormInput {
  const recurring = line.billingType === "monthly" || line.billingType === "yearly";
  return {
    billing_type: line.billingType,
    ...economics(line),
    starts_on: recurring ? ctx.today : "",
    ends_on: "",
    billing_day: String(ctx.billingDay),
    prorate_first: true,
  };
}

/** (c) Borrador de factura, en su editor. Sin periodo: una línea manual no lo necesita. */
export function toInvoiceDraftLineInput(line: CatalogLine, id: string): InvoiceLineFormInput {
  return {
    id,
    ...economics(line),
    billing_type: line.billingType,
    period_start: "",
    period_end: "",
  };
}

/**
 * (c') Borrador de factura desde el servidor: la entrada de buildDraftLine
 * (src/domain/invoicing/draft-line.ts), que calcula sus importes con el IRPF de la factura.
 */
export function toDraftLineInput(line: CatalogLine, ctx: { id: string; position: number; taxRate: TaxRateRef }): DraftLineInput {
  if (ctx.taxRate.id !== line.taxRateId) throw new Error("El IVA no es el de la línea.");
  return {
    id: ctx.id,
    position: ctx.position,
    description: line.description,
    quantity: line.quantity,
    unitPriceCents: line.unitPriceCents,
    discountBps: line.discountBps,
    taxRate: ctx.taxRate,
    irpfApplies: line.irpfApplies,
    billingType: line.billingType,
  };
}
