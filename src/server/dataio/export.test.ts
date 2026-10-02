import { describe, expect, it, vi } from "vitest";
import { inflateRawSync } from "node:zlib";

const mocks = vi.hoisted(() => ({
  translations: new Map<string, string>(),
  downloads: new Map<string, Uint8Array>(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string, args?: Record<string, string | number>) => {
    let value = mocks.translations.get(key) ?? key;
    for (const [name, replacement] of Object.entries(args ?? {})) value = value.replaceAll(`{${name}}`, String(replacement));
    return value;
  },
}));

import { ledgerZip, type LedgerData } from "./export";
import { decodeText } from "@/domain/dataio/text";

function entries(zip: Uint8Array) {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let eocd = zip.length - 22;
  while (eocd >= 0 && view.getUint32(eocd, true) !== 0x06054b50) eocd -= 1;
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const found = new Map<string, string>();
  for (let index = 0; index < count; index++) {
    const length = view.getUint16(offset + 28, true);
    const local = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(zip.subarray(offset + 46, offset + 46 + length));
    const localName = view.getUint16(local + 26, true);
    const extra = view.getUint16(local + 28, true);
    const start = local + 30 + localName + extra;
    const compressedSize = view.getUint32(local + 18, true);
    const raw = zip.subarray(start, start + compressedSize);
    const content = view.getUint16(offset + 10, true) === 8 ? new Uint8Array(inflateRawSync(raw)) : raw;
    found.set(name, decodeText(content).text);
    offset += 46 + length;
  }
  return found;
}

describe("ledger advisor package", () => {
  it("bundles separate ledgers, available documents and explicit completeness warnings", async () => {
    mocks.translations = new Map([
      ["pdfFolder", "facturas"], ["expenseFolder", "gastos"], ["historicalFolder", "originales"], ["readmeName", "LEEME.txt"],
      ["readmeNoExpenseFile", "Sin justificante: {items}"], ["readmeUnassigned", "Sin emisor: {count}"], ["readmeScope", "Revisar con asesoría"],
      ["sheet", "Libro"], ["summarySheet", "Resumen"], ["columns.year", "Año"], ["columns.period", "Periodo"],
    ]);
    const data = {
      issuer: { id: "issuer-1", legal_name: "GNERAI", trade_name: null, tax_id: "B12345678" },
      ledger: { rows: [], totals: { invoices: 0, baseCents: 0, vatCents: 0, irpfCents: 0, totalCents: 0 }, byRate: [] },
      pdfs: [], withoutPdf: [], issuing: 0, expenses: [], payments: [], receipts: [],
      expenseFiles: [{ description: "Dominio", issuedOn: "2026-01-10", vendorInvoiceNumber: "DOM-1", path: "org/expense.pdf" }],
      historicalInvoiceFiles: [{ number: "2026-0001", fileName: "original.pdf", path: "org/invoice.pdf" }],
      missingExpenseAttachments: ["2026-01-11 · Suscripción"], receiptsWithoutIssuer: 2,
      bankTransactions: [{ id: "tx-1", accountId: "account-1", accountName: "Banco SL", statementId: "statement-1", bookedOn: "2026-02-01", valueOn: "2026-02-01", amountCents: 12000, concept: "Cobro", counterparty: "Cliente", reference: null, bankCode: null, balanceAfterCents: 12000, status: "partial", matchedCents: 7000, remainingCents: 5000, ignoredReason: null, ignoredNote: null }],
      bankStatements: [{ id: "statement-1", accountId: "account-1", accountName: "Banco SL", fileName: "febrero.n43", format: "n43", periodStart: "2026-02-01", periodEnd: "2026-02-28", movementsInFile: 1, newCount: 1, openingBalanceCents: 0, closingBalanceCents: 12000, periodMovementsCents: 12000, balanceGapCents: 0 }],
    } as unknown as LedgerData;
    const admin = { storage: { from: (bucket: string) => ({ download: async () => ({ data: new Blob([new Uint8Array(mocks.downloads.get(bucket) ?? [37, 80, 68, 70])]), error: null }) }) } } as never;
    const zip = await ledgerZip(admin, data, { key: "2026-T1", year: 2026, quarter: 1, from: "2026-01-01", to: "2026-03-31" }, "Europe/Madrid");
    const files = entries(zip);
    expect(files.has("libro-registro-B12345678-2026-T1-gastos.csv")).toBe(true);
    expect(files.has("libro-registro-B12345678-2026-T1-pagos-facturas.csv")).toBe(true);
    expect(files.has("libro-registro-B12345678-2026-T1-cobros-sin-factura.csv")).toBe(true);
    expect(files.get("libro-registro-B12345678-2026-T1-movimientos-bancarios.csv")).toContain("120,00");
    expect(files.get("libro-registro-B12345678-2026-T1-control-extractos.csv")).toContain("febrero.n43");
    const manifest = JSON.parse(files.get("libro-registro-B12345678-2026-T1-manifiesto.json") ?? "{}") as { control_totals_cents: Record<string, number>; counts: Record<string, number>; files: { name: string; sha256: string }[] };
    expect(manifest.control_totals_cents.bank_credits).toBe(12000);
    expect(manifest.control_totals_cents.bank_unreconciled_absolute).toBe(5000);
    expect(manifest.counts.bank_statements_with_gap).toBe(0);
    expect(manifest.files).toEqual(expect.arrayContaining([expect.objectContaining({ name: "libro-registro-B12345678-2026-T1-movimientos-bancarios.csv", sha256: expect.stringMatching(/^[0-9a-f]{64}$/) })]));
    expect(files.has("gastos/001-DOM-1.pdf")).toBe(true);
    expect(files.has("originales/2026-0001.pdf")).toBe(true);
    expect(files.get("LEEME.txt")).toContain("Sin justificante: 2026-01-11 · Suscripción");
    expect(files.get("LEEME.txt")).toContain("Sin emisor: 2");
    expect(files.get("LEEME.txt")).toContain("Revisar con asesoría");
  });
});
