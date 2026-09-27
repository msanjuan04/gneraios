// Libro registro de facturas expedidas para la gestoría (hito 1.5), por emisor y periodo.
//
// Sigue el formato de los libros registro de IVA e IRPF de la AEAT: una fila por cada tipo de IVA
// de cada factura (una factura con el 21 % y un exento son dos filas con el mismo número), con la
// fecha de expedición, la de operación si es distinta, serie y número, NIF y nombre del
// destinatario, base, tipo y cuota de IVA, retención de IRPF y total, y si es rectificativa, la
// factura que rectifica. En cada fila, total = base + cuota − retención de esas líneas: la suma de
// las filas de una factura es su total.

import { compareCivil, type CivilDate } from "../dates/civil-date";
import type { VatRegime } from "../tax";
import { VAT_REGIMES } from "../tax";
import type { Sheet, SheetCell } from "./sheet";

export type LedgerLine = { baseCents: number; vatBps: number; vatRegime: VatRegime; vatCents: number; irpfCents: number };

export type LedgerInvoice = {
  id: string;
  number: string;
  seriesCode: string | null;
  kind: "ordinary" | "rectifying";
  issuedOn: CivilDate;
  operationOn: CivilDate | null;
  recipient: { name: string; taxId: string | null; countryCode: string | null };
  irpfBps: number;
  rectifiedNumber: string | null;
  lines: readonly LedgerLine[];
};

export type LedgerRow = {
  invoiceId: string;
  year: number;
  quarter: 1 | 2 | 3 | 4;
  issuedOn: CivilDate;
  /** Solo si es distinta de la de expedición (como pide el formato de la AEAT). */
  operationOn: CivilDate | null;
  series: string | null;
  number: string;
  recipientTaxId: string | null;
  recipientName: string;
  recipientCountry: string | null;
  baseCents: number;
  vatBps: number;
  vatRegime: VatRegime;
  vatCents: number;
  irpfBps: number;
  irpfCents: number;
  totalCents: number;
  rectifying: boolean;
  rectifiedNumber: string | null;
};

export type LedgerRateSummary = { vatBps: number; vatRegime: VatRegime; baseCents: number; vatCents: number; irpfCents: number; totalCents: number };

export type Ledger = {
  rows: LedgerRow[];
  totals: { invoices: number; baseCents: number; vatCents: number; irpfCents: number; totalCents: number };
  byRate: LedgerRateSummary[];
};

const collator = new Intl.Collator("es", { numeric: true, sensitivity: "base" });

/** Filas del libro: por fecha de expedición, serie y número; dentro de una factura, por tipo de IVA (de mayor a menor). */
export function buildLedger(invoices: readonly LedgerInvoice[]): Ledger {
  const sorted = [...invoices].sort(
    (a, b) =>
      compareCivil(a.issuedOn, b.issuedOn) ||
      collator.compare(a.seriesCode ?? "", b.seriesCode ?? "") ||
      collator.compare(a.number, b.number),
  );
  const rows: LedgerRow[] = [];
  const rates = new Map<string, LedgerRateSummary>();
  const totals = { invoices: 0, baseCents: 0, vatCents: 0, irpfCents: 0, totalCents: 0 };

  for (const inv of sorted) {
    totals.invoices += 1;
    const groups = new Map<string, LedgerRateSummary>();
    for (const line of inv.lines) {
      const key = `${line.vatBps}:${line.vatRegime}`;
      const group = groups.get(key) ?? { vatBps: line.vatBps, vatRegime: line.vatRegime, baseCents: 0, vatCents: 0, irpfCents: 0, totalCents: 0 };
      group.baseCents += line.baseCents;
      group.vatCents += line.vatCents;
      group.irpfCents += line.irpfCents;
      group.totalCents += line.baseCents + line.vatCents - line.irpfCents;
      groups.set(key, group);
    }
    // Una factura sin líneas (no debería existir) sale igualmente, a cero.
    if (groups.size === 0) groups.set("0:general", { vatBps: 0, vatRegime: "general", baseCents: 0, vatCents: 0, irpfCents: 0, totalCents: 0 });
    const ordered = [...groups.values()].sort(
      (a, b) => b.vatBps - a.vatBps || VAT_REGIMES.indexOf(a.vatRegime) - VAT_REGIMES.indexOf(b.vatRegime),
    );
    const year = Number(inv.issuedOn.slice(0, 4));
    const quarter = Math.ceil(Number(inv.issuedOn.slice(5, 7)) / 3) as 1 | 2 | 3 | 4;
    for (const g of ordered) {
      rows.push({
        invoiceId: inv.id,
        year,
        quarter,
        issuedOn: inv.issuedOn,
        operationOn: inv.operationOn && inv.operationOn !== inv.issuedOn ? inv.operationOn : null,
        series: inv.seriesCode,
        number: inv.number,
        recipientTaxId: inv.recipient.taxId,
        recipientName: inv.recipient.name,
        recipientCountry: inv.recipient.countryCode,
        baseCents: g.baseCents,
        vatBps: g.vatBps,
        vatRegime: g.vatRegime,
        vatCents: g.vatCents,
        irpfBps: g.irpfCents !== 0 ? inv.irpfBps : 0,
        irpfCents: g.irpfCents,
        totalCents: g.totalCents,
        rectifying: inv.kind === "rectifying",
        rectifiedNumber: inv.rectifiedNumber,
      });
      const key = `${g.vatBps}:${g.vatRegime}`;
      const summary = rates.get(key) ?? { vatBps: g.vatBps, vatRegime: g.vatRegime, baseCents: 0, vatCents: 0, irpfCents: 0, totalCents: 0 };
      summary.baseCents += g.baseCents;
      summary.vatCents += g.vatCents;
      summary.irpfCents += g.irpfCents;
      summary.totalCents += g.totalCents;
      rates.set(key, summary);
      totals.baseCents += g.baseCents;
      totals.vatCents += g.vatCents;
      totals.irpfCents += g.irpfCents;
      totals.totalCents += g.totalCents;
    }
  }
  const byRate = [...rates.values()].sort(
    (a, b) => b.vatBps - a.vatBps || VAT_REGIMES.indexOf(a.vatRegime) - VAT_REGIMES.indexOf(b.vatRegime),
  );
  return { rows, totals, byRate };
}

export const LEDGER_COLUMNS = [
  "year",
  "period",
  "issued_on",
  "operation_on",
  "series",
  "number",
  "recipient_tax_id",
  "recipient_name",
  "recipient_country",
  "base",
  "vat_rate",
  "vat_amount",
  "vat_regime",
  "irpf_rate",
  "irpf_amount",
  "total",
  "rectifying",
  "rectified_number",
] as const;

export type LedgerColumn = (typeof LEDGER_COLUMNS)[number];

export const SUMMARY_COLUMNS = ["vat_rate", "vat_regime", "base", "vat_amount", "irpf_amount", "total"] as const;
export type SummaryColumn = (typeof SUMMARY_COLUMNS)[number];

/** Textos de las hojas (salen de i18n: el dominio no sabe de idiomas). */
export type LedgerLabels = {
  sheet: string;
  summarySheet: string;
  columns: Record<LedgerColumn, string>;
  summaryColumns: Record<SummaryColumn, string>;
  regimes: Record<VatRegime, string>;
  yes: string;
  no: string;
  total: string;
  /** "{n}T" → "3T". */
  quarter: (quarter: number) => string;
};

const COLUMN_TYPES: Record<LedgerColumn, Sheet["columns"][number]["type"]> = {
  year: "integer",
  period: "text",
  issued_on: "date",
  operation_on: "date",
  series: "text",
  number: "text",
  recipient_tax_id: "text",
  recipient_name: "text",
  recipient_country: "text",
  base: "money",
  vat_rate: "percent",
  vat_amount: "money",
  vat_regime: "text",
  irpf_rate: "percent",
  irpf_amount: "money",
  total: "money",
  rectifying: "text",
  rectified_number: "text",
};

const COLUMN_WIDTHS: Partial<Record<LedgerColumn, number>> = {
  year: 9,
  period: 9,
  issued_on: 12,
  operation_on: 12,
  series: 8,
  number: 14,
  recipient_tax_id: 14,
  recipient_name: 36,
  recipient_country: 8,
  vat_regime: 26,
  rectified_number: 14,
};

/**
 * El libro como tablas: la principal (una fila por factura y tipo de IVA, con la fila de totales al
 * final) y el resumen por tipo, que solo va en el XLSX (el CSV se queda con una tabla importable).
 */
export function ledgerSheets(ledger: Ledger, labels: LedgerLabels): { main: Sheet; summary: Sheet } {
  const main: Sheet = {
    name: labels.sheet,
    columns: LEDGER_COLUMNS.map((key) => ({ header: labels.columns[key], type: COLUMN_TYPES[key], width: COLUMN_WIDTHS[key] })),
    rows: ledger.rows.map((r) => {
      const cells: Record<LedgerColumn, SheetCell> = {
        year: r.year,
        period: labels.quarter(r.quarter),
        issued_on: r.issuedOn,
        operation_on: r.operationOn,
        series: r.series,
        number: r.number,
        recipient_tax_id: r.recipientTaxId,
        recipient_name: r.recipientName,
        recipient_country: r.recipientCountry,
        base: r.baseCents,
        vat_rate: r.vatBps,
        vat_amount: r.vatCents,
        vat_regime: labels.regimes[r.vatRegime],
        irpf_rate: r.irpfBps,
        irpf_amount: r.irpfCents,
        total: r.totalCents,
        rectifying: r.rectifying ? labels.yes : labels.no,
        rectified_number: r.rectifiedNumber,
      };
      return { cells: LEDGER_COLUMNS.map((key) => cells[key]) };
    }),
  };
  const totalCells: Partial<Record<LedgerColumn, SheetCell>> = {
    year: labels.total,
    base: ledger.totals.baseCents,
    vat_amount: ledger.totals.vatCents,
    irpf_amount: ledger.totals.irpfCents,
    total: ledger.totals.totalCents,
  };
  main.rows.push({ cells: LEDGER_COLUMNS.map((key) => totalCells[key] ?? null), bold: true });

  const summary: Sheet = {
    name: labels.summarySheet,
    columns: SUMMARY_COLUMNS.map((key) => ({
      header: labels.summaryColumns[key],
      type: key === "vat_rate" ? "percent" : key === "vat_regime" ? "text" : "money",
      width: key === "vat_regime" ? 30 : 16,
    })),
    rows: [
      ...ledger.byRate.map((s) => ({
        cells: [s.vatBps, labels.regimes[s.vatRegime], s.baseCents, s.vatCents, s.irpfCents, s.totalCents] as SheetCell[],
      })),
      {
        cells: [labels.total, null, ledger.totals.baseCents, ledger.totals.vatCents, ledger.totals.irpfCents, ledger.totals.totalCents],
        bold: true,
      },
    ],
  };
  return { main, summary };
}
