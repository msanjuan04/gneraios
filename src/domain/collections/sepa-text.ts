// Juego de caracteres de los ficheros SEPA (EPC217-08, «SEPA Requirements for an Extended
// Character Set»). El conjunto básico, el único que aceptan todos los bancos, es:
//
//   a-z A-Z 0-9 / - ? : ( ) . , ' + y el espacio
//
// Todo texto que va a un fichero de adeudos (nombres, conceptos) se translitera a ese conjunto:
// las letras con tilde, diéresis o cedilla pierden el signo ("Mataró" → "Mataro", "Ñandú" →
// "Nandu"), el punto volado catalán es un punto ("l·l" → "l.l"), "&" es "+" y lo que no tiene
// equivalente se convierte en espacio. Se hace con una tabla propia (no con `normalize`) para que
// el resultado sea idéntico en cualquier entorno, también en una app móvil.

const ALLOWED = /^[A-Za-z0-9/\-?:().,'+ ]$/;
const ALLOWED_TEXT = /^[A-Za-z0-9/\-?:().,'+ ]*$/;
const IDENTIFIER = /^[A-Za-z0-9/\-?:().,'+]+$/;

// [caracteres de origen, sustitución de cada uno]
const GROUPS: readonly (readonly [string, string])[] = [
  ["ÀÁÂÃÄÅĀĂĄ", "A"],
  ["àáâãäåāăą", "a"],
  ["Æ", "AE"],
  ["æ", "ae"],
  ["ÇĆĈĊČ", "C"],
  ["çćĉċč", "c"],
  ["ĎĐÐ", "D"],
  ["ďđð", "d"],
  ["ÈÉÊËĒĔĖĘĚ", "E"],
  ["èéêëēĕėęě", "e"],
  ["ĜĞĠĢ", "G"],
  ["ĝğġģ", "g"],
  ["ĤĦ", "H"],
  ["ĥħ", "h"],
  ["ÌÍÎÏĨĪĬĮİ", "I"],
  ["ìíîïĩīĭįı", "i"],
  ["Ĳ", "IJ"],
  ["ĳ", "ij"],
  ["Ĵ", "J"],
  ["ĵ", "j"],
  ["Ķ", "K"],
  ["ķĸ", "k"],
  ["ĹĻĽĿŁ", "L"],
  ["ĺļľŀł", "l"],
  ["ÑŃŅŇŊ", "N"],
  ["ñńņňŉŋ", "n"],
  ["ÒÓÔÕÖØŌŎŐ", "O"],
  ["òóôõöøōŏő", "o"],
  ["Œ", "OE"],
  ["œ", "oe"],
  ["ŔŖŘ", "R"],
  ["ŕŗř", "r"],
  ["ŚŜŞŠ", "S"],
  ["śŝşš", "s"],
  ["ß", "ss"],
  ["ŢŤŦ", "T"],
  ["ţťŧ", "t"],
  ["Þ", "TH"],
  ["þ", "th"],
  ["ÙÚÛÜŨŪŬŮŰŲ", "U"],
  ["ùúûüũūŭůűų", "u"],
  ["Ŵ", "W"],
  ["ŵ", "w"],
  ["ÝŸŶ", "Y"],
  ["ýÿŷ", "y"],
  ["ŹŻŽ", "Z"],
  ["źżž", "z"],
  ["ª", "a"],
  ["º", "o"],
  ["¹", "1"],
  ["²", "2"],
  ["³", "3"],
  // Punto volado catalán (l·l) y viñetas.
  ["·‧•", "."],
  ["&", "+"],
  // Comillas y acentos sueltos: el apóstrofo es el único signo de este tipo admitido.
  ["‘’‚‛′`´\"“”„«»", "'"],
  // Guiones de todo tipo y el guion bajo.
  ["‐‑‒–—―−_", "-"],
  ["€", "EUR"],
];

const TRANSLITERATION: ReadonlyMap<string, string> = new Map(
  GROUPS.flatMap(([sources, target]) => [...sources].map((ch) => [ch, target] as const)),
);

/** ¿Solo lleva caracteres del conjunto básico SEPA? */
export function isSepaText(value: string): boolean {
  return ALLOWED_TEXT.test(value);
}

/**
 * Texto listo para un fichero SEPA: transliterado al conjunto básico, sin espacios repetidos ni
 * en los extremos y recortado a `maxLength` caracteres ("Cafè l'Àvia & Fills" → "Cafe l'Avia +
 * Fills"). Puede quedar vacío si no había nada aprovechable.
 */
export function toSepaText(value: string, maxLength: number): string {
  if (!Number.isInteger(maxLength) || maxLength < 1) throw new Error(`Longitud máxima no válida: ${maxLength}`);
  let out = "";
  for (const ch of value) out += ALLOWED.test(ch) ? ch : (TRANSLITERATION.get(ch) ?? " ");
  out = out.replace(/ {2,}/g, " ").trim();
  return out.length > maxLength ? out.slice(0, maxLength).trimEnd() : out;
}

/**
 * Identificador SEPA (referencia de mandato, del mensaje o del adeudo): de 1 a `maxLength`
 * caracteres del conjunto básico sin espacios, que no empieza ni acaba en "/" ni contiene "//"
 * (reglas de las guías de implementación del EPC).
 */
export function isSepaIdentifier(value: string, maxLength = 35): boolean {
  return (
    value.length >= 1 &&
    value.length <= maxLength &&
    IDENTIFIER.test(value) &&
    !value.startsWith("/") &&
    !value.endsWith("/") &&
    !value.includes("//")
  );
}

/**
 * Trozo de identificador a partir de un texto libre: solo letras y números en mayúsculas y
 * guiones sueltos ("F26/0038" → "F26-0038", "Restaurant del Port" → "RESTAURANT-DEL-PORT").
 */
export function toIdentifierPart(value: string, maxLength: number): string {
  const plain = toSepaText(value, Math.max(maxLength * 2, 1)).toUpperCase();
  const dashed = plain
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
  return dashed.slice(0, maxLength).replace(/-$/, "");
}
