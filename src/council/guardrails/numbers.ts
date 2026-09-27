// Guardarraíl de números (CONSEJO.md §1): cada cifra que escribe un agente tiene que salir de su
// evidencia, que a su vez sale de las tools. Se permite redondear para leer mejor ("1.235 €" o
// "unos 1.230 €" por 1.234,56 €), nunca calcular ni aproximar a ojo: una suma, una resta o un
// porcentaje que no esté en la evidencia se rechaza y el agente tiene que pedírselo a una tool.
//
// No cuentan como cifras: fechas (2026-09-26, 26/09/2026, "5 de octubre"), años sueltos, periodos
// (2026-08, T3), modelos fiscales ("modelo 303"), ids (m12, t3, uuids) y los textos que las tools
// devuelven tal cual (etiquetas, nombres, números de factura), que se pueden copiar.

import type { EvidenceItem } from "../types";

const MONTHS = "enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|ene|feb|mar|abr|may|jun|jul|ago|sep|sept|oct|nov|dic";

const IGNORED: RegExp[] = [
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
  /\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?\b/g,
  /\b\d{4}-[TQ][1-4]\b/g,
  /\b\d{4}-\d{2}\b/g,
  /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g,
  new RegExp(`\\b\\d{1,2}\\s+(?:de\\s+)?(?:${MONTHS})\\b\\.?(?:\\s+(?:de\\s+)?\\d{4})?`, "gi"),
  new RegExp(`\\b(?:${MONTHS})\\.?\\s+(?:de\\s+)?\\d{4}\\b`, "gi"),
  /\b[TQ][1-4]\b/g,
  /\b[1-4][TQ]\b/g,
  /\bmodelos?\s+\d{3}(?:\s*(?:,|y|e|o|\/)\s*\d{3})*/gi,
  /\b[mt]\d+\b/g,
  /^\s*\d+[.)]\s/gm,
];

/** Número suelto (con miles con punto y decimales con coma, a la española) y un sufijo opcional. */
const NUMBER = /(?<![\w.,])[-−+]?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:[.,]\d+)?(?:\s?(?:mil|k)\b)?/gi;

export type FoundNumber = { raw: string; value: number; decimals: number };

function parseSpanish(raw: string): FoundNumber | null {
  let text = raw.replace(/[−+]/g, "").replace(/^-/, "").trim();
  let multiplier = 1;
  const suffix = /\s?(mil|k)$/i.exec(text);
  if (suffix) {
    multiplier = 1000;
    text = text.slice(0, suffix.index).trim();
  }
  let decimals = 0;
  let normalized: string;
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(text)) {
    const [int, frac = ""] = text.split(",");
    decimals = frac.length;
    normalized = `${int!.replace(/\./g, "")}${frac ? `.${frac}` : ""}`;
  } else if (/^\d+,\d+$/.test(text)) {
    decimals = text.split(",")[1]!.length;
    normalized = text.replace(",", ".");
  } else if (/^\d+\.\d{1,2}$/.test(text)) {
    decimals = text.split(".")[1]!.length;
    normalized = text;
  } else if (/^\d+$/.test(text)) {
    normalized = text;
  } else {
    return null;
  }
  const value = Number(normalized) * multiplier;
  if (!Number.isFinite(value)) return null;
  return { raw, value, decimals: multiplier === 1 ? decimals : 0 };
}

/** Quita del texto lo que no son cifras de negocio (fechas, periodos, ids, textos de las tools). */
export function stripNonFigures(text: string, literals: readonly string[] = []): string {
  let out = text;
  for (const literal of literals) if (literal.length >= 2) out = out.split(literal).join(" ");
  for (const pattern of IGNORED) out = out.replace(pattern, " ");
  return out;
}

/** Las cifras de un texto (sin fechas ni años sueltos). */
export function extractFigures(text: string, literals: readonly string[] = []): FoundNumber[] {
  const cleaned = stripNonFigures(text, literals);
  const found: FoundNumber[] = [];
  for (const match of cleaned.matchAll(NUMBER)) {
    const parsed = parseSpanish(match[0]);
    if (!parsed) continue;
    const after = cleaned.slice((match.index ?? 0) + match[0].length).trimStart();
    // Un año suelto (1990-2100) sin unidad detrás es una fecha, no una cifra.
    if (parsed.decimals === 0 && Number.isInteger(parsed.value) && parsed.value >= 1990 && parsed.value <= 2100 && /^\d{4}$/.test(match[0].trim()) && !/^(%|€|eur|meses|días|dias|clientes|facturas)/i.test(after)) {
      continue;
    }
    found.push(parsed);
  }
  return found;
}

/** Los valores "naturales" de una métrica: euros para céntimos, porcentaje para puntos básicos, horas para minutos. */
export function naturalValues(item: Pick<EvidenceItem, "value" | "unit">): number[] {
  if (item.value === null) return [];
  const v = Math.abs(item.value);
  switch (item.unit) {
    case "eur_cents":
      return [v / 100];
    case "bps":
      return [v / 100];
    case "minutes":
      return [v / 60];
    case "flag":
    case "missing":
      return [];
    default:
      return [v];
  }
}

function significantDigits(value: number): number {
  const digits = String(Math.round(Math.abs(value))).replace(/0+$/, "");
  return Math.max(1, digits.length);
}

function roundTo(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

function roundSignificant(value: number, digits: number): number {
  if (value === 0) return 0;
  const magnitude = Math.floor(Math.log10(Math.abs(value)));
  const f = 10 ** (magnitude - digits + 1);
  return Math.round(value / f) * f;
}

const close = (a: number, b: number) => Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));

/** Cuánto se puede alejar un redondeo con ceros al final de la cifra de verdad (1,5 %). */
const ROUNDING_BAND = 0.015;

/**
 * ¿La cifra del texto es la de la evidencia, escrita igual o redondeada para leer mejor? Vale el
 * redondeo a los decimales que se escriben (12,53 → 12,5; 1.234,56 → 1.235) y, para cantidades de
 * 10 o más escritas con ceros al final, a dos o más cifras significativas si no se aleja más de un
 * 1,5 % (1.234,56 → 1.230, pero no 1.200 ni 1.000).
 */
export function figureMatches(found: FoundNumber, candidate: number): boolean {
  const t = Math.abs(found.value);
  const e = Math.abs(candidate);
  if (close(t, e)) return true;
  if (close(roundTo(e, found.decimals), t)) return true;
  if (found.decimals === 0 && Number.isInteger(t) && t >= 10) {
    const sig = significantDigits(t);
    if (sig >= 2 && close(roundSignificant(e, sig), t) && Math.abs(t - e) <= ROUNDING_BAND * e) return true;
  }
  return false;
}

/** Las cifras del texto que no salen de la evidencia (vacío = todo en orden). */
export function ungroundedFigures(text: string, evidence: readonly Pick<EvidenceItem, "value" | "unit" | "label" | "period">[], literals: readonly string[] = []): string[] {
  const candidates = evidence.flatMap(naturalValues);
  // Las cifras que forman parte de la definición de una métrica citada ("Gasto medio (3 meses)").
  const labelFigures = evidence.flatMap((item) => extractFigures(`${item.label}`).map((f) => f.value));
  const all = [...candidates, ...labelFigures];
  const bad: string[] = [];
  for (const found of extractFigures(text, literals)) {
    if (!all.some((c) => figureMatches(found, c))) bad.push(found.raw.trim());
  }
  return [...new Set(bad)];
}
