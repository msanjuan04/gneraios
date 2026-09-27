// De los trozos de texto de una página de PDF (con su posición) a líneas de texto con las columnas
// alineadas, como `pdftotext -layout`: lo que está a la misma altura va en la misma línea y cada
// trozo se coloca en la columna que le corresponde por su x. Así una etiqueta y el valor que tiene
// debajo quedan en las mismas posiciones de carácter, y el lector de facturas los empareja.

export type PositionedText = {
  str: string;
  /** Esquina inferior izquierda, en puntos del PDF (el origen abajo a la izquierda). */
  x: number;
  y: number;
  width: number;
  height: number;
};

const FALLBACK_UNIT = 5;

/** Ancho medio de un carácter en la página: la mediana de ancho / longitud de los trozos. */
function charUnit(items: readonly PositionedText[]): number {
  const widths = items
    .filter((i) => i.str.trim().length >= 2 && i.width > 0)
    .map((i) => i.width / i.str.length)
    .sort((a, b) => a - b);
  if (widths.length === 0) return FALLBACK_UNIT;
  const median = widths[Math.floor(widths.length / 2)]!;
  // Un poco por debajo de la media: mejor columnas de más que dos trozos pegados.
  return Math.min(12, Math.max(1.5, median * 0.9));
}

/** Dos trozos van en la misma línea si su altura se solapa al menos la mitad del más bajo. */
function sameLine(a: PositionedText, b: PositionedText): boolean {
  const ha = Math.max(a.height, 1);
  const hb = Math.max(b.height, 1);
  const overlap = Math.min(a.y + ha, b.y + hb) - Math.max(a.y, b.y);
  return overlap >= 0.5 * Math.min(ha, hb);
}

function render(line: readonly PositionedText[], unit: number): string {
  let out = "";
  let lastEnd = 0;
  for (const item of line) {
    const text = item.str.replace(/[\r\n]+/g, " ");
    const column = Math.max(0, Math.round(item.x / unit));
    if (out === "") {
      out = " ".repeat(column) + text;
    } else {
      const gap = item.x - lastEnd;
      if (gap <= unit * 0.3) out += text;
      else if (gap < unit * 1.8) out += ` ${text}`;
      else out += " ".repeat(Math.max(2, column - out.length)) + text;
    }
    lastEnd = Math.max(lastEnd, item.x + item.width);
  }
  return out.trimEnd();
}

/** Las líneas de una página, de arriba abajo, con las columnas alineadas por posición. */
export function layoutLines(items: readonly PositionedText[]): string[] {
  const glyphs = items.filter(
    (i) => i.str.trim() !== "" && Number.isFinite(i.x) && Number.isFinite(i.y) && Number.isFinite(i.width) && Number.isFinite(i.height),
  );
  if (glyphs.length === 0) return [];
  const unit = charUnit(glyphs);
  const sorted = [...glyphs].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: PositionedText[][] = [];
  for (const glyph of sorted) {
    const current = lines.at(-1);
    if (current && current.some((other) => sameLine(other, glyph))) current.push(glyph);
    else lines.push([glyph]);
  }
  return lines.map((line) => render([...line].sort((a, b) => a.x - b.x), unit));
}

/** Todas las páginas, separadas por una línea en blanco. */
export function layoutPages(pages: readonly (readonly PositionedText[])[]): string {
  return pages.map((page) => layoutLines(page).join("\n")).join("\n\n");
}
