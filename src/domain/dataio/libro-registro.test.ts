import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";
import { buildLedger, type LedgerInvoice, type LedgerLabels, ledgerSheets } from "./libro-registro";
import { parseExportPeriod, previousQuarter, quarterOf } from "./period";
import { formatCentsEs, formatDateEs, sheetToCsv, sheetsToXlsx } from "./sheet";

const labels: LedgerLabels = {
  sheet: "Libro registro",
  summarySheet: "Resumen por tipo",
  columns: {
    year: "Ejercicio",
    period: "Periodo",
    issued_on: "Fecha de expedición",
    operation_on: "Fecha de operación",
    series: "Serie",
    number: "Número",
    recipient_tax_id: "NIF destinatario",
    recipient_name: "Nombre destinatario",
    recipient_country: "País",
    base: "Base imponible",
    vat_rate: "Tipo de IVA (%)",
    vat_amount: "Cuota de IVA",
    vat_regime: "Régimen de IVA",
    irpf_rate: "Tipo de retención (%)",
    irpf_amount: "Retención IRPF",
    total: "Total",
    rectifying: "Rectificativa",
    rectified_number: "Factura rectificada",
  },
  summaryColumns: {
    vat_rate: "Tipo de IVA (%)",
    vat_regime: "Régimen de IVA",
    base: "Base imponible",
    vat_amount: "Cuota de IVA",
    irpf_amount: "Retención IRPF",
    total: "Total",
  },
  regimes: { general: "General", exempt: "Exenta", reverse_charge_eu: "Inversión del sujeto pasivo", not_subject: "No sujeta" },
  yes: "Sí",
  no: "No",
  total: "TOTAL",
  quarter: (q) => `${q}T`,
};

const invoices: LedgerInvoice[] = [
  {
    id: "b",
    number: "2026-0039",
    seriesCode: "F",
    kind: "ordinary",
    issuedOn: "2026-08-03",
    operationOn: "2026-07-31",
    recipient: { name: "Fabrik Madrid SL", taxId: "B87654315", countryCode: "ES" },
    irpfBps: 1500,
    rectifiedNumber: null,
    lines: [
      { baseCents: 150_000, vatBps: 2100, vatRegime: "general", vatCents: 31_500, irpfCents: 22_500 },
      { baseCents: 50_000, vatBps: 0, vatRegime: "exempt", vatCents: 0, irpfCents: 7_500 },
      { baseCents: 10_000, vatBps: 2100, vatRegime: "general", vatCents: 2_100, irpfCents: 1_500 },
    ],
  },
  {
    id: "a",
    number: "2026-0038",
    seriesCode: "F",
    kind: "ordinary",
    issuedOn: "2026-07-15",
    operationOn: "2026-07-15",
    recipient: { name: "Port Mataró SL", taxId: "B12345674", countryCode: "ES" },
    irpfBps: 1500,
    rectifiedNumber: null,
    lines: [{ baseCents: 90_000, vatBps: 2100, vatRegime: "general", vatCents: 18_900, irpfCents: 13_500 }],
  },
  {
    id: "c",
    number: "R2026-0001",
    seriesCode: "R",
    kind: "rectifying",
    issuedOn: "2026-09-01",
    operationOn: null,
    recipient: { name: "Port Mataró SL", taxId: "B12345674", countryCode: "ES" },
    irpfBps: 1500,
    rectifiedNumber: "2026-0038",
    lines: [{ baseCents: -90_000, vatBps: 2100, vatRegime: "general", vatCents: -18_900, irpfCents: -13_500 }],
  },
];

describe("buildLedger", () => {
  it("una fila por tipo de IVA de cada factura, por fecha, con su parte de IRPF y total", () => {
    const ledger = buildLedger(invoices);
    expect(ledger.rows.map((r) => [r.number, r.vatBps, r.vatRegime, r.baseCents, r.vatCents, r.irpfCents, r.totalCents])).toEqual([
      ["2026-0038", 2100, "general", 90_000, 18_900, 13_500, 95_400],
      ["2026-0039", 2100, "general", 160_000, 33_600, 24_000, 169_600],
      ["2026-0039", 0, "exempt", 50_000, 0, 7_500, 42_500],
      ["R2026-0001", 2100, "general", -90_000, -18_900, -13_500, -95_400],
    ]);
    // La fecha de operación solo si es distinta de la de expedición.
    expect(ledger.rows.map((r) => r.operationOn)).toEqual([null, "2026-07-31", "2026-07-31", null]);
    expect(ledger.rows[3]).toMatchObject({ rectifying: true, rectifiedNumber: "2026-0038", quarter: 3, year: 2026 });
    expect(ledger.totals).toEqual({ invoices: 3, baseCents: 210_000, vatCents: 33_600, irpfCents: 31_500, totalCents: 212_100 });
    expect(ledger.byRate).toEqual([
      { vatBps: 2100, vatRegime: "general", baseCents: 160_000, vatCents: 33_600, irpfCents: 24_000, totalCents: 169_600 },
      { vatBps: 0, vatRegime: "exempt", baseCents: 50_000, vatCents: 0, irpfCents: 7_500, totalCents: 42_500 },
    ]);
  });

  it("la suma de las filas de una factura es su total", () => {
    const ledger = buildLedger(invoices);
    const b = ledger.rows.filter((r) => r.invoiceId === "b").reduce((s, r) => s + r.totalCents, 0);
    expect(b).toBe(210_000 + 33_600 - 31_500);
  });
});

describe("CSV para Excel en español", () => {
  it("BOM, ';', CRLF, coma decimal, fechas dd/mm/aaaa y fila de totales", () => {
    const { main } = ledgerSheets(buildLedger(invoices), labels);
    const csv = sheetToCsv(main);
    expect(csv.startsWith("﻿Ejercicio;Periodo;Fecha de expedición;")).toBe(true);
    expect(csv.includes("\r\n")).toBe(true);
    const lines = csv.slice(1).split("\r\n");
    expect(lines[1]).toBe("2026;3T;15/07/2026;;F;2026-0038;B12345674;Port Mataró SL;ES;900,00;21,00;189,00;General;15,00;135,00;954,00;No;");
    expect(lines[3]).toBe("2026;3T;03/08/2026;31/07/2026;F;2026-0039;B87654315;Fabrik Madrid SL;ES;500,00;0,00;0,00;Exenta;15,00;75,00;425,00;No;");
    expect(lines[4]).toContain(";-900,00;21,00;-189,00;General;15,00;-135,00;-954,00;Sí;2026-0038");
    expect(lines[5]).toBe("TOTAL;;;;;;;;;2100,00;;336,00;;;315,00;2121,00;;");
    // Se vuelve a leer igual.
    expect(parseCsv(csv).rows).toHaveLength(5);
  });

  it("formatos", () => {
    expect(formatCentsEs(123_456)).toBe("1234,56");
    expect(formatCentsEs(-50)).toBe("-0,50");
    expect(formatCentsEs(5)).toBe("0,05");
    expect(formatDateEs("2026-01-05")).toBe("05/01/2026");
  });
});

/** Lee un ZIP de entradas guardadas (sin comprimir) y devuelve el texto de cada una. */
function readStoredZip(zip: Uint8Array): Map<string, string> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const out = new Map<string, string>();
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    expect(view.getUint16(offset + 8, true)).toBe(0);
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extra = view.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(zip.subarray(offset + 30, offset + 30 + nameLength));
    const start = offset + 30 + nameLength + extra;
    out.set(name, new TextDecoder().decode(zip.subarray(start, start + size)));
    offset = start + size;
  }
  return out;
}

describe("XLSX", () => {
  it("un libro con dos hojas: números de verdad, fechas como serie de Excel y textos en línea", () => {
    const { main, summary } = ledgerSheets(buildLedger(invoices), labels);
    const files = readStoredZip(sheetsToXlsx([main, summary]));
    expect([...files.keys()]).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/worksheets/sheet1.xml",
      "xl/worksheets/sheet2.xml",
    ]);
    expect(files.get("xl/workbook.xml")).toContain('<sheet name="Libro registro" sheetId="1" r:id="rId1"/>');
    const sheet = files.get("xl/worksheets/sheet1.xml")!;
    // 15/07/2026 = 46218 días desde el 30/12/1899; 900,00 € como número con estilo de importe.
    expect(sheet).toContain('<c r="C2" s="3"><v>46218</v></c>');
    expect(sheet).toContain('<c r="J2" s="2"><v>900.00</v></c>');
    expect(sheet).toContain('<c r="H2" t="inlineStr"><is><t>Port Mataró SL</t></is></c>');
    expect(sheet).toContain('<c r="K2" s="4"><v>21.00</v></c>');
    // Fila de totales en negrita.
    expect(sheet).toContain('<c r="A6" t="inlineStr" s="1"><is><t>TOTAL</t></is></c>');
    expect(sheet).toContain('<c r="J6" s="5"><v>2100.00</v></c>');
    expect(sheet).toContain('<autoFilter ref="A1:R6"/>');
    expect(files.get("xl/worksheets/sheet2.xml")).toContain("<t>Exenta</t>");
  });

  it("escapa el XML y no escribe caracteres de control", () => {
    const xlsx = sheetsToXlsx([
      { name: "Hoja: [1]", columns: [{ header: "Nombre", type: "text" }], rows: [{ cells: ['Port & "Mataró" <SL>\u0001'] }] },
    ]);
    const files = readStoredZip(xlsx);
    expect(files.get("xl/workbook.xml")).toContain('name="Hoja   1"');
    expect(files.get("xl/worksheets/sheet1.xml")).toContain("<t>Port &amp; &quot;Mataró&quot; &lt;SL&gt;</t>");
  });
});

describe("periodos", () => {
  it("trimestres y años", () => {
    expect(parseExportPeriod("2026-T3")).toEqual({ key: "2026-T3", year: 2026, quarter: 3, from: "2026-07-01", to: "2026-09-30" });
    expect(parseExportPeriod("2026-q1")).toMatchObject({ key: "2026-T1", from: "2026-01-01", to: "2026-03-31" });
    expect(parseExportPeriod("2026-T2")).toMatchObject({ to: "2026-06-30" });
    expect(parseExportPeriod("2026-T4")).toMatchObject({ from: "2026-10-01", to: "2026-12-31" });
    expect(parseExportPeriod("2026")).toEqual({ key: "2026", year: 2026, quarter: null, from: "2026-01-01", to: "2026-12-31" });
    expect(parseExportPeriod("2026-T5")).toBeNull();
    expect(parseExportPeriod("hoy")).toBeNull();
  });

  it("trimestre de una fecha y el anterior (el que se presenta)", () => {
    expect(quarterOf("2026-09-26").key).toBe("2026-T3");
    expect(previousQuarter("2026-09-26").key).toBe("2026-T2");
    expect(previousQuarter("2026-02-10").key).toBe("2025-T4");
  });
});
