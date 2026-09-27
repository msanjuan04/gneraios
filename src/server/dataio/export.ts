import "server-only";
import { deflateRawSync } from "node:zlib";
import { getTranslations } from "next-intl/server";
import { buildLedger, type Ledger, type LedgerInvoice, ledgerSheets } from "@/domain/dataio/libro-registro";
import type { ExportPeriod } from "@/domain/dataio/period";
import { sheetToCsv, sheetsToXlsx } from "@/domain/dataio/sheet";
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
};

const deflateRaw = (data: Uint8Array) => new Uint8Array(deflateRawSync(data));

/**
 * Facturas emitidas por un emisor en un periodo, leídas con la sesión del usuario: RLS decide qué
 * ve (y solo ve su org). null si el emisor no existe o no es de la org.
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

  const [invoices, series, issuing] = await Promise.all([
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
  ]);
  if (series.error) throw new DbError(series.error, "dataio.ledger.series");
  if (issuing.error) throw new DbError(issuing.error, "dataio.ledger.issuing");

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
  };
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
 * ZIP para la gestoría: el libro (CSV y XLSX) y los PDF emitidos del periodo, tal y como se
 * guardaron (copia legal). Los PDF se leen con la clave de servidor, pero solo los de facturas que
 * el usuario ya ha podido leer con RLS en `loadLedger`.
 */
export async function ledgerZip(admin: Admin, data: LedgerData, period: ExportPeriod, timeZone: string): Promise<Uint8Array> {
  const t = await getTranslations("dataio.export");
  const base = ledgerBaseName(data, period);
  const files = await ledgerFiles(data, timeZone);
  const entries: ZipEntry[] = [
    { name: `${base}.csv`, data: files.csv },
    { name: `${base}.xlsx`, data: files.xlsx, compress: false },
  ];
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
  const notes = [
    ...(data.withoutPdf.length > 0 ? [t("readmeImported", { numbers: data.withoutPdf.join(", ") })] : []),
    ...(missing.length > 0 ? [t("readmeMissing", { numbers: missing.join(", ") })] : []),
    ...(data.issuing > 0 ? [t("readmeIssuing", { count: data.issuing })] : []),
  ];
  if (notes.length > 0) entries.push({ name: t("readmeName"), data: encodeUtf8(`${notes.join("\r\n\r\n")}\r\n`) });
  return createZip(entries, { deflateRaw, modified: zipDate(timeZone) });
}
