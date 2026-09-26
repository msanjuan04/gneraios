import path from "node:path";
import { Font } from "@react-pdf/renderer";
import { brand } from "@/brand";

// Fuentes y logo de la plantilla, leídos del disco. Next copia `public/` en la imagen de
// producción (ver Dockerfile) y el servidor arranca desde su raíz, así que las rutas se
// resuelven con `process.cwd()` igual en local, en los tests y en producción.

/** Familia principal: el subconjunto latin de Manrope (español, catalán, €, ª, º, ·). */
export const PDF_FONT_FAMILY = brand.fontFamily;
/** Reserva con el subconjunto latin-ext para nombres y direcciones de otros países (ł, č, ő…). */
export const PDF_FONT_FALLBACK = `${brand.fontFamily} Latin Ext`;
/** react-pdf elige, carácter a carácter, la primera familia que tenga el glifo. */
export const PDF_FONT_STACK = [PDF_FONT_FAMILY, PDF_FONT_FALLBACK];

const FONT_WEIGHTS = [400, 500, 600, 700, 800] as const;

function fontFile(subset: "latin" | "latin-ext", weight: number): string {
  // react-pdf lee TTF y WOFF, no WOFF2. Los ficheros salen de @fontsource/manrope.
  return path.join(process.cwd(), "public", "fonts", "manrope", `manrope-${subset}-${weight}-normal.woff`);
}

/** Logo plano (negro sobre blanco) de `brand.ts`. */
export function logoPath(): string {
  return path.join(process.cwd(), "public", brand.logos.logoFlat);
}

/**
 * Sin guiones de corte: los patrones por defecto de react-pdf son los del inglés y
 * partirían mal las palabras en español o catalán. Solo se trocea una palabra que no cabría
 * en ninguna columna (una URL o un correo muy largos), para que no se salga de la página.
 */
function hyphenation(word: string): string[] {
  if (word.length <= 32) return [word];
  return word.match(/.{1,16}/g) ?? [word];
}

let registered = false;

/** Registra Manrope una sola vez por proceso (también sobrevive a la recarga en desarrollo). */
export function registerPdfFonts(): void {
  if (registered) return;
  const known = new Set(Font.getRegisteredFontFamilies());
  const families = [
    [PDF_FONT_FAMILY, "latin"],
    [PDF_FONT_FALLBACK, "latin-ext"],
  ] as const;
  for (const [family, subset] of families) {
    if (known.has(family)) continue;
    Font.register({
      family,
      fonts: FONT_WEIGHTS.map((fontWeight) => ({ src: fontFile(subset, fontWeight), fontWeight })),
    });
  }
  Font.registerHyphenationCallback(hyphenation);
  registered = true;
}
