import type { CivilDate } from "@/domain/dates/civil-date";

// Lo cobrado de un cliente: los cobros de sus facturas y los cobros sin factura (mientras no se
// factura desde GNERAI OS). Juntos son «lo que nos ha pagado», que se enseña en su ficha. Todo
// se deriva de las dos tablas; aquí no se guarda nada.

export type CollectionKind = "invoice" | "receipt";

export type CollectionEntry = {
  kind: CollectionKind;
  id: string;
  /** El día en que entró el dinero. */
  on: CivilDate;
  /** Lo cobrado: con IVA si es de una factura, tal cual si es sin factura. En negativo, una devolución. */
  amountCents: number;
};

export type CollectionsSummary = {
  totalCents: number;
  invoicePaymentsCents: number;
  receiptsCents: number;
  /** Lo cobrado en el año natural de `today`. */
  thisYearCents: number;
  count: number;
  firstOn: CivilDate | null;
  lastOn: CivilDate | null;
};

/** De lo más reciente a lo más antiguo; a igual fecha, los cobros sin factura y luego por id (estable). */
export function sortCollections<T extends CollectionEntry>(entries: readonly T[]): T[] {
  return [...entries].sort((a, b) => (a.on !== b.on ? (a.on < b.on ? 1 : -1) : a.kind !== b.kind ? (a.kind === "receipt" ? -1 : 1) : a.id < b.id ? -1 : 1));
}

export function summarizeCollections(entries: readonly CollectionEntry[], today: CivilDate): CollectionsSummary {
  const year = today.slice(0, 4);
  const summary: CollectionsSummary = {
    totalCents: 0,
    invoicePaymentsCents: 0,
    receiptsCents: 0,
    thisYearCents: 0,
    count: entries.length,
    firstOn: null,
    lastOn: null,
  };
  for (const entry of entries) {
    summary.totalCents += entry.amountCents;
    if (entry.kind === "invoice") summary.invoicePaymentsCents += entry.amountCents;
    else summary.receiptsCents += entry.amountCents;
    if (entry.on.slice(0, 4) === year) summary.thisYearCents += entry.amountCents;
    if (summary.firstOn === null || entry.on < summary.firstOn) summary.firstOn = entry.on;
    if (summary.lastOn === null || entry.on > summary.lastOn) summary.lastOn = entry.on;
  }
  return summary;
}
