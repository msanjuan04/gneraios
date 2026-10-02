import "server-only";
import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import { getTranslations } from "next-intl/server";
import { buildLedger, type Ledger, type LedgerInvoice, ledgerSheets } from "@/domain/dataio/libro-registro";
import type { ExportPeriod } from "@/domain/dataio/period";
import { sheetToCsv, sheetsToXlsx } from "@/domain/dataio/sheet";
import type { Sheet, SheetCell, SheetColumn } from "@/domain/dataio/sheet";
import { encodeUtf8 } from "@/domain/dataio/text";
import { createZip, safeFileName, type ZipEntry } from "@/domain/dataio/zip";
import type { VatRegime } from "@/domain/tax";
import { nowInZone } from "@/lib/clock";
import type { Tables } from "@/lib/supabase/database.types";
import type { createAdminClient } from "@/lib/supabase/admin";
import { type Db, DbError, fetchAll } from "@/server/billing/context";

type Snapshot = { legal_name?: string | null; display_name?: string | null; tax_id?: string | null; country_code?: string | null };

export type LedgerData = {
  issuer: Pick<Tables<"issuers">, "id" | "legal_name" | "trade_name" | "tax_id">;
  ledger: Ledger;
  /** Facturas del periodo con su PDF guardado (las importadas no tienen). */
  pdfs: { number: string; path: string }[];
  /** Emitidas en el periodo sin PDF (históricos importados). */
  withoutPdf: string[];
  /** A medio emitir en el periodo: no entran en el libro hasta completarse. */
  issuing: number;
  expenses: (Tables<"expenses"> & { vendor_name: string | null })[];
  payments: (Pick<Tables<"payments">, "id" | "org_id" | "invoice_id" | "amount_cents" | "paid_on" | "method" | "reference" | "provider_ref" | "notes" | "created_at" | "updated_at" | "created_by"> & { invoice_number: string | null })[];
  receipts: (Tables<"client_receipts"> & { client_name: string | null; issuer_name: string | null })[];
  /** Documentos privados autorizados por sus filas ligadas al emisor/periodo. */
  expenseFiles: { description: string; issuedOn: string; vendorInvoiceNumber: string | null; path: string }[];
  historicalInvoiceFiles: { number: string; fileName: string; path: string }[];
  missingExpenseAttachments: string[];
  receiptsWithoutIssuer: number;
  bankTransactions: { id: string; accountId: string; accountName: string; statementId: string; bookedOn: string; valueOn: string | null; amountCents: number; concept: string; counterparty: string | null; reference: string | null; bankCode: string | null; balanceAfterCents: number | null; status: string; matchedCents: number; remainingCents: number; ignoredReason: string | null; ignoredNote: string | null }[];
  bankStatements: { id: string; accountId: string; accountName: string; fileName: string; format: string; periodStart: string; periodEnd: string; movementsInFile: number; newCount: number; openingBalanceCents: number | null; closingBalanceCents: number | null; periodMovementsCents: number; balanceGapCents: number | null }[];
};

const deflateRaw = (data: Uint8Array) => new Uint8Array(deflateRawSync(data));

/**
 * Datos operativos por emisor/periodo, leídos bajo RLS. null si el emisor no existe o no pertenece
 * a la org. Los cobros sin emisor se excluyen del libro y solo cuentan como incidencia.
 */
export async function loadLedger(db: Db, orgId: string, issuerId: string, period: ExportPeriod): Promise<LedgerData | null> {
  const { data: issuer, error: issuerError } = await db
    .from("issuers")
    .select("id, legal_name, trade_name, tax_id")
    .eq("id", issuerId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (issuerError) throw new DbError(issuerError, "dataio.ledger.issuer");
  if (!issuer) return null;

  const [invoices, series, issuing, expenseRows, payments, receiptRows, issuerRows, cashAccounts, bankRows, statementRows] = await Promise.all([
    fetchAll(
      (from, to) =>
        db
          .from("invoices")
          .select("id, number, kind, issued_on, operation_on, irpf_bps, client_snapshot, series_id, rectifies_invoice_id, pdf_path")
          .eq("org_id", orgId)
          .eq("issuer_id", issuerId)
          .eq("lifecycle", "issued")
          .gte("issued_on", period.from)
          .lte("issued_on", period.to)
          .order("issued_on")
          .order("id")
          .range(from, to),
      "dataio.ledger.invoices",
    ),
    db.from("invoice_series").select("id, code").eq("org_id", orgId).eq("issuer_id", issuerId),
    db
      .from("invoices")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("issuer_id", issuerId)
      .eq("lifecycle", "issuing")
      .gte("issued_on", period.from)
      .lte("issued_on", period.to),
    fetchAll(
      (from, to) => db.from("expenses").select("*").eq("org_id", orgId).eq("issuer_id", issuerId).gte("issued_on", period.from).lte("issued_on", period.to).order("issued_on").order("id").range(from, to),
      "dataio.ledger.expenses",
    ),
    fetchInvoicePayments(db, orgId, issuerId, period),
    fetchIssuerReceipts(db, orgId, issuerId, period),
    fetchAll((from, to) => db.from("issuers").select("id, legal_name, trade_name").eq("org_id", orgId).order("id").range(from, to), "dataio.ledger.issuers"),
    fetchAll((from, to) => db.from("cash_accounts").select("id, name").eq("org_id", orgId).eq("issuer_id", issuerId).order("id").range(from, to), "dataio.ledger.cashAccounts"),
    fetchAll((from, to) => db.from("bank_transactions_overview").select("id, account_id, account_name, statement_id, booked_on, value_on, amount_cents, concept, counterparty, reference, bank_code, balance_after_cents, status, matched_cents, remaining_cents, ignored_reason, ignored_note").eq("org_id", orgId).eq("issuer_id", issuerId).gte("booked_on", period.from).lte("booked_on", period.to).order("booked_on").order("id").range(from, to), "dataio.ledger.bankTransactions"),
    fetchAll((from, to) => db.from("bank_statements_overview").select("id, account_id, file_name, format, period_start, period_end, movements_in_file, new_count, opening_balance_cents, closing_balance_cents, period_movements_cents, balance_gap_cents").eq("org_id", orgId).gte("period_end", period.from).lte("period_start", period.to).order("period_start").range(from, to), "dataio.ledger.bankStatements"),
  ]);
  const [expenses, clientReceipts] = await Promise.all([
    resolveNames(db, expenseRows, "vendor_id", "vendors", "name", "dataio.ledger.expenseVendors"),
    resolveNames(db, receiptRows, "client_id", "clients", "display_name", "dataio.ledger.receiptClients"),
  ]);
  const issuerNames = new Map(issuerRows.map((item) => [item.id, item.trade_name ?? item.legal_name]));
  const accountNames = new Map(cashAccounts.map((account) => [account.id, account.name]));
  const receipts = clientReceipts.map((receipt) => ({ ...receipt, issuer_name: receipt.issuer_id ? issuerNames.get(receipt.issuer_id) ?? null : null }));
  if (series.error) throw new DbError(series.error, "dataio.ledger.series");
  if (issuing.error) throw new DbError(issuing.error, "dataio.ledger.issuing");

  const expenseFiles = expenses.flatMap((expense) => expense.attachment_path ? [{ description: expense.description, issuedOn: expense.issued_on, vendorInvoiceNumber: expense.vendor_invoice_number, path: expense.attachment_path }] : []);
  const missingExpenseAttachments = expenses.filter((expense) => !expense.attachment_path).map((expense) => `${expense.issued_on} · ${expense.vendor_invoice_number ?? expense.description}`);
  const invoiceIds = invoices.map((invoice) => invoice.id);
  const historicalInvoiceFiles: LedgerData["historicalInvoiceFiles"] = [];
  for (let i = 0; i < invoiceIds.length; i += 100) {
    const chunk = invoiceIds.slice(i, i + 100);
    const { data, error } = await db.from("invoice_attachments").select("invoice_id, storage_path, file_name, invoices!inner(number, issuer_id)").in("invoice_id", chunk).eq("invoices.issuer_id", issuerId);
    if (error) throw new DbError(error, "dataio.ledger.historicalAttachments");
    const numberById = new Map(invoices.map((invoice) => [invoice.id, invoice.number ?? ""]));
    historicalInvoiceFiles.push(...data.map((file) => ({ number: numberById.get(file.invoice_id) ?? "", fileName: file.file_name, path: file.storage_path })));
  }

  const ids = invoices.map((i) => i.id);
  const lines: Pick<Tables<"invoice_lines">, "invoice_id" | "base_cents" | "vat_bps" | "vat_regime" | "vat_cents" | "irpf_cents">[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    lines.push(
      ...(await fetchAll(
        (from, to) =>
          db
            .from("invoice_lines")
            .select("invoice_id, base_cents, vat_bps, vat_regime, vat_cents, irpf_cents")
            .in("invoice_id", chunk)
            .order("id")
            .range(from, to),
        "dataio.ledger.lines",
      )),
    );
  }
  const rectifiedIds = [...new Set(invoices.flatMap((i) => (i.rectifies_invoice_id ? [i.rectifies_invoice_id] : [])))];
  const rectified = new Map<string, string>();
  for (let i = 0; i < rectifiedIds.length; i += 100) {
    const { data, error } = await db.from("invoices").select("id, number").in("id", rectifiedIds.slice(i, i + 100));
    if (error) throw new DbError(error, "dataio.ledger.rectified");
    for (const r of data) rectified.set(r.id, r.number ?? "");
  }

  const seriesCode = new Map(series.data.map((s) => [s.id, s.code]));
  const linesByInvoice = new Map<string, LedgerInvoice["lines"][number][]>();
  for (const l of lines) {
    const list = linesByInvoice.get(l.invoice_id) ?? [];
    list.push({ baseCents: l.base_cents, vatBps: l.vat_bps, vatRegime: l.vat_regime as VatRegime, vatCents: l.vat_cents, irpfCents: l.irpf_cents });
    linesByInvoice.set(l.invoice_id, list);
  }
  const ledgerInvoices: LedgerInvoice[] = invoices.flatMap((i) => {
    if (!i.number || !i.issued_on) return [];
    const client = (i.client_snapshot ?? {}) as Snapshot;
    return [
      {
        id: i.id,
        number: i.number,
        seriesCode: i.series_id ? (seriesCode.get(i.series_id) ?? null) : null,
        kind: i.kind,
        issuedOn: i.issued_on,
        operationOn: i.operation_on,
        recipient: { name: client.legal_name || client.display_name || "", taxId: client.tax_id ?? null, countryCode: client.country_code ?? null },
        irpfBps: i.irpf_bps,
        rectifiedNumber: i.rectifies_invoice_id ? (rectified.get(i.rectifies_invoice_id) ?? null) : null,
        lines: linesByInvoice.get(i.id) ?? [],
      },
    ];
  });

  return {
    issuer,
    ledger: buildLedger(ledgerInvoices),
    pdfs: invoices.flatMap((i) => (i.pdf_path && i.number ? [{ number: i.number, path: i.pdf_path }] : [])),
    withoutPdf: invoices.flatMap((i) => (!i.pdf_path && i.number ? [i.number] : [])),
    issuing: issuing.count ?? 0,
    expenses,
    payments,
    receipts,
    expenseFiles,
    historicalInvoiceFiles,
    missingExpenseAttachments,
    receiptsWithoutIssuer: await countReceiptsWithoutIssuer(db, orgId, period),
    bankTransactions: bankRows.flatMap((tx) => tx.id && tx.account_id && tx.statement_id && tx.booked_on && tx.amount_cents !== null ? [{
      id: tx.id, accountId: tx.account_id, accountName: tx.account_name ?? accountNames.get(tx.account_id) ?? "", statementId: tx.statement_id,
      bookedOn: tx.booked_on, valueOn: tx.value_on, amountCents: tx.amount_cents, concept: tx.concept ?? "", counterparty: tx.counterparty,
      reference: tx.reference, bankCode: tx.bank_code, balanceAfterCents: tx.balance_after_cents, status: tx.status ?? "unmatched",
      matchedCents: tx.matched_cents ?? 0, remainingCents: tx.remaining_cents ?? Math.abs(tx.amount_cents), ignoredReason: tx.ignored_reason, ignoredNote: tx.ignored_note,
    }] : []),
    bankStatements: statementRows.flatMap((s) => s.id && s.account_id && accountNames.has(s.account_id) && s.file_name && s.format && s.period_start && s.period_end ? [{
      id: s.id, accountId: s.account_id, accountName: accountNames.get(s.account_id) ?? "", fileName: s.file_name, format: s.format,
      periodStart: s.period_start, periodEnd: s.period_end, movementsInFile: s.movements_in_file ?? 0, newCount: s.new_count ?? 0,
      openingBalanceCents: s.opening_balance_cents, closingBalanceCents: s.closing_balance_cents,
      periodMovementsCents: s.period_movements_cents ?? 0, balanceGapCents: s.balance_gap_cents,
    }] : []),
  };
}

async function countReceiptsWithoutIssuer(db: Db, orgId: string, period: ExportPeriod): Promise<number> {
  const { count, error } = await db.from("client_receipts").select("id", { count: "exact", head: true }).eq("org_id", orgId).is("issuer_id", null).gte("received_on", period.from).lte("received_on", period.to);
  if (error) throw new DbError(error, "dataio.ledger.unassignedReceipts");
  return count ?? 0;
}

async function fetchIssuerReceipts(db: Db, orgId: string, issuerId: string, period: ExportPeriod) {
  return fetchAll(
    (from, to) => db.from("client_receipts").select("id, org_id, client_id, received_on, amount_cents, method, concept, reference, project_id, notes, created_at, updated_at, created_by, issuer_id, cash_account_id").eq("org_id", orgId).eq("issuer_id", issuerId).gte("received_on", period.from).lte("received_on", period.to).order("received_on").order("id").range(from, to),
    "dataio.ledger.receipts",
  );
}

async function resolveNames<T extends { [key: string]: unknown }>(db: Db, rows: T[], idKey: "vendor_id" | "client_id", table: "vendors" | "clients", nameKey: "name" | "display_name", operation: string) {
  const ids = [...new Set(rows.flatMap((row) => (typeof row[idKey] === "string" ? [row[idKey]] : [])))];
  const names = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 100) {
    if (table === "vendors") {
      const { data, error } = await db.from("vendors").select("id, name").in("id", ids.slice(i, i + 100));
      if (error) throw new DbError(error, operation);
      for (const item of data) names.set(item.id, item.name);
    } else {
      const { data, error } = await db.from("clients").select("id, display_name").in("id", ids.slice(i, i + 100));
      if (error) throw new DbError(error, operation);
      for (const item of data) names.set(item.id, item.display_name);
    }
  }
  return rows.map((row) => ({ ...row, [idKey === "vendor_id" ? "vendor_name" : "client_name"]: typeof row[idKey] === "string" ? names.get(row[idKey] as string) ?? null : null })) as (T & { vendor_name: string | null; client_name: string | null })[];
}

async function fetchInvoicePayments(db: Db, orgId: string, issuerId: string, period: ExportPeriod) {
  const invoiceRows = await fetchAll(
    (from, to) => db.from("invoices").select("id, number").eq("org_id", orgId).eq("issuer_id", issuerId).eq("lifecycle", "issued").order("id").range(from, to),
    "dataio.ledger.paymentInvoices",
  );
  const numbers = new Map(invoiceRows.map((invoice) => [invoice.id, invoice.number]));
  const ids = [...numbers.keys()];
  const result: LedgerData["payments"] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const rows = await fetchAll(
      (from, to) => db.from("payments").select("id, org_id, invoice_id, amount_cents, paid_on, method, reference, provider_ref, notes, created_at, updated_at, created_by").eq("org_id", orgId).in("invoice_id", chunk).gte("paid_on", period.from).lte("paid_on", period.to).order("paid_on").order("id").range(from, to),
      "dataio.ledger.payments",
    );
    result.push(...rows.map((payment) => ({ ...payment, invoice_number: numbers.get(payment.invoice_id) ?? null })));
  }
  return result.sort((a, b) => a.paid_on.localeCompare(b.paid_on) || a.id.localeCompare(b.id));
}

/** Nombre base de los ficheros: "libro-registro-B12345674-2026-T3". */
export function ledgerBaseName(data: LedgerData, period: ExportPeriod): string {
  return safeFileName(`libro-registro-${data.issuer.tax_id ?? data.issuer.legal_name}-${period.key}`).replace(/\s+/g, "-");
}

async function labels() {
  const t = await getTranslations("dataio.ledger");
  return {
    sheet: t("sheet"),
    summarySheet: t("summarySheet"),
    columns: {
      year: t("columns.year"),
      period: t("columns.period"),
      issued_on: t("columns.issuedOn"),
      operation_on: t("columns.operationOn"),
      series: t("columns.series"),
      number: t("columns.number"),
      recipient_tax_id: t("columns.recipientTaxId"),
      recipient_name: t("columns.recipientName"),
      recipient_country: t("columns.recipientCountry"),
      base: t("columns.base"),
      vat_rate: t("columns.vatRate"),
      vat_amount: t("columns.vatAmount"),
      vat_regime: t("columns.vatRegime"),
      irpf_rate: t("columns.irpfRate"),
      irpf_amount: t("columns.irpfAmount"),
      total: t("columns.total"),
      rectifying: t("columns.rectifying"),
      rectified_number: t("columns.rectifiedNumber"),
    },
    summaryColumns: {
      vat_rate: t("columns.vatRate"),
      vat_regime: t("columns.vatRegime"),
      base: t("columns.base"),
      vat_amount: t("columns.vatAmount"),
      irpf_amount: t("columns.irpfAmount"),
      total: t("columns.total"),
    },
    regimes: {
      general: t("regimes.general"),
      exempt: t("regimes.exempt"),
      reverse_charge_eu: t("regimes.reverse_charge_eu"),
      not_subject: t("regimes.not_subject"),
    },
    yes: t("yes"),
    no: t("no"),
    total: t("total"),
    quarter: (quarter: number) => t("quarter", { quarter }),
  };
}

function zipDate(timeZone: string) {
  const now = new Date();
  const { date, hour } = nowInZone(timeZone, now);
  return { year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)), day: Number(date.slice(8, 10)), hour, minute: now.getUTCMinutes() };
}

/** El libro en CSV (Excel en español) y en XLSX (con la hoja de resumen por tipo). */
export async function ledgerFiles(data: LedgerData, timeZone: string): Promise<{ csv: Uint8Array; xlsx: Uint8Array }> {
  const { main, summary } = ledgerSheets(data.ledger, await labels());
  return {
    csv: encodeUtf8(sheetToCsv(main)),
    xlsx: sheetsToXlsx([main, summary], { deflateRaw, modified: zipDate(timeZone) }),
  };
}

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Paquete por emisor y periodo. Los adjuntos se descargan solo desde rutas autorizadas por filas
 * leídas con RLS en `loadLedger`; gastos y cobros salen también en CSV para preservar trazabilidad.
 */
export async function ledgerZip(admin: Admin, data: LedgerData, period: ExportPeriod, timeZone: string): Promise<Uint8Array> {
  const t = await getTranslations("dataio.export");
  const base = ledgerBaseName(data, period);
  const files = await ledgerFiles(data, timeZone);
  const entries: ZipEntry[] = [
    { name: `${base}.csv`, data: files.csv },
    { name: `${base}.xlsx`, data: files.xlsx, compress: false },
  ];
  entries.push(
    { name: `${base}-gastos.csv`, data: encodeUtf8(sheetToCsv(expensesSheet(data))) },
    { name: `${base}-pagos-facturas.csv`, data: encodeUtf8(sheetToCsv(paymentsSheet(data))) },
    { name: `${base}-cobros-sin-factura.csv`, data: encodeUtf8(sheetToCsv(receiptsSheet(data))) },
    { name: `${base}-movimientos-bancarios.csv`, data: encodeUtf8(sheetToCsv(bankTransactionsSheet(data))) },
    { name: `${base}-control-extractos.csv`, data: encodeUtf8(sheetToCsv(bankStatementsSheet(data))) },
  );
  const used = new Set<string>();
  const missing: string[] = [];
  for (const pdf of data.pdfs) {
    const { data: blob, error } = await admin.storage.from("invoices").download(pdf.path);
    if (error || !blob) {
      missing.push(pdf.number);
      continue;
    }
    let name = `${t("pdfFolder")}/${safeFileName(pdf.number)}.pdf`;
    for (let n = 2; used.has(name); n++) name = `${t("pdfFolder")}/${safeFileName(pdf.number)}-${n}.pdf`;
    used.add(name);
    entries.push({ name, data: new Uint8Array(await blob.arrayBuffer()), compress: false });
  }
  const expenseFolder = t("expenseFolder");
  for (const [index, item] of data.expenseFiles.entries()) {
    const blob = await admin.storage.from("expenses").download(item.path);
    if (blob.error || !blob.data) { missing.push(`${item.issuedOn} · ${item.vendorInvoiceNumber ?? item.description}`); continue; }
    let name = `${expenseFolder}/${String(index + 1).padStart(3, "0")}-${safeFileName(item.vendorInvoiceNumber ?? item.description)}.${item.path.split(".").at(-1) ?? "bin"}`;
    for (let n = 2; used.has(name); n++) name = `${expenseFolder}/${String(index + 1).padStart(3, "0")}-${safeFileName(item.description)}-${n}.${item.path.split(".").at(-1) ?? "bin"}`;
    used.add(name);
    entries.push({ name, data: new Uint8Array(await blob.data.arrayBuffer()), compress: false });
  }
  for (const [index, item] of data.historicalInvoiceFiles.entries()) {
    const original = await admin.storage.from("invoice-attachments").download(item.path);
    if (original.error || !original.data) { missing.push(`${item.number} (PDF original)`); continue; }
    let name = `${t("historicalFolder")}/${safeFileName(item.number || item.fileName)}.pdf`;
    for (let n = 2; used.has(name); n++) name = `${t("historicalFolder")}/${safeFileName(item.number || String(index + 1))}-${n}.pdf`;
    used.add(name);
    entries.push({ name, data: new Uint8Array(await original.data.arrayBuffer()), compress: false });
  }
  const notes = [
    ...(data.withoutPdf.length > 0 ? [t("readmeImported", { numbers: data.withoutPdf.join(", ") })] : []),
    ...(data.issuing > 0 ? [t("readmeIssuing", { count: data.issuing })] : []),
    ...(data.missingExpenseAttachments.length > 0 ? [t("readmeNoExpenseFile", { items: data.missingExpenseAttachments.join(", ") })] : []),
    ...(data.receiptsWithoutIssuer > 0 ? [t("readmeUnassigned", { count: data.receiptsWithoutIssuer })] : []),
    ...(missing.length > 0 ? [t("readmeMissing", { numbers: missing.join(", ") })] : []),
    t("readmeScope"),
  ];
  if (notes.length > 0) entries.push({ name: t("readmeName"), data: encodeUtf8(`${notes.join("\r\n\r\n")}\r\n`) });
  const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
  const manifest = {
    schema_version: 1,
    issuer: { id: data.issuer.id, name: data.issuer.legal_name, tax_id: data.issuer.tax_id },
    period: { from: period.from, to: period.to, key: period.key },
    control_totals_cents: {
      issued_invoice_total: data.ledger.totals.totalCents,
      issued_invoice_base: data.ledger.totals.baseCents,
      issued_invoice_vat: data.ledger.totals.vatCents,
      issued_invoice_irpf: data.ledger.totals.irpfCents,
      expenses_total: sum(data.expenses.map((expense) => expense.total_cents)),
      invoice_payments_received: sum(data.payments.map((payment) => payment.amount_cents)),
      receipts_without_invoice: sum(data.receipts.map((receipt) => receipt.amount_cents)),
      bank_credits: sum(data.bankTransactions.filter((tx) => tx.amountCents > 0).map((tx) => tx.amountCents)),
      bank_debits: sum(data.bankTransactions.filter((tx) => tx.amountCents < 0).map((tx) => tx.amountCents)),
      bank_unreconciled_absolute: sum(data.bankTransactions.filter((tx) => tx.status === "unmatched" || tx.status === "partial").map((tx) => tx.remainingCents)),
    },
    counts: {
      issued_invoices: data.ledger.totals.invoices,
      expenses: data.expenses.length,
      invoice_payments: data.payments.length,
      receipts_without_invoice: data.receipts.length,
      receipts_without_issuer_excluded: data.receiptsWithoutIssuer,
      bank_transactions: data.bankTransactions.length,
      bank_statements_overlapping_period: data.bankStatements.length,
      bank_statements_without_balance_control: data.bankStatements.filter((s) => s.balanceGapCents === null).length,
      bank_statements_with_gap: data.bankStatements.filter((s) => s.balanceGapCents !== null && s.balanceGapCents !== 0).length,
      missing_documents: missing.length + data.missingExpenseAttachments.length,
    },
    notes: "Importes por fecha propia de cada libro. Cobros y movimientos bancarios no equivalen sin conciliación; extractos pueden solaparse con el periodo. Fichero original bancario no conservado por el importador actual.",
    missing_documents: [...data.missingExpenseAttachments, ...missing],
    files: entries.map((entry) => ({ name: entry.name, bytes: entry.data.byteLength, sha256: createHash("sha256").update(entry.data).digest("hex") })),
  };
  entries.push({ name: `${base}-manifiesto.json`, data: encodeUtf8(JSON.stringify(manifest, null, 2)) });
  return createZip(entries, { deflateRaw, modified: zipDate(timeZone) });
}

const column = (header: string, type: SheetColumn["type"]): SheetColumn => ({ header, type });
const row = (cells: SheetCell[]) => ({ cells });
function expensesSheet(data: LedgerData) {
  return { name: "Gastos", columns: [column("Proveedor", "text"), column("Proveedor ID", "text"), column("Nº factura proveedor", "text"), column("Concepto", "text"), column("Fecha factura", "date"), column("Vencimiento", "date"), column("Base", "money"), column("IVA", "money"), column("IVA deducible", "text"), column("IRPF", "money"), column("Total", "money"), column("Fecha pago", "date"), column("Método", "text"), column("Justificante", "text"), column("Notas", "text")], rows: data.expenses.map((e) => row([e.vendor_name, e.vendor_id, e.vendor_invoice_number, e.description, e.issued_on, e.due_on, e.base_cents, e.vat_cents, e.vat_deductible ? "Sí" : "No", e.irpf_cents, e.total_cents, e.paid_on, e.payment_method, e.attachment_path ? "Incluido si descarga correcta" : "Falta", e.notes])) } as Sheet;
}
function paymentsSheet(data: LedgerData) {
  return { name: "Pagos facturas", columns: [column("Factura", "text"), column("Fecha cobro", "date"), column("Importe", "money"), column("Método", "text"), column("Referencia", "text"), column("Ref. proveedor", "text"), column("Notas", "text")], rows: data.payments.map((p) => row([p.invoice_number, p.paid_on, p.amount_cents, p.method, p.reference, p.provider_ref, p.notes])) } as Sheet;
}
function receiptsSheet(data: LedgerData) {
  return { name: "Cobros sin factura", columns: [column("Fecha", "date"), column("Cliente", "text"), column("Cliente ID", "text"), column("Concepto", "text"), column("Importe", "money"), column("Método", "text"), column("Emisor", "text"), column("Emisor ID", "text"), column("Referencia", "text"), column("Notas", "text")], rows: data.receipts.map((r) => row([r.received_on, r.client_name, r.client_id, r.concept, r.amount_cents, r.method, r.issuer_name, r.issuer_id, r.reference, r.notes])) } as Sheet;
}
function bankTransactionsSheet(data: LedgerData): Sheet {
  return { name: "Movimientos bancarios", columns: [column("Movimiento ID", "text"), column("Cuenta", "text"), column("Cuenta ID", "text"), column("Extracto ID", "text"), column("Fecha operación", "date"), column("Fecha valor", "date"), column("Importe con signo", "money"), column("Concepto", "text"), column("Contraparte", "text"), column("Referencia", "text"), column("Código bancario", "text"), column("Saldo tras movimiento", "money"), column("Estado conciliación", "text"), column("Conciliado", "money"), column("Pendiente absoluto", "money"), column("Motivo exclusión", "text"), column("Nota exclusión", "text")], rows: data.bankTransactions.map((tx) => row([tx.id, tx.accountName, tx.accountId, tx.statementId, tx.bookedOn, tx.valueOn, tx.amountCents, tx.concept, tx.counterparty, tx.reference, tx.bankCode, tx.balanceAfterCents, tx.status, tx.matchedCents, tx.remainingCents, tx.ignoredReason, tx.ignoredNote])) };
}
function bankStatementsSheet(data: LedgerData): Sheet {
  return { name: "Control extractos", columns: [column("Extracto ID", "text"), column("Cuenta", "text"), column("Cuenta ID", "text"), column("Nombre original", "text"), column("Formato", "text"), column("Desde", "date"), column("Hasta", "date"), column("Movimientos en fichero", "integer"), column("Nuevos importados", "integer"), column("Saldo inicial", "money"), column("Saldo final", "money"), column("Movimiento periodo", "money"), column("Descuadre", "money")], rows: data.bankStatements.map((statement) => row([statement.id, statement.accountName, statement.accountId, statement.fileName, statement.format, statement.periodStart, statement.periodEnd, statement.movementsInFile, statement.newCount, statement.openingBalanceCents, statement.closingBalanceCents, statement.periodMovementsCents, statement.balanceGapCents])) };
}
