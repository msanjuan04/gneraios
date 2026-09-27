// CSV como lo exporta (y lo abre) Excel en español: separador ";" (o "," / tabulador), campos entre
// comillas con las comillas dobladas, saltos de línea dentro de un campo y filas rellenadas con
// separadores vacíos al final. El lector es tolerante; el escritor, estricto.

export type CsvDelimiter = ";" | "," | "\t" | "|";

export const CSV_DELIMITERS: readonly CsvDelimiter[] = [";", ",", "\t", "|"];

export type ParsedCsv = {
  delimiter: CsvDelimiter;
  /** Cabecera tal y como viene (con los espacios normalizados); una columna sin título queda como "". */
  headers: string[];
  /** Filas de datos con tantas celdas como columnas. */
  rows: string[][];
  /**
   * Número de fila de cada fila de datos tal y como la enseña Excel: un registro es una fila
   * (aunque tenga saltos de línea dentro de un campo) y las filas vacías también cuentan.
   */
  rowNumbers: number[];
};

/**
 * Lee todos los registros con un separador. Comillas: un campo que empieza por comillas termina en
 * las comillas de cierre ("" es una comilla literal); si tras el cierre vienen más caracteres, se
 * añaden al campo (tolerancia con ficheros mal escapados). Los saltos \r\n, \n y \r cierran el registro.
 */
function readRecords(text: string, delimiter: CsvDelimiter, limit = Number.POSITIVE_INFINITY): string[][] {
  const records: string[][] = [];
  let cells: string[] = [];
  let field = "";
  let quoted = false;
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  const endField = () => {
    cells.push(field);
    field = "";
    quoted = false;
  };
  const endRecord = () => {
    endField();
    records.push(cells);
    cells = [];
  };

  while (i < n && records.length < limit) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      if (ch === "\r") {
        // Dentro de un campo, \r\n y \r se guardan como \n.
        field += "\n";
        i += text[i + 1] === "\n" ? 2 : 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && field === "" && !quoted) {
      inQuotes = true;
      quoted = true;
      i += 1;
      continue;
    }
    if (ch === delimiter) {
      endField();
      i += 1;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      endRecord();
      i += ch === "\r" && text[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (records.length < limit && (field !== "" || quoted || cells.length > 0)) endRecord();
  return records;
}

function isBlank(cells: readonly string[]): boolean {
  return cells.every((cell) => cell.trim() === "");
}

/** Columnas sin contar las vacías del final (Excel rellena las filas con ";;;"). */
function trimmedWidth(cells: readonly string[]): number {
  let width = cells.length;
  while (width > 0 && cells[width - 1]!.trim() === "") width -= 1;
  return width;
}

const SEP_HINT = /^sep=(.)(\r\n|\n|\r|$)/i;

function isDelimiter(value: string | undefined): value is CsvDelimiter {
  return value !== undefined && (CSV_DELIMITERS as readonly string[]).includes(value);
}

/**
 * Separador más probable: con el que la cabecera tiene más de una columna y más filas de las
 * primeras tienen las mismas columnas que ella (Excel rellena todas las filas hasta el mismo
 * ancho). En un CSV con ";", la coma de los decimales no divide la cabecera. Una primera línea
 * "sep=;" (la que entiende Excel) manda.
 */
export function detectDelimiter(text: string): CsvDelimiter {
  const hint = SEP_HINT.exec(text);
  if (hint && isDelimiter(hint[1])) return hint[1];

  let best: { delimiter: CsvDelimiter; score: number; width: number } | null = null;
  for (const delimiter of CSV_DELIMITERS) {
    const records = readRecords(text, delimiter, 30).filter((r) => !isBlank(r));
    const width = records[0]?.length ?? 0;
    if (width < 2) continue;
    const score = records.filter((r) => r.length === width).length / records.length;
    if (!best || score > best.score || (score === best.score && width > best.width)) best = { delimiter, score, width };
  }
  return best?.delimiter ?? ";";
}

/**
 * Lee un CSV completo: detecta el separador (o usa el indicado), salta las filas vacías y una
 * primera línea "sep=;" de Excel, toma la primera fila con datos como cabecera y deja todas las
 * filas con el mismo número de columnas. Las columnas vacías del final se quitan.
 */
export function parseCsv(input: string, opts: { delimiter?: CsvDelimiter } = {}): ParsedCsv {
  let text = input.startsWith("﻿") ? input.slice(1) : input;
  const hint = SEP_HINT.exec(text);
  if (hint) text = text.slice(hint[0].length);
  const delimiter = opts.delimiter ?? (hint && isDelimiter(hint[1]) ? hint[1] : detectDelimiter(text));

  const records = readRecords(text, delimiter)
    .map((cells, index) => ({ cells, rowNumber: index + 1 }))
    .filter((r) => !isBlank(r.cells));
  if (records.length === 0) return { delimiter, headers: [], rows: [], rowNumbers: [] };

  const [head, ...body] = records;
  const width = Math.max(1, trimmedWidth(head!.cells), ...body.map((r) => trimmedWidth(r.cells)));
  const pad = (cells: readonly string[]) => {
    const out = cells.slice(0, width);
    while (out.length < width) out.push("");
    return out;
  };

  return {
    delimiter,
    headers: pad(head!.cells).map((h) => h.replace(/\s+/g, " ").trim()),
    rows: body.map((r) => pad(r.cells)),
    rowNumbers: body.map((r) => r.rowNumber),
  };
}

// ---------------------------------------------------------------------------
// Escritura
// ---------------------------------------------------------------------------

export type CsvWriteOptions = {
  delimiter?: CsvDelimiter;
  /** Excel en español necesita la BOM para leer UTF-8 (sin ella, lee Windows-1252). */
  bom?: boolean;
  eol?: "\r\n" | "\n";
};

/**
 * Una celda de texto que empieza por "=", "+", "-", "@" (o por un tabulador o un retorno) la
 * interpretaría Excel como fórmula: se le antepone un apóstrofo (recomendación de OWASP para la
 * inyección en CSV). Solo para textos: los importes negativos se escriben como números.
 */
export function protectFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function quoteCell(value: string, delimiter: CsvDelimiter): string {
  if (value === "") return "";
  const needsQuotes =
    value.includes(delimiter) ||
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r") ||
    /^\s|\s$/.test(value);
  return needsQuotes ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Filas ya formateadas a texto CSV (con la BOM al principio si se pide). */
export function toCsv(rows: readonly (readonly string[])[], opts: CsvWriteOptions = {}): string {
  const delimiter = opts.delimiter ?? ";";
  const eol = opts.eol ?? "\r\n";
  const body = rows.map((row) => row.map((cell) => quoteCell(cell, delimiter)).join(delimiter)).join(eol);
  return `${opts.bom ? "﻿" : ""}${body}${rows.length > 0 ? eol : ""}`;
}
