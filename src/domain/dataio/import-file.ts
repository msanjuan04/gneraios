// Leer el fichero que se sube a una importación: CSV (Excel, Holded, gnerai-finance…) o el JSON
// del histórico de la app `facturas` (su localStorage), que se aplana a una fila por línea.

import { parseCsv, type CsvDelimiter } from "./csv";
import type { ImportTable } from "./table";
import { decodeText, type TextEncodingName } from "./text";

export type ImportFileMeta = {
  format: "csv" | "json";
  encoding: TextEncodingName;
  delimiter: CsvDelimiter | null;
  size: number;
  rows: number;
  /** Separador decimal más probable para el fichero (el JSON siempre usa punto). */
  decimalHint: "," | ".";
  /** Contadores de la app `facturas` (año → último número), si venían en el fichero. */
  legacyCounters?: { year: number; lastNumber: number }[];
};

export type ReadImportFile =
  | { ok: true; table: ImportTable; meta: ImportFileMeta }
  | { ok: false; reason: "empty" | "xlsx" | "json_unsupported" | "no_rows" | "too_many_rows" | "too_many_columns" };

export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_COLUMNS = 120;

// ---------------------------------------------------------------------------
// JSON de la app `facturas` (FacturaEmitida[] en localStorage["facturas:emitidas"])
// ---------------------------------------------------------------------------

type LegacyLine = { descripcion?: unknown; cantidad?: unknown; precio?: unknown };
type LegacyInvoice = {
  numero?: unknown;
  fechaEmision?: unknown;
  fechaVencimiento?: unknown;
  formaPago?: unknown;
  cliente?: Record<string, unknown>;
  lineas?: LegacyLine[];
  notas?: unknown;
  aplicaIRPF?: unknown;
  totales?: Record<string, unknown>;
};

const LEGACY_HEADERS = [
  "Número",
  "Fecha",
  "Vencimiento",
  "Forma de pago",
  "Cliente",
  "NIF",
  "Dirección",
  "Código postal",
  "Ciudad",
  "Provincia",
  "País",
  "Email",
  "Concepto",
  "Cantidad",
  "Precio",
  "% IVA",
  "% IRPF",
  "Base imponible",
  "Cuota IVA",
  "Retención IRPF",
  "Total",
  "Notas",
];

function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  return String(value).trim();
}

function isLegacyInvoice(value: unknown): value is LegacyInvoice {
  return typeof value === "object" && value !== null && "numero" in value && "lineas" in value;
}

/**
 * El histórico de la app `facturas`: una lista de facturas, o un volcado de su localStorage (un
 * objeto con "facturas:emitidas" como texto JSON y los contadores "factura:contador:<año>").
 */
export function flattenLegacyFacturas(json: unknown): { table: ImportTable; counters: { year: number; lastNumber: number }[] } | null {
  let list: unknown = json;
  const counters: { year: number; lastNumber: number }[] = [];
  if (!Array.isArray(json) && typeof json === "object" && json !== null) {
    const record = json as Record<string, unknown>;
    let emitted = record["facturas:emitidas"];
    if (typeof emitted === "string") {
      try {
        emitted = JSON.parse(emitted);
      } catch {
        emitted = null;
      }
    }
    list = emitted;
    for (const [key, value] of Object.entries(record)) {
      const m = /^factura:contador:(\d{4})$/.exec(key);
      if (m && /^\d+$/.test(text(value))) counters.push({ year: Number(m[1]), lastNumber: Number(text(value)) });
    }
  }
  if (!Array.isArray(list) || !list.every(isLegacyInvoice)) return null;

  const rows: string[][] = [];
  for (const inv of list) {
    const client = inv.cliente ?? {};
    const totals = inv.totales ?? {};
    const lines = Array.isArray(inv.lineas) && inv.lineas.length > 0 ? inv.lineas : [{}];
    // Sin IRPF, la app guardaba igualmente su porcentaje (15) en los totales: aquí va a 0.
    const irpfApplies = inv.aplicaIRPF === true || (inv.aplicaIRPF === undefined && Number(text(totals.irpf) || 0) > 0);
    for (const line of lines) {
      rows.push([
        text(inv.numero),
        text(inv.fechaEmision),
        text(inv.fechaVencimiento),
        text(inv.formaPago),
        text(client.nombre),
        text(client.nif),
        text(client.direccion),
        text(client.cp),
        text(client.ciudad),
        text(client.provincia),
        text(client.pais),
        text(client.email),
        text(line.descripcion),
        text(line.cantidad),
        text(line.precio),
        text(totals.porcentajeIVA),
        irpfApplies ? text(totals.porcentajeIRPF) : "0",
        text(totals.base),
        text(totals.iva),
        text(totals.irpf),
        text(totals.total),
        text(inv.notas),
      ]);
    }
  }
  return {
    table: { headers: [...LEGACY_HEADERS], rows, rowNumbers: rows.map((_, i) => i + 2) },
    counters: counters.sort((a, b) => a.year - b.year),
  };
}

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

/** Lee el fichero subido. El XLSX no se lee (hay que guardarlo como CSV UTF-8 desde Excel). */
export function readImportFile(bytes: Uint8Array): ReadImportFile {
  if (bytes.length === 0) return { ok: false, reason: "empty" };
  // "PK\x03\x04": un ZIP, es decir, un .xlsx.
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return { ok: false, reason: "xlsx" };

  const decoded = decodeText(bytes);
  const trimmed = decoded.text.replace(/^﻿/, "").trim();
  if (trimmed === "") return { ok: false, reason: "empty" };

  let table: ImportTable;
  let meta: Omit<ImportFileMeta, "rows">;
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    let json: unknown;
    try {
      json = JSON.parse(trimmed);
    } catch {
      return { ok: false, reason: "json_unsupported" };
    }
    const flat = flattenLegacyFacturas(json);
    if (!flat) return { ok: false, reason: "json_unsupported" };
    table = flat.table;
    meta = {
      format: "json",
      encoding: decoded.encoding,
      delimiter: null,
      size: bytes.length,
      decimalHint: ".",
      ...(flat.counters.length > 0 ? { legacyCounters: flat.counters } : {}),
    };
  } else {
    const parsed = parseCsv(decoded.text);
    table = { headers: parsed.headers, rows: parsed.rows, rowNumbers: parsed.rowNumbers };
    meta = {
      format: "csv",
      encoding: decoded.encoding,
      delimiter: parsed.delimiter,
      size: bytes.length,
      // Con ";" o tabulador, lo normal es la coma decimal (Excel en español); con ",", el punto.
      decimalHint: parsed.delimiter === "," ? "." : ",",
    };
  }
  if (table.rows.length === 0) return { ok: false, reason: "no_rows" };
  if (table.rows.length > MAX_IMPORT_ROWS) return { ok: false, reason: "too_many_rows" };
  if (table.headers.length > MAX_IMPORT_COLUMNS) return { ok: false, reason: "too_many_columns" };
  return { ok: true, table, meta: { ...meta, rows: table.rows.length } };
}
