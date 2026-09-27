import { type CivilDate, parseCivilDate } from "@/domain/dates/civil-date";

// Histórico de facturación: lo facturado, lo cobrado y lo que queda por cobrar, por año,
// trimestre o mes, desde la primera factura (también las importadas de la herramienta anterior).
// Todo se deriva de las facturas emitidas y de los cobros; aquí no se guarda nada.
//
// - Facturado: por fecha de emisión. Las rectificativas restan en su periodo (base negativa).
// - Cobrado: por fecha de cobro (el día en que entró el dinero), no por la de la factura. Con IVA
//   (lo que entró) y, para compararlo con los gastos, su parte de base (proporcional a la factura).
// - Pendiente: lo que aún falta por cobrar de las facturas emitidas en ese periodo.
// - Sin factura: los cobros sin factura (client_receipts), por el día en que entró el dinero. No
//   llevan IVA: cuentan enteros como cobrado y como ingreso.
// - Gastos: la base de los gastos que se asignan a un cliente, por fecha de su factura; solo
//   tiene sentido al mirar un cliente.

export type HistoryGranularity = "year" | "quarter" | "month";
export const HISTORY_GRANULARITIES = ["year", "quarter", "month"] as const satisfies readonly HistoryGranularity[];

export type HistoryInvoice = {
  issuedOn: CivilDate;
  /** Las ordinarias cuentan como factura; las rectificativas solo restan importes. */
  kind: "ordinary" | "rectifying";
  baseCents: number;
  vatCents: number;
  irpfCents: number;
  totalCents: number;
  /** Lo que queda por cobrar hoy (0 en las rectificativas: se descuenta en la original). */
  outstandingCents: number;
};

export type HistoryPayment = {
  paidOn: CivilDate;
  /** Lo cobrado, con IVA. */
  amountCents: number;
  /** Su parte de base imponible (ver `paymentBase`). */
  baseCents: number;
};
export type HistoryExpense = { issuedOn: CivilDate; baseCents: number };
export type HistoryReceipt = { receivedOn: CivilDate; amountCents: number };

export type HistoryFigures = {
  invoices: number;
  baseCents: number;
  vatCents: number;
  irpfCents: number;
  totalCents: number;
  collectedCents: number;
  /** Lo cobrado sin el IVA: lo que se compara con los gastos. */
  collectedBaseCents: number;
  /** Cobros sin factura (ya incluidos en lo cobrado). */
  receiptsCents: number;
  outstandingCents: number;
  expensesCents: number;
};

export type HistoryRow = HistoryFigures & {
  /** "2026", "2026-Q3" o "2026-09". */
  key: string;
  /** Primer día del periodo. */
  start: CivilDate;
};

const empty = (): HistoryFigures => ({
  invoices: 0,
  baseCents: 0,
  vatCents: 0,
  irpfCents: 0,
  totalCents: 0,
  collectedCents: 0,
  collectedBaseCents: 0,
  receiptsCents: 0,
  outstandingCents: 0,
  expensesCents: 0,
});

/** Ingresos de un periodo: lo facturado (base) más lo cobrado sin factura. */
export const revenueOf = (f: Pick<HistoryFigures, "baseCents" | "receiptsCents">) => f.baseCents + f.receiptsCents;

/**
 * La parte de base de un cobro: la misma proporción que la base sobre el total de su factura
 * (un cobro parcial de una factura con IVA e IRPF lleva su parte de cada cosa).
 */
export function paymentBase(amountCents: number, invoiceBaseCents: number, invoiceTotalCents: number): number {
  if (invoiceTotalCents === 0) return 0;
  return Math.round((amountCents * invoiceBaseCents) / invoiceTotalCents);
}

/** La clave del periodo de una fecha civil. */
export function periodKey(date: CivilDate, granularity: HistoryGranularity): string {
  const { year, month } = parseCivilDate(date);
  if (granularity === "year") return String(year);
  if (granularity === "quarter") return `${year}-Q${Math.floor((month - 1) / 3) + 1}`;
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** Primer día de un periodo a partir de su clave. */
export function periodStart(key: string, granularity: HistoryGranularity): CivilDate {
  const year = Number(key.slice(0, 4));
  if (granularity === "year") return `${year}-01-01`;
  const month = granularity === "quarter" ? (Number(key.slice(6)) - 1) * 3 + 1 : Number(key.slice(5, 7));
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

/** El periodo siguiente. */
export function nextPeriodKey(key: string, granularity: HistoryGranularity): string {
  const year = Number(key.slice(0, 4));
  if (granularity === "year") return String(year + 1);
  if (granularity === "quarter") {
    const quarter = Number(key.slice(6));
    return quarter === 4 ? `${year + 1}-Q1` : `${year}-Q${quarter + 1}`;
  }
  const month = Number(key.slice(5, 7));
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
}

function add(into: HistoryFigures, from: Partial<HistoryFigures>) {
  for (const k of Object.keys(from) as (keyof HistoryFigures)[]) into[k] += from[k] ?? 0;
}

/**
 * Periodos de la primera actividad (factura, cobro, cobro sin factura o gasto) hasta `until`, sin huecos y de más
 * antiguo a más nuevo, con los totales de todo el histórico. Sin actividad, no hay filas.
 */
export function buildHistory(input: {
  invoices: readonly HistoryInvoice[];
  payments: readonly HistoryPayment[];
  receipts?: readonly HistoryReceipt[];
  expenses?: readonly HistoryExpense[];
  granularity: HistoryGranularity;
  until: CivilDate;
}): { rows: HistoryRow[]; totals: HistoryFigures } {
  const { granularity } = input;
  const byKey = new Map<string, HistoryFigures>();
  const at = (date: CivilDate) => {
    const key = periodKey(date, granularity);
    let figures = byKey.get(key);
    if (!figures) byKey.set(key, (figures = empty()));
    return figures;
  };

  for (const invoice of input.invoices) {
    add(at(invoice.issuedOn), {
      invoices: invoice.kind === "ordinary" ? 1 : 0,
      baseCents: invoice.baseCents,
      vatCents: invoice.vatCents,
      irpfCents: invoice.irpfCents,
      totalCents: invoice.totalCents,
      outstandingCents: invoice.kind === "ordinary" ? Math.max(0, invoice.outstandingCents) : 0,
    });
  }
  for (const payment of input.payments) {
    add(at(payment.paidOn), { collectedCents: payment.amountCents, collectedBaseCents: payment.baseCents });
  }
  for (const receipt of input.receipts ?? []) {
    add(at(receipt.receivedOn), { receiptsCents: receipt.amountCents, collectedCents: receipt.amountCents, collectedBaseCents: receipt.amountCents });
  }
  for (const expense of input.expenses ?? []) add(at(expense.issuedOn), { expensesCents: expense.baseCents });

  const totals = empty();
  if (byKey.size === 0) return { rows: [], totals };

  const keys = [...byKey.keys()].sort();
  const lastKey = [keys.at(-1)!, periodKey(input.until, granularity)].sort().at(-1)!;
  const rows: HistoryRow[] = [];
  for (let key = keys[0]!; key <= lastKey; key = nextPeriodKey(key, granularity)) {
    const figures = byKey.get(key) ?? empty();
    add(totals, figures);
    rows.push({ key, start: periodStart(key, granularity), ...figures });
  }
  return { rows, totals };
}
