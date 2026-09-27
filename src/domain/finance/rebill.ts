// Repercutir gastos a los clientes: lo que se le factura a un cliente por un gasto suyo marcado
// «Repercutir» (un servidor, un dominio, una licencia…). Se le factura la base del gasto (sin IVA)
// más el margen, en una línea puntual de un borrador suyo; los importes de la línea salen de la
// única implementación del redondeo (buildDraftLine → src/domain/tax).
//
// - Margen: round(base × margen), half away from zero; precio = base + margen. Un abono del
//   proveedor (base negativa) se repercute en negativo, con el mismo redondeo simétrico.
// - Pendiente = marcado para repercutir y sin línea de factura. Eso lo filtra la base de datos
//   (expenses_overview.rebill_state); aquí llegan ya los pendientes.
// - El texto de cada línea («Repercusión: …») lo pone quien llama, con i18n y en el idioma de la
//   factura: el dominio no tiene textos.

import { compareCivil, parseCivilDate, type CivilDate } from "../dates/civil-date";
import { buildDraftLine, type DraftLinePayload, type TaxRateRef } from "../invoicing/draft-line";
import { applyBps, assertBps, assertCents, type Bps, type Cents } from "../money";
import { MAX_REBILL_MARKUP_BPS } from "./allocation";

/** Un gasto pendiente de repercutir a su cliente. */
export type RebillExpense = {
  id: string;
  clientId: string;
  description: string;
  vendorName: string | null;
  /** Fecha de la factura del proveedor. */
  issuedOn: CivilDate;
  /** Si lo generó una suscripción, el inicio del periodo que cobra. */
  periodStart: CivilDate | null;
  baseCents: Cents;
  markupBps: Bps;
};

export type RebillTotals = {
  count: number;
  /** Suma de las bases de los gastos. */
  baseCents: Cents;
  /** Suma de los márgenes (cada uno redondeado en su gasto). */
  markupCents: Cents;
  /** Lo que se le factura (sin IVA): bases + márgenes. */
  amountCents: Cents;
};

export type RebillGroup = RebillTotals & { clientId: string; expenses: RebillExpense[] };

/** Una línea de borrador lista para save_invoice_draft, con el gasto que factura. */
export type RebillLine = { expenseId: string; line: DraftLinePayload };

export type RebillLineOptions = {
  /** Posición de la primera línea (tras las que ya tenga el borrador). */
  startPosition: number;
  /** El IVA de las líneas: el de una factura nueva (el tipo por defecto de la org). */
  taxRate: TaxRateRef;
  /** El IRPF de la factura (el del borrador, o el que tendría uno nuevo). */
  invoiceIrpfBps: Bps;
  /** Si la línea está sujeta al IRPF de la factura (como una línea manual nueva: sí). */
  irpfApplies: boolean;
  /** El texto de la línea, en el idioma de la factura. */
  describe: (expense: RebillExpense) => string;
  newId: () => string;
};

/** Lo que admite invoice_lines.description. */
export const MAX_LINE_DESCRIPTION = 500;

function assertMarkup(markupBps: Bps): Bps {
  assertBps(markupBps);
  if (markupBps < 0 || markupBps > MAX_REBILL_MARKUP_BPS) {
    throw new Error(`El margen debe estar entre 0 y ${MAX_REBILL_MARKUP_BPS} puntos básicos: ${markupBps}.`);
  }
  return markupBps;
}

/** El margen de un gasto: round(base × margen / 10 000), half away from zero. */
export function rebillMarkupCents(baseCents: Cents, markupBps: Bps): Cents {
  return applyBps(assertCents(baseCents), assertMarkup(markupBps));
}

/** Lo que se le factura al cliente por un gasto, sin IVA: la base más el margen. */
export function rebillAmountCents(baseCents: Cents, markupBps: Bps): Cents {
  return assertCents(baseCents + rebillMarkupCents(baseCents, markupBps));
}

/** Totales de unos gastos (cada margen se redondea en su gasto, como en su línea). */
export function rebillTotals(expenses: readonly Pick<RebillExpense, "baseCents" | "markupBps">[]): RebillTotals {
  let baseCents = 0;
  let markupCents = 0;
  for (const e of expenses) {
    baseCents = assertCents(baseCents + assertCents(e.baseCents));
    markupCents = assertCents(markupCents + rebillMarkupCents(e.baseCents, e.markupBps));
  }
  return { count: expenses.length, baseCents, markupCents, amountCents: assertCents(baseCents + markupCents) };
}

/** La fecha a la que corresponde el gasto: el periodo que cobra o, si no, su factura. */
export function rebillDate(expense: Pick<RebillExpense, "issuedOn" | "periodStart">): CivilDate {
  const date = expense.periodStart ?? expense.issuedOn;
  parseCivilDate(date);
  return date;
}

/** Del más antiguo al más reciente (y, el mismo día, por concepto y por id): el orden de las líneas. */
export function sortRebills<T extends RebillExpense>(expenses: readonly T[]): T[] {
  return [...expenses].sort(
    (a, b) =>
      compareCivil(rebillDate(a), rebillDate(b)) ||
      a.description.localeCompare(b.description, "es") ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/** Pendientes por cliente: cada grupo en orden de fecha; los grupos, de más a menos importe. */
export function groupRebillsByClient(expenses: readonly RebillExpense[]): RebillGroup[] {
  const byClient = new Map<string, RebillExpense[]>();
  for (const e of expenses) {
    const list = byClient.get(e.clientId) ?? [];
    list.push(e);
    byClient.set(e.clientId, list);
  }
  return [...byClient.entries()]
    .map(([clientId, list]) => ({ clientId, expenses: sortRebills(list), ...rebillTotals(list) }))
    .sort((a, b) => b.amountCents - a.amountCents || (a.clientId < b.clientId ? -1 : a.clientId > b.clientId ? 1 : 0));
}

/** El texto de una línea tal como lo admite la factura: sin espacios de más y hasta 500 caracteres. */
export function clampLineDescription(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= MAX_LINE_DESCRIPTION ? clean : `${clean.slice(0, MAX_LINE_DESCRIPTION - 1).trimEnd()}…`;
}

/**
 * Una línea puntual por gasto (cantidad 1, precio = base + margen, sin descuento), en orden de
 * fecha y a partir de `startPosition`. Todas son del mismo cliente: van a una factura suya.
 */
export function planRebillLines(expenses: readonly RebillExpense[], options: RebillLineOptions): RebillLine[] {
  if (new Set(expenses.map((e) => e.clientId)).size > 1) {
    throw new Error("Las líneas de una repercusión son todas del mismo cliente.");
  }
  if (!Number.isSafeInteger(options.startPosition) || options.startPosition < 0) {
    throw new Error(`Posición de línea no válida: ${options.startPosition}.`);
  }
  return sortRebills(expenses).map((expense, index) => {
    const description = clampLineDescription(options.describe(expense));
    if (!description) throw new Error("Cada línea necesita su texto.");
    return {
      expenseId: expense.id,
      line: buildDraftLine(
        {
          id: options.newId(),
          position: options.startPosition + index,
          description,
          quantity: "1",
          unitPriceCents: rebillAmountCents(expense.baseCents, expense.markupBps),
          discountBps: 0,
          taxRate: options.taxRate,
          irpfApplies: options.irpfApplies,
          billingType: "one_off",
        },
        options.invoiceIrpfBps,
      ),
    };
  });
}
