import type { Bps, Cents } from "../money";
import { computeLine, type LineAmounts } from "../tax";
import { quantityText } from "./input";
import { lineDescription, localizedTexts } from "./text";
import {
  CATALOG_BILLING_TYPES,
  type CatalogBillingType,
  type CatalogBundle,
  type CatalogBundleEntry,
  type CatalogItem,
  type CatalogLocale,
  type CatalogVatRate,
} from "./types";

/**
 * De un servicio o de un pack a sus líneas. Una línea del catálogo es lo común a las líneas de
 * presupuesto, contrato y factura (src/domain/catalog/targets.ts la adapta a cada una). Los
 * importes salen siempre de computeLine (src/domain/tax): aquí no se redondea nada a mano.
 */

export type CatalogLine = {
  /** El servicio del que sale. Las líneas no guardan el enlace: son una copia que luego se edita. */
  itemId: string;
  /** En el idioma del documento: "Nombre — descripción". */
  description: string;
  billingType: CatalogBillingType;
  /** Texto con punto decimal ("1", "2.5"), como numeric(12,3). */
  quantity: string;
  unitPriceCents: Cents;
  /** El del pack (0 en un servicio suelto). */
  discountBps: Bps;
  taxRateId: string;
  irpfApplies: boolean;
};

/**
 * El IVA que lleva la línea: el del servicio si sigue vigente. Si se archivó, el de por defecto de
 * la org (o el primero vigente); si no queda ninguno, el del servicio, y el editor lo enseñará.
 */
export function resolveVatRateId(taxRateId: string, vatRates: readonly CatalogVatRate[]): string {
  const own = vatRates.find((rate) => rate.id === taxRateId);
  if (own && !own.archived) return own.id;
  const active = vatRates.filter((rate) => !rate.archived);
  return (active.find((rate) => rate.isDefault) ?? active[0])?.id ?? taxRateId;
}

export type LineOptions = {
  /** Otra cantidad (la del pack); null o sin ella, la del servicio. */
  quantity?: string | null;
  discountBps?: Bps;
  /** Para cambiar un IVA archivado por el vigente (resolveVatRateId). */
  vatRates?: readonly CatalogVatRate[];
};

/** La línea que sale de un servicio, en el idioma del documento. */
export function itemLine(item: CatalogItem, locale: CatalogLocale, opts: LineOptions = {}): CatalogLine {
  return {
    itemId: item.id,
    description: lineDescription(localizedTexts(item, locale)),
    billingType: item.billingType,
    quantity: quantityText(opts.quantity ?? item.defaultQuantity),
    unitPriceCents: item.unitPriceCents,
    discountBps: opts.discountBps ?? 0,
    taxRateId: opts.vatRates ? resolveVatRateId(item.taxRateId, opts.vatRates) : item.taxRateId,
    irpfApplies: item.irpfApplies,
  };
}

export type BundleExpansion = {
  lines: CatalogLine[];
  /** Servicios del pack que ya no se proponen (archivados o que no están): se quedan fuera. */
  skipped: CatalogBundleEntry[];
};

/**
 * Un pack → sus líneas, en su orden, con el descuento del pack en cada una: así cada línea lo
 * redondea por su cuenta, como cualquier descuento (§7.1). Lo que se cobra una vez, cada mes, cada
 * año o por uso sigue siendo una línea de su tipo: un pack nunca los mezcla.
 */
export function bundleLines(
  bundle: CatalogBundle,
  items: readonly CatalogItem[],
  locale: CatalogLocale,
  opts: Pick<LineOptions, "vatRates"> = {},
): BundleExpansion {
  const byId = new Map(items.map((item) => [item.id, item]));
  const lines: CatalogLine[] = [];
  const skipped: CatalogBundleEntry[] = [];
  for (const entry of bundle.items) {
    const item = byId.get(entry.itemId);
    if (!item || !item.isActive) {
      skipped.push(entry);
      continue;
    }
    lines.push(itemLine(item, locale, { quantity: entry.quantity, discountBps: bundle.discountBps, vatRates: opts.vatRates }));
  }
  return { lines, skipped };
}

/** Importes de una línea para enseñarla: sin IRPF (la retención va en cada factura). */
export function catalogLineAmounts(line: Pick<CatalogLine, "quantity" | "unitPriceCents" | "discountBps">, vatBps: Bps): LineAmounts {
  return computeLine({
    quantity: line.quantity,
    unitPriceCents: line.unitPriceCents,
    discountBps: line.discountBps,
    vatBps,
    irpfBps: 0,
    irpfApplies: false,
  });
}

export type CatalogTypeTotals = {
  /** Antes del descuento. */
  grossCents: Cents;
  discountCents: Cents;
  /** Base (sin IVA). */
  baseCents: Cents;
  vatCents: Cents;
  /** Base + IVA. */
  totalCents: Cents;
  lines: number;
};

/** Por tipo de facturación: lo puntual, lo mensual, lo anual y lo de uso nunca se suman entre sí. */
export type CatalogTotals = Partial<Record<CatalogBillingType, CatalogTypeTotals>>;

/**
 * Totales de unas líneas por tipo, como suma de los importes ya redondeados de cada una (la misma
 * regla que una factura). Una línea con un IVA que no está en la lista cuenta sin IVA.
 */
export function catalogTotals(lines: readonly CatalogLine[], vatRates: readonly CatalogVatRate[]): CatalogTotals {
  const rateById = new Map(vatRates.map((rate) => [rate.id, rate.rateBps]));
  const totals: CatalogTotals = {};
  for (const type of CATALOG_BILLING_TYPES) {
    const ofType = lines.filter((line) => line.billingType === type);
    if (ofType.length === 0) continue;
    const sum: CatalogTypeTotals = { grossCents: 0, discountCents: 0, baseCents: 0, vatCents: 0, totalCents: 0, lines: ofType.length };
    for (const line of ofType) {
      const amounts = catalogLineAmounts(line, rateById.get(line.taxRateId) ?? 0);
      sum.grossCents += amounts.grossCents;
      sum.discountCents += amounts.discountCents;
      sum.baseCents += amounts.baseCents;
      sum.vatCents += amounts.vatCents;
      sum.totalCents += amounts.totalCents;
    }
    totals[type] = sum;
  }
  return totals;
}
