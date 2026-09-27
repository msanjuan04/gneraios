// Leer el número de una factura histórica con el formato de su serie (el inverso de
// formatInvoiceNumber): de "2025-0042" con `{yyyy}-{n:4}` salen el año 2025 y la secuencia 42.
// Con la secuencia, el contador de la serie continúa después del último importado (§7.4).

import { formatInvoiceNumber } from "../invoicing/number-format";

export type ParsedInvoiceNumber = {
  sequence: number;
  /** Año del número (el del contador si la serie se reinicia cada año). */
  year: number;
};

const TOKEN = /\{yyyy\}|\{yy\}|\{n(?::([1-9]))?\}/g;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Secuencia y año de `number` según `format`, o null si no lo sigue exactamente: el número tiene
 * que volver a salir igual al formatearlo (mismo relleno de ceros), para que el contador y los
 * números nuevos sean coherentes. Si el formato no lleva año, se usa `fallbackYear` (el de la
 * fecha de la factura); con `{yy}`, el siglo es el 2000.
 */
export function parseInvoiceNumber(format: string, number: string, fallbackYear: number): ParsedInvoiceNumber | null {
  const text = number.trim();
  if (text === "") return null;
  let pattern = "^";
  let last = 0;
  const groups: ("yyyy" | "yy" | "n")[] = [];
  for (const match of format.matchAll(TOKEN)) {
    pattern += escapeRegExp(format.slice(last, match.index));
    if (match[0] === "{yyyy}") {
      pattern += "(\\d{4})";
      groups.push("yyyy");
    } else if (match[0] === "{yy}") {
      pattern += "(\\d{2})";
      groups.push("yy");
    } else {
      const width = match[1] ? Number(match[1]) : 1;
      pattern += `(\\d{${width},})`;
      groups.push("n");
    }
    last = match.index + match[0].length;
  }
  pattern += `${escapeRegExp(format.slice(last))}$`;
  if (!groups.includes("n")) return null;

  const found = new RegExp(pattern).exec(text);
  if (!found) return null;
  let sequence: number | null = null;
  let year: number | null = null;
  for (let i = 0; i < groups.length; i++) {
    const value = found[i + 1]!;
    const kind = groups[i]!;
    if (kind === "n") {
      const n = Number(value);
      if (sequence !== null && sequence !== n) return null;
      sequence = n;
    } else {
      const y = kind === "yyyy" ? Number(value) : 2000 + Number(value);
      if (year !== null && year !== y) return null;
      year = y;
    }
  }
  if (sequence === null || !Number.isSafeInteger(sequence) || sequence < 1 || sequence > 99_999_999) return null;
  const resolvedYear = year ?? fallbackYear;
  if (!Number.isInteger(resolvedYear) || resolvedYear < 2000 || resolvedYear > 2999) return null;
  if (formatInvoiceNumber(format, resolvedYear, sequence) !== text) return null;
  return { sequence, year: resolvedYear };
}

/** El formato lleva el año dentro del número. */
export function formatHasYear(format: string): boolean {
  return /\{yy(?:yy)?\}/.test(format);
}
