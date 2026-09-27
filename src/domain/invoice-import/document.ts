// El texto de la factura como líneas con sus celdas y sus valores reconocidos, y las dos maneras de
// encontrar la etiqueta de un valor: a su izquierda en la misma línea («Base imponible 900,00 €») o
// en la misma columna de la línea de encima (una cabecera «FECHA» con «15/03/2025» debajo).

import { labelAt, labelBefore, type LabelKind, type LabelMatch, wholeLabel } from "./labels";
import { type Cell, collapseLetterSpacing, normalizeText, overlaps, splitCells } from "./text";
import {
  type DateToken,
  findDates,
  findIbans,
  findMoney,
  findPercents,
  findTaxIds,
  type MoneyToken,
  type PercentToken,
  type Span,
  type TaxIdToken,
} from "./tokens";

export type DocLine = {
  index: number;
  text: string;
  cells: Cell[];
  dates: DateToken[];
  percents: PercentToken[];
  taxIds: TaxIdToken[];
  ibans: Span[];
  money: MoneyToken[];
};

export type FoundLabel = LabelMatch & { line: number; source: "left" | "above" };

export function readDocument(raw: string): DocLine[] {
  return normalizeText(raw)
    .split("\n")
    .map((original, index) => {
      const text = collapseLetterSpacing(original);
      const dates = findDates(text);
      const percents = findPercents(text);
      const taxIds = findTaxIds(text);
      const ibans = findIbans(text);
      const money = findMoney(text, [...dates, ...percents, ...taxIds, ...ibans]);
      // Las celdas ocupan lo que ocupaban antes de juntar las letras («C A N T I D A D» llega
      // hasta donde acaba), así un valor alineado a la derecha sigue debajo de su cabecera.
      const cells = splitCells(original).map((c) => ({ ...c, text: text.slice(c.start, c.end).trim() }));
      return { index, text, cells, dates, percents, taxIds, ibans, money };
    });
}

export function cellAt(line: DocLine, position: number): Cell | null {
  return line.cells.find((c) => c.start <= position && position < c.end) ?? null;
}

/** La celda siguiente a la derecha de la que contiene `position`. */
export function cellAfter(line: DocLine, position: number): Cell | null {
  return line.cells.find((c) => c.start > position) ?? null;
}

/** Las líneas con algo, hacia arriba desde `index` (sin incluirla). */
export function linesAbove(lines: readonly DocLine[], index: number, max: number): DocLine[] {
  const out: DocLine[] = [];
  for (let i = index - 1; i >= 0 && out.length < max; i -= 1) if (lines[i]!.cells.length > 0) out.push(lines[i]!);
  return out;
}

export function linesBelow(lines: readonly DocLine[], index: number, max: number): DocLine[] {
  const out: DocLine[] = [];
  for (let i = index + 1; i < lines.length && out.length < max; i += 1) if (lines[i]!.cells.length > 0) out.push(lines[i]!);
  return out;
}

/** La celda de `line` que cae en la columna de `span`. */
export function cellInColumn(line: DocLine, span: Span): Cell | null {
  return line.cells.find((c) => overlaps(c, span)) ?? null;
}

/**
 * La etiqueta de un valor de la línea: a su izquierda (sin pasar de `regionStart`, el valor anterior
 * del mismo tipo) o, si no hay, en la celda de encima (una o dos líneas más arriba), que tiene que
 * ser solo la etiqueta.
 */
export function labelFor(
  lines: readonly DocLine[],
  line: DocLine,
  token: Span,
  kinds: readonly LabelKind[],
  regionStart = 0,
): FoundLabel | null {
  const region = line.text.slice(regionStart, token.start);
  const left = labelBefore(region, region.length, kinds);
  if (left) return { ...left, start: left.start + regionStart, end: left.end + regionStart, line: line.index, source: "left" };
  const own = cellAt(line, token.start);
  // Un valor que no empieza su celda tiene la etiqueta dentro de ella (y no la tiene).
  if (own && own.text.slice(0, token.start - own.start).trim() !== "") return null;
  const column = own ?? token;
  for (const above of linesAbove(lines, line.index, 2)) {
    const cell = cellInColumn(above, column);
    if (!cell) continue;
    const label = wholeLabel(cell.text, kinds);
    if (label) return { ...label, start: label.start + cell.start, end: label.end + cell.start, line: above.index, source: "above" };
    // Otra cosa encima (un valor, un texto): la columna no tiene cabecera.
    return null;
  }
  return null;
}

/** El texto que sigue a una etiqueta: el resto de su celda, la celda de su derecha o la de debajo. */
export function valuesAfterLabel(lines: readonly DocLine[], line: DocLine, cell: Cell, labelEnd: number): string[] {
  const out: string[] = [];
  const rest = cell.text.slice(labelEnd).replace(/^[\s:.#º°=-]+/, "");
  if (rest.trim() !== "") out.push(rest);
  const right = cellAfter(line, cell.end - 1);
  if (right) out.push(right.text);
  const below = linesBelow(lines, line.index, 1)[0];
  const under = below ? cellInColumn(below, cell) : null;
  if (under) out.push(under.text);
  return out;
}

/** ¿La celda empieza por una etiqueta de estos tipos? */
export function labelAtCell(cell: Cell, kinds: readonly LabelKind[]): LabelMatch | null {
  return labelAt(cell.text, 0, kinds);
}
