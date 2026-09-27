// Texto de un PDF de factura tal y como lo deja la extracción (o un fixture escrito a mano): se
// normaliza sin cambiar las posiciones de cada carácter dentro de su línea, porque las columnas
// (una etiqueta encima de su valor) se reconocen por esas posiciones.

const SPACES = /[   -   　]/g;
const INVISIBLE = /[​-‍⁠﻿­]/g;
const DASHES = /[‐-―−﹘﹣－]/g;
const QUOTES = /[‘’‚‛′´`]/g;
const LIGATURES: Readonly<Record<string, string>> = {
  "ﬀ": "ff",
  "ﬁ": "fi",
  "ﬂ": "fl",
  "ﬃ": "ffi",
  "ﬄ": "ffl",
  "ﬅ": "st",
  "ﬆ": "st",
};

/**
 * Espacios raros a espacio normal, guiones y comillas tipográficos a los ASCII, ligaduras
 * deshechas, tabuladores como separación de columna y sin espacios al final de cada línea.
 */
export function normalizeText(text: string): string {
  return text
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/\f/g, "\n")
    .replace(INVISIBLE, "")
    .replace(SPACES, " ")
    .replace(DASHES, "-")
    .replace(QUOTES, "'")
    .replace(/[ﬀ-ﬆ]/g, (c) => LIGATURES[c] ?? c)
    .replace(/\t/g, "    ")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n");
}

// Un carácter suelto: letra mayúscula, apóstrofo o punto (las etiquetas con espaciado de letras
// que pintan muchas plantillas: «F E C H A D ' E M I S S I Ó»).
const SPACED_RUN = /(?<![^\s])(?:[\p{Lu}'.] ){2,}[\p{Lu}'.](?![^\s])/gu;

/**
 * «F A C T U R A» → «FACTURA» (rachas de 3 o más caracteres sueltos). La línea no cambia de
 * longitud: los espacios quitados se ponen detrás de la palabra, así lo que viene después sigue en
 * su columna.
 */
export function collapseLetterSpacing(line: string): string {
  return line.replace(SPACED_RUN, (run) => {
    const joined = run.replace(/ /g, "");
    return joined + " ".repeat(run.length - joined.length);
  });
}

/**
 * Minúsculas y sin acentos, sin cambiar la longitud: cada carácter pasa a su letra base
 * («Á» → «a», «ç» → «c», «º» → «o», «ª» → «a»). Así una posición del texto plegado es la misma
 * posición en el original.
 */
export function foldSameLength(text: string): string {
  let out = "";
  for (const char of text) {
    if (char === "º" || char === "°") {
      out += "o";
      continue;
    }
    if (char === "ª") {
      out += "a";
      continue;
    }
    const base = char.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();
    // Un carácter que no cabe en uno (p. ej. «İ») se queda como estaba, en minúscula si se puede.
    out += base.length === char.length ? base : char.length === 1 ? (char.toLowerCase().length === 1 ? char.toLowerCase() : char) : char;
  }
  return out;
}

/**
 * Clave para comparar etiquetas: plegada, «%» como «pct» y «€» como «eur», y solo letras y
 * números. «Nº Factura:» → «nofactura», «% IVA» → «pctiva», «D'EMISSIÓ» → «demissio».
 */
export function squash(text: string): string {
  let out = "";
  for (const char of foldSameLength(text)) out += keyOf(char);
  return out;
}

/** Lo que aporta un carácter (ya plegado) a la clave de comparación. */
export function keyOf(char: string): string {
  if (char === "%") return "pct";
  if (char === "€") return "eur";
  return /[a-z0-9]/.test(char) ? char : /\p{L}|\p{N}/u.test(char) ? char : "";
}

export type Cell = {
  text: string;
  /** Posición (en caracteres) de su primer y último carácter + 1 dentro de la línea. */
  start: number;
  end: number;
};

/** Las celdas de una línea: trozos separados por dos o más espacios. */
export function splitCells(line: string): Cell[] {
  const cells: Cell[] = [];
  const pattern = /\S+(?: \S+)*/g;
  for (const match of line.matchAll(pattern)) {
    cells.push({ text: match[0], start: match.index, end: match.index + match[0].length });
  }
  return cells;
}

/** ¿Se solapan dos tramos de posiciones [start, end)? Con margen para columnas algo desalineadas. */
export function overlaps(a: { start: number; end: number }, b: { start: number; end: number }, slack = 1): boolean {
  return a.start < b.end + slack && b.start < a.end + slack;
}

/** Texto de una celda como nombre legible: espacios simples y sin puntuación suelta en los extremos. */
export function cleanValue(text: string, max = 200): string | null {
  const value = text
    .replace(/\s+/g, " ")
    .replace(/^[\s:;,.·|\-–]+|[\s:;,·|\-–]+$/g, "")
    .trim();
  if (value === "") return null;
  return value.length > max ? value.slice(0, max).trimEnd() : value;
}
