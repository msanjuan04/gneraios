// Una tabla para exportar (columnas con tipo y filas) y sus dos salidas:
// - CSV que Excel en español abre bien a la primera: ";", coma decimal, fechas dd/mm/aaaa, UTF-8
//   con BOM y saltos CRLF. Sin separador de miles: así ningún programa lo confunde con un decimal.
// - XLSX con los mismos datos como números, fechas y textos de verdad (sumables en Excel).

import { daysBetween, parseCivilDate, type CivilDate } from "../dates/civil-date";
import { protectFormula, toCsv } from "./csv";
import { encodeUtf8 } from "./text";
import { createZip, type ZipOptions } from "./zip";

export type ColumnType = "text" | "date" | "money" | "percent" | "integer";

export type SheetColumn = {
  header: string;
  type: ColumnType;
  /** Ancho en caracteres en el XLSX. */
  width?: number;
};

/** text: string · date: fecha civil "YYYY-MM-DD" · money: céntimos · percent: puntos básicos · integer: número. */
export type SheetCell = string | number | null;

export type SheetRow = { cells: SheetCell[]; bold?: boolean };

export type Sheet = { name: string; columns: SheetColumn[]; rows: SheetRow[] };

/** Céntimos con coma decimal y sin miles: 123456 → "1234,56"; −50 → "-0,50". */
export function formatCentsEs(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const digits = String(Math.abs(cents)).padStart(3, "0");
  return `${sign}${digits.slice(0, -2)},${digits.slice(-2)}`;
}

/** Céntimos como decimal con punto (el formato del XML de Excel): 123456 → "1234.56". */
function centsToDecimal(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const digits = String(Math.abs(cents)).padStart(3, "0");
  return `${sign}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

/** Puntos básicos como porcentaje con 2 decimales: 2100 → "21,00". */
export function formatBpsEs(bps: number): string {
  return formatCentsEs(bps);
}

/** "2026-09-26" → "26/09/2026". */
export function formatDateEs(date: CivilDate): string {
  const { year, month, day } = parseCivilDate(date);
  return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
}

function formatCsvCell(cell: SheetCell, type: ColumnType): string {
  if (cell === null || cell === "") return "";
  switch (type) {
    case "money":
    case "percent":
      return typeof cell === "number" ? formatCentsEs(cell) : protectFormula(String(cell));
    case "date":
      return typeof cell === "string" && /^\d{4}-\d{2}-\d{2}$/.test(cell) ? formatDateEs(cell) : protectFormula(String(cell));
    case "integer":
      return String(cell);
    case "text":
      return protectFormula(String(cell));
  }
}

/** La tabla como CSV para Excel en español (con BOM, ";" y CRLF). */
export function sheetToCsv(sheet: Sheet): string {
  const rows = [
    sheet.columns.map((c) => protectFormula(c.header)),
    ...sheet.rows.map((row) => sheet.columns.map((column, i) => formatCsvCell(row.cells[i] ?? null, column.type))),
  ];
  return toCsv(rows, { delimiter: ";", bom: true, eol: "\r\n" });
}

// ---------------------------------------------------------------------------
// XLSX (SpreadsheetML mínimo: un libro, hojas con textos en línea y un estilo por tipo)
// ---------------------------------------------------------------------------

const EXCEL_EPOCH: CivilDate = "1899-12-30";

/** Caracteres que XML 1.0 no admite (controles salvo tabulador y saltos) fuera, y escapado de los especiales. */
function xmlText(value: string): string {
  let out = "";
  for (const char of value) {
    const code = char.codePointAt(0)!;
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) continue;
    if (code === 0xfffe || code === 0xffff) continue;
    out += char === "&" ? "&amp;" : char === "<" ? "&lt;" : char === ">" ? "&gt;" : char === '"' ? "&quot;" : char;
  }
  return out;
}

function columnName(index: number): string {
  let name = "";
  let n = index + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

// Estilos (índice en cellXfs): 0 normal, 1 negrita, 2 importe, 3 fecha, 4 porcentaje, 5 importe en negrita, 6 entero.
const STYLE = { text: 0, bold: 1, money: 2, date: 3, percent: 4, boldMoney: 5, integer: 6, boldPercent: 7 } as const;

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="3"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy"/><numFmt numFmtId="166" formatCode="0.00"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="8">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function inlineString(ref: string, value: string, style: number): string {
  const text = xmlText(value);
  const space = /^\s|\s$|\n/.test(text) ? ' xml:space="preserve"' : "";
  return `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ""}><is><t${space}>${text}</t></is></c>`;
}

function cellXml(ref: string, cell: SheetCell, type: ColumnType, bold: boolean): string {
  if (cell === null || cell === "") return "";
  if (typeof cell === "string" && type !== "date") return inlineString(ref, cell, bold ? STYLE.bold : STYLE.text);
  switch (type) {
    case "money":
      return `<c r="${ref}" s="${bold ? STYLE.boldMoney : STYLE.money}"><v>${centsToDecimal(Number(cell))}</v></c>`;
    case "percent":
      return `<c r="${ref}" s="${bold ? STYLE.boldPercent : STYLE.percent}"><v>${centsToDecimal(Number(cell))}</v></c>`;
    case "integer":
      return `<c r="${ref}" s="${STYLE.integer}"><v>${Math.trunc(Number(cell))}</v></c>`;
    case "date": {
      if (typeof cell === "string" && /^\d{4}-\d{2}-\d{2}$/.test(cell)) {
        return `<c r="${ref}" s="${STYLE.date}"><v>${daysBetween(EXCEL_EPOCH, cell)}</v></c>`;
      }
      return inlineString(ref, String(cell), bold ? STYLE.bold : STYLE.text);
    }
    case "text":
      return inlineString(ref, String(cell), bold ? STYLE.bold : STYLE.text);
  }
}

function worksheetXml(sheet: Sheet): string {
  const width = sheet.columns.length;
  const lastRow = sheet.rows.length + 1;
  const header = sheet.columns.map((c, i) => inlineString(`${columnName(i)}1`, c.header, STYLE.bold)).join("");
  const body = sheet.rows
    .map((row, r) => {
      const rowNumber = r + 2;
      const cells = sheet.columns.map((column, i) => cellXml(`${columnName(i)}${rowNumber}`, row.cells[i] ?? null, column.type, row.bold === true)).join("");
      return `<row r="${rowNumber}">${cells}</row>`;
    })
    .join("");
  const cols = sheet.columns
    .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width ?? Math.max(10, Math.min(40, c.header.length + 2))}" customWidth="1"/>`)
    .join("");
  const range = width > 0 ? `A1:${columnName(width - 1)}${lastRow}` : "A1";
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<dimension ref="${range}"/>` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    (cols ? `<cols>${cols}</cols>` : "") +
    `<sheetData><row r="1">${header}</row>${body}</sheetData>` +
    (width > 0 && sheet.rows.length > 0 ? `<autoFilter ref="${range}"/>` : "") +
    `</worksheet>`
  );
}

/** Nombre de hoja válido para Excel: sin []:*?/\ y como mucho 31 caracteres, sin repetir. */
function sheetNames(sheets: readonly Sheet[]): string[] {
  const used = new Set<string>();
  return sheets.map((s, i) => {
    let name = s.name.replace(/[[\]:*?/\\]/g, " ").trim().slice(0, 31) || `Hoja ${i + 1}`;
    let n = 2;
    while (used.has(name.toLowerCase())) name = `${name.slice(0, 28)} ${n++}`;
    used.add(name.toLowerCase());
    return name;
  });
}

/** Libro XLSX con una hoja por tabla. */
export function sheetsToXlsx(sheets: readonly Sheet[], opts: ZipOptions = {}): Uint8Array {
  const names = sheetNames(sheets);
  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    sheets
      .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
      .join("") +
    `</Types>`;
  const rootRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`;
  const workbook =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<bookViews><workbookView/></bookViews>` +
    `<sheets>${names.map((name, i) => `<sheet name="${xmlText(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>` +
    `</workbook>`;
  const workbookRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    sheets
      .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
      .join("") +
    `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `</Relationships>`;

  return createZip(
    [
      { name: "[Content_Types].xml", data: encodeUtf8(contentTypes) },
      { name: "_rels/.rels", data: encodeUtf8(rootRels) },
      { name: "xl/workbook.xml", data: encodeUtf8(workbook) },
      { name: "xl/_rels/workbook.xml.rels", data: encodeUtf8(workbookRels) },
      { name: "xl/styles.xml", data: encodeUtf8(STYLES_XML) },
      ...sheets.map((sheet, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: encodeUtf8(worksheetXml(sheet)) })),
    ],
    opts,
  );
}
