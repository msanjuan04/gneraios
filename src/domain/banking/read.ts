// Leer el fichero que se sube: un Norma 43 (lo reconoce solo) o un CSV de movimientos (con el mapeo
// propuesto o el que haya corregido el socio). La decodificación (UTF-8, Windows-1252, UTF-16) es la
// de las importaciones de datos.

import { MAX_IMPORT_ROWS } from "../dataio/import-file";
import { decodeText, type TextEncodingName } from "../dataio/text";
import { type BankCsvMapping, parseBankCsv, proposeBankCsvMapping, readBankCsvTable } from "./csv";
import { looksLikeNorma43, parseNorma43 } from "./norma43";
import type { ParsedStatement, StatementIssue } from "./statement";

export type CsvPreview = {
  /** Las primeras filas del fichero tal cual, para elegir la cabecera y las columnas. */
  records: string[][];
  mapping: BankCsvMapping | null;
  headers: string[];
  skipped: number;
};

export type ReadStatementResult =
  | { ok: true; format: "n43"; encoding: TextEncodingName; statements: ParsedStatement[]; issues: StatementIssue[] }
  | { ok: true; format: "csv"; encoding: TextEncodingName; statements: [ParsedStatement]; issues: StatementIssue[]; csv: CsvPreview }
  | {
      ok: false;
      reason: "empty" | "xlsx" | "too_many_rows" | "n43_malformed" | "n43_currency" | "csv_no_header" | "csv_mapping" | "csv_no_rows";
      line?: number;
      /** En un CSV que no se entiende solo: sus primeras filas, para mapearlo a mano. */
      csv?: CsvPreview;
    };

const PREVIEW_RECORDS = 30;

export function readBankStatement(bytes: Uint8Array, opts: { mapping?: BankCsvMapping | null } = {}): ReadStatementResult {
  if (bytes.length === 0) return { ok: false, reason: "empty" };
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return { ok: false, reason: "xlsx" };
  const decoded = decodeText(bytes);
  const text = decoded.text.replace(/^﻿/, "");
  if (text.trim() === "") return { ok: false, reason: "empty" };

  if (looksLikeNorma43(text)) {
    const result = parseNorma43(text);
    if (!result.ok) {
      if (result.reason === "currency") return { ok: false, reason: "n43_currency", line: result.line };
      if (result.reason === "empty") return { ok: false, reason: "empty" };
      return { ok: false, reason: "n43_malformed", line: result.line };
    }
    const total = result.accounts.reduce((n, a) => n + a.movements.length, 0);
    if (total > MAX_IMPORT_ROWS) return { ok: false, reason: "too_many_rows" };
    return { ok: true, format: "n43", encoding: decoded.encoding, statements: result.accounts, issues: result.issues };
  }

  const table = readBankCsvTable(text);
  if (table.records.length === 0) return { ok: false, reason: "empty" };
  if (table.records.length > MAX_IMPORT_ROWS + 50) return { ok: false, reason: "too_many_rows" };
  const records = table.records.slice(0, PREVIEW_RECORDS);
  const mapping = opts.mapping ?? proposeBankCsvMapping(table);
  if (!mapping) return { ok: false, reason: "csv_no_header", csv: { records, mapping: null, headers: [], skipped: 0 } };
  const parsed = parseBankCsv(table, mapping);
  const headers = (table.records[mapping.headerRow] ?? []).map((h) => h.replace(/\s+/g, " ").trim());
  if (!parsed.ok) {
    const reason = parsed.reason === "no_rows" ? "csv_no_rows" : parsed.reason === "mapping" ? "csv_mapping" : "csv_no_header";
    return { ok: false, reason, csv: { records, mapping, headers, skipped: 0 } };
  }
  return {
    ok: true,
    format: "csv",
    encoding: decoded.encoding,
    statements: [parsed.statement],
    issues: [],
    csv: { records, mapping: parsed.mapping, headers: parsed.headers, skipped: parsed.skipped },
  };
}
