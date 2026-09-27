// Una tabla importada (cabecera + filas) y cómo se lee un campo mapeado de una fila.

import type { ColumnMapping, ImportField } from "./fields";

export type ImportTable = {
  headers: string[];
  rows: string[][];
  /** Número de fila de hoja de cálculo de cada fila (la cabecera es la 1). */
  rowNumbers: number[];
};

/** Celda de un campo en una fila, recortada; "" si el campo no está mapeado. */
export function cellOf(row: readonly string[], mapping: ColumnMapping, field: ImportField): string {
  const column = mapping[field];
  if (column === undefined) return "";
  return (row[column] ?? "").trim();
}

/** Todos los valores no vacíos de unos campos (para deducir el separador decimal o el orden de las fechas). */
export function fieldValues(table: ImportTable, mapping: ColumnMapping, fields: readonly ImportField[]): string[] {
  const out: string[] = [];
  for (const row of table.rows) {
    for (const field of fields) {
      const value = cellOf(row, mapping, field);
      if (value !== "") out.push(value);
    }
  }
  return out;
}

/** Hasta `count` valores de ejemplo de una columna, para enseñarlos al mapear. */
export function sampleValues(table: ImportTable, column: number, count = 3): string[] {
  const out: string[] = [];
  for (const row of table.rows) {
    const value = (row[column] ?? "").trim();
    if (value !== "" && !out.includes(value)) out.push(value);
    if (out.length >= count) break;
  }
  return out;
}
