// Texto de los ficheros que se importan (ARCHITECTURE.md §13, hito 1.5).
//
// Excel en español guarda los CSV en Windows-1252 ("CSV (delimitado por comas)") o en UTF-8 con
// BOM ("CSV UTF-8"), y el "Texto Unicode" en UTF-16 con BOM. Aquí se decodifica sin depender de
// TextDecoder (que no está en todos los entornos a los que puede ir el dominio): primero la BOM,
// después UTF-8 estricto y, si los bytes no son UTF-8 válido, Windows-1252.

export type TextEncodingName = "utf-8" | "utf-16le" | "utf-16be" | "windows-1252";

export type DecodedText = {
  text: string;
  encoding: TextEncodingName;
  /** El fichero empezaba con una marca de orden de bytes (BOM). */
  bom: boolean;
};

// Windows-1252 difiere de Latin-1 solo en 0x80-0x9F. Los cinco huecos sin carácter se leen como
// el control C1 del mismo valor, igual que hace el estándar WHATWG.
const CP1252_HIGH: readonly number[] = [
  0x20ac, 0x0081, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x008d,
  0x017d, 0x008f, 0x0090, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a,
  0x0153, 0x009d, 0x017e, 0x0178,
];

const CHUNK = 8192;

/** Code points a texto, por trozos (String.fromCodePoint con millones de argumentos desborda la pila). */
function fromCodePoints(points: number[]): string {
  let out = "";
  for (let i = 0; i < points.length; i += CHUNK) out += String.fromCodePoint(...points.slice(i, i + CHUNK));
  return out;
}

/**
 * UTF-8 estricto: rechaza secuencias truncadas, formas no mínimas (overlong), sustitutos (U+D800 a
 * U+DFFF) y valores por encima de U+10FFFF. Devuelve null si los bytes no son UTF-8 válido.
 */
export function decodeUtf8Strict(bytes: Uint8Array, start = 0): string | null {
  const points: number[] = [];
  let i = start;
  while (i < bytes.length) {
    const b0 = bytes[i]!;
    if (b0 < 0x80) {
      points.push(b0);
      i += 1;
      continue;
    }
    let needed: number;
    let point: number;
    let min: number;
    if (b0 >= 0xc2 && b0 <= 0xdf) {
      needed = 1;
      point = b0 & 0x1f;
      min = 0x80;
    } else if (b0 >= 0xe0 && b0 <= 0xef) {
      needed = 2;
      point = b0 & 0x0f;
      min = 0x800;
    } else if (b0 >= 0xf0 && b0 <= 0xf4) {
      needed = 3;
      point = b0 & 0x07;
      min = 0x10000;
    } else {
      return null;
    }
    for (let k = 1; k <= needed; k++) {
      const b = bytes[i + k];
      if (b === undefined || (b & 0xc0) !== 0x80) return null;
      point = (point << 6) | (b & 0x3f);
    }
    if (point < min || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) return null;
    points.push(point);
    i += needed + 1;
  }
  return fromCodePoints(points);
}

/** Windows-1252 (siempre decodifica: cada byte es un carácter). */
export function decodeWindows1252(bytes: Uint8Array, start = 0): string {
  const points: number[] = new Array(Math.max(0, bytes.length - start));
  for (let i = start; i < bytes.length; i++) {
    const b = bytes[i]!;
    points[i - start] = b >= 0x80 && b <= 0x9f ? CP1252_HIGH[b - 0x80]! : b;
  }
  return fromCodePoints(points);
}

function decodeUtf16(bytes: Uint8Array, start: number, littleEndian: boolean): string {
  const units: number[] = [];
  for (let i = start; i + 1 < bytes.length; i += 2) {
    units.push(littleEndian ? bytes[i]! | (bytes[i + 1]! << 8) : (bytes[i]! << 8) | bytes[i + 1]!);
  }
  let out = "";
  for (let i = 0; i < units.length; i += CHUNK) out += String.fromCharCode(...units.slice(i, i + CHUNK));
  return out;
}

/** Decodifica los bytes de un fichero de texto con la regla de arriba. */
export function decodeText(bytes: Uint8Array): DecodedText {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: decodeUtf8Strict(bytes, 3) ?? decodeWindows1252(bytes, 3), encoding: "utf-8", bom: true };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: decodeUtf16(bytes, 2, true), encoding: "utf-16le", bom: true };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: decodeUtf16(bytes, 2, false), encoding: "utf-16be", bom: true };
  }
  const utf8 = decodeUtf8Strict(bytes);
  if (utf8 !== null) return { text: utf8, encoding: "utf-8", bom: false };
  return { text: decodeWindows1252(bytes), encoding: "windows-1252", bom: false };
}

/** Texto a UTF-8 (para escribir CSV y XML). */
export function encodeUtf8(text: string): Uint8Array {
  const out: number[] = [];
  for (const char of text) {
    let point = char.codePointAt(0)!;
    // Un sustituto suelto no se puede codificar: se escribe U+FFFD.
    if (point >= 0xd800 && point <= 0xdfff) point = 0xfffd;
    if (point < 0x80) out.push(point);
    else if (point < 0x800) out.push(0xc0 | (point >> 6), 0x80 | (point & 0x3f));
    else if (point < 0x10000) out.push(0xe0 | (point >> 12), 0x80 | ((point >> 6) & 0x3f), 0x80 | (point & 0x3f));
    else
      out.push(
        0xf0 | (point >> 18),
        0x80 | ((point >> 12) & 0x3f),
        0x80 | ((point >> 6) & 0x3f),
        0x80 | (point & 0x3f),
      );
  }
  return Uint8Array.from(out);
}

/**
 * Clave de comparación: minúsculas, sin acentos, "%" como "pct" y "€" como "eur", y cualquier otro
 * signo como espacio. "Nº Factura" → "n factura", "% IVA" → "pct iva", "Razón social" → "razon social".
 */
export function normalizeKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/%/g, " pct ")
    .replace(/€/g, " eur ")
    .replace(/[ºª°]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Espacios normalizados (incluidos los no separables que pone Excel) y recortados; null si queda vacío. */
export function cleanText(value: string | null | undefined, max = 500): string | null {
  if (value === null || value === undefined) return null;
  const cleaned = value.replace(/[   \t]/g, " ").replace(/\s+/g, " ").trim();
  if (cleaned === "") return null;
  return cleaned.length > max ? cleaned.slice(0, max).trimEnd() : cleaned;
}
