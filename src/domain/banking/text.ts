// Texto de los movimientos del banco: normalizar conceptos ("COMPRA TARJ. 5402XXXXXXXX1234 ADOBE
// *CREATIVE CLD"), sacar sus palabras significativas y buscar en ellos lo que identifica a alguien
// (un nombre, un NIF, un IBAN, un número de factura). Todo determinista y explicable: sin ML.

import { validateSpanishTaxId } from "../tax-id";

/** Mayúsculas, sin acentos, y cualquier signo como espacio: "Cafè l'Àvia, S.L." → "CAFE L AVIA S L". */
export function normalizeText(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

/** Formas jurídicas: no identifican a nadie ("Restaurant del Port SL" y "Restaurant del Port" son el mismo). */
const LEGAL_FORMS = new Set([
  "SL", "SA", "SLU", "SAU", "SLL", "SLP", "SLNE", "SCP", "SCCL", "SCOOP", "COOP", "CB", "SC", "LTD", "LIMITED", "INC",
  "LLC", "LLP", "PLC", "GMBH", "AG", "BV", "NV", "SAS", "SARL", "SRL", "SPA", "CORP", "CORPORATION", "SOCIEDAD", "LIMITADA",
  "ANONIMA", "UNIPERSONAL", "COMPANY",
]);

/** Palabras vacías (es, ca, en) y ruido de los conceptos bancarios. */
const NOISE = new Set([
  // Artículos, preposiciones y conjunciones.
  "DE", "DEL", "LA", "LAS", "EL", "LOS", "Y", "I", "E", "EN", "AL", "A", "UN", "UNA", "PARA", "POR", "PER", "AMB", "ELS",
  "LES", "DELS", "THE", "AND", "OF", "TO", "FOR", "FROM", "CON", "SIN", "SOBRE",
  // Ruido de los conceptos del banco.
  "TRANSFERENCIA", "TRANSFERENCIAS", "TRANSF", "TRANSFER", "TRANS", "TRF", "TRASPASO", "TRASPAS", "SEPA", "RECIBO",
  "RECIBOS", "REBUT", "REBUTS", "ADEUDO", "ADEUDOS", "DOMICILIACION", "DOMICILIADO", "DOMICILIADA", "DOMICILIACIO",
  "CARGO", "CARREC", "ABONO", "ABONAMENT", "COMPRA", "COMPRAS", "TARJ", "TARJETA", "TARJETAS", "TARGETA", "PAGO",
  "PAGOS", "PAGAMENT", "FAVOR", "ORDENANTE", "ORDENANT", "BENEFICIARIO", "BENEFICIARI", "CONCEPTO", "CONCEPTE",
  "REF", "REFERENCIA", "REFERENCIAS", "FRA", "FRAS", "FACT", "FACTURA", "FACTURAS", "FACTURES", "FAC", "NUM",
  "NUMERO", "NRO", "EUR", "EUROS", "OPERACION", "OPER", "COMERCIO", "COMERC", "INGRESO", "INGRES", "CTA", "CUENTA",
  "CUENTAS", "COMPTE", "INMEDIATA", "INMEDIATO", "PERIODICA", "EMITIDA", "RECIBIDA", "ORDEN", "MOVIMIENTO",
  "WWW", "COM", "HTTPS", "HTTP", "NET", "ORG", "DIA", "FECHA", "TITULAR", "OFICINA", "EXTRANJERO", "NACIONAL",
  "INTERNACIONAL", "CONTACTLESS", "PARCIAL", "CUENTA", "ANTICIPO",
]);

/**
 * Palabras de negocio que comparten muchos nombres ("Restaurant", "Hotel", "Ireland"): cuentan, pero
 * no bastan por sí solas para decir quién es.
 */
const GENERIC = new Set([
  "RESTAURANT", "RESTAURANTE", "HOTEL", "CLINICA", "DENTAL", "IMMOBILIARIA", "INMOBILIARIA", "TALLERS", "TALLERES",
  "TALLER", "ACADEMIA", "FLORISTERIA", "CONSTRUCCIONS", "CONSTRUCCIONES", "GYM", "FIT", "CELLER", "BAR", "CAFE",
  "CAFETERIA", "SERVICIOS", "SERVEIS", "GRUP", "GRUPO", "GLOBAL", "SOLUTIONS", "CONSULTING", "ESTUDIO", "STUDIO",
  "DIGITAL", "MARKETING", "SYSTEMS", "SOFTWARE", "IRELAND", "EMEA", "EUROPE", "SPAIN", "ESPANA", "INTERNATIONAL",
  "NETWORKS", "TECHNOLOGIES", "TECH", "CENTRO", "CENTRE", "TIENDA", "BOTIGA", "ASSESSOR", "ASESOR", "ASESORIA",
  "GESTORIA", "SEGUROS", "ASSEGURANCES", "CAN", "CASA", "GENERAL", "RETAIL", "PLATFORMS", "CLOUD", "LABS", "ONLINE",
  "ESCOLA", "ESCUELA", "COMPONENTES", "VIAJES", "PTY", "DEMO", "DEV", "MAR", "SOCIAL", "PROFESSIONAL", "PRO",
]);

/**
 * Siglas que el banco usa en lugar del nombre (y al revés): "RECIBO TGSS" es la Tesorería General de
 * la Seguridad Social y "AEAT", la Agencia Tributaria.
 */
const ALIASES: readonly [string, readonly string[]][] = [
  ["TGSS", ["TESORERIA", "SEGURIDAD", "SOCIAL"]],
  ["AEAT", ["AGENCIA", "TRIBUTARIA"]],
];

/** Todas las palabras, separando letras de números: "ADS8246910" → ADS, 8246910. */
export function words(value: string | null | undefined): string[] {
  const normalized = normalizeText(value);
  if (!normalized) return [];
  return normalized.split(" ").flatMap((w) => w.match(/[A-Z]+|[0-9]+/g) ?? []);
}

/** Una tarjeta enmascarada ("XXXXXXXX"), una palabra sin letras o de menos de 3 letras no dice nada. */
function isMeaningless(word: string): boolean {
  return /^X{3,}$/.test(word) || /^[0-9]+$/.test(word) || word.length < 3;
}

/** Palabras que identifican: sin ruido, sin formas jurídicas, sin números y de 3 letras o más. */
export function significantWords(value: string | null | undefined): string[] {
  const out: string[] = [];
  for (const word of words(value)) {
    if (isMeaningless(word) || NOISE.has(word) || LEGAL_FORMS.has(word)) continue;
    if (!out.includes(word)) out.push(word);
  }
  return out;
}

export function isGenericWord(word: string): boolean {
  return GENERIC.has(word);
}

/** Palabras del texto de un movimiento, con las siglas conocidas desplegadas (y al revés). */
export function tokenSet(...values: (string | null | undefined)[]): Set<string> {
  const set = new Set<string>();
  for (const value of values) for (const word of significantWords(value)) set.add(word);
  for (const [acronym, expansion] of ALIASES) {
    if (set.has(acronym)) for (const w of expansion) set.add(w);
    else if (expansion.every((w) => set.has(w))) set.add(acronym);
  }
  return set;
}

export type NameMatch = "strong" | "partial";

/**
 * ¿Aparece este nombre en el texto (un tokenSet)? "strong": todas sus palabras significativas, o al
 * menos dos y una de ellas distintiva ("Restaurant Can Sorra" en "TRANSF DE RESTAURANT CAN SORRA SL").
 * "partial": una palabra distintiva de 4 letras o más ("ADOBE" en "ADOBE *CREATIVE CLD").
 */
export function matchName(name: string | null | undefined, text: ReadonlySet<string>): NameMatch | null {
  const nameWords = significantWords(name);
  if (nameWords.length === 0) return null;
  const matched = nameWords.filter((w) => text.has(w));
  const distinctive = matched.filter((w) => !GENERIC.has(w));
  if (distinctive.length > 0 && (matched.length === nameWords.length || matched.length >= 2)) return "strong";
  if (distinctive.some((w) => w.length >= 4)) return "partial";
  return null;
}

/** El mejor resultado de varios nombres (nombre comercial y razón social). */
export function matchAnyName(names: readonly (string | null | undefined)[], text: ReadonlySet<string>): NameMatch | null {
  let best: NameMatch | null = null;
  for (const name of names) {
    const match = matchName(name, text);
    if (match === "strong") return "strong";
    if (match === "partial") best = "partial";
  }
  return best;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export type InvoiceNumberMatch = "exact" | "loose";

/**
 * ¿Está el número de una factura en el texto normalizado, tal y como lo escribe la gente? Con guion,
 * barra, espacio o sin nada y con o sin los ceros de la izquierda: "2026-0051" encaja con
 * "FRA 2026-0051", "FACTURA 2026/51" y "20260051". "exact" si también lleva las letras de la serie
 * ("GS2026-0003"); "loose" si el banco se las ha comido ("2026-0003"). Un número de una sola cifra
 * corta sin letras ("51") no se busca: aparecería por todas partes.
 */
export function findInvoiceNumber(number: string | null | undefined, normalizedText: string): InvoiceNumberMatch | null {
  const runs = words(number);
  if (runs.length === 0 || !normalizedText) return null;
  const digitIndexes = runs.flatMap((r, i) => (/^[0-9]+$/.test(r) ? [i] : []));
  if (digitIndexes.length === 0) return null;
  const hasLetters = runs.some((r) => /^[A-Z]+$/.test(r));
  if (!hasLetters && digitIndexes.length === 1 && runs[digitIndexes[0]!]!.length < 4) return null;
  const last = digitIndexes.at(-1)!;
  const build = (lettersRequired: boolean) => {
    const parts = runs.flatMap((run, i) => {
      if (/^[A-Z]+$/.test(run)) return lettersRequired ? [escapeRegExp(run)] : [];
      return [i === last ? `0*${run.replace(/^0+(?=\d)/, "")}` : escapeRegExp(run)];
    });
    return new RegExp(`(?<![A-Z0-9])${parts.join(" ?")}(?![0-9])`);
  };
  if (hasLetters && build(true).test(normalizedText)) return "exact";
  if (build(false).test(normalizedText)) return hasLetters ? "loose" : "exact";
  return null;
}

const CIF_OR_NIE = /(?<![A-Z0-9])([A-Z]) ?([0-9]{7}) ?([0-9A-Z])(?![A-Z0-9])/g;
const DNI = /(?<![A-Z0-9])([0-9]{8}) ?([A-Z])(?![A-Z0-9])/g;

/** NIF, NIE o CIF españoles válidos que aparecen en un texto normalizado ("B-12345674", "ESB12345674"). */
export function findTaxIds(normalizedText: string): Set<string> {
  const found = new Set<string>();
  const text = normalizedText.replace(/(?<![A-Z0-9])ES(?=[A-Z0-9] ?[0-9]{7})/g, "");
  for (const m of text.matchAll(CIF_OR_NIE)) {
    const check = validateSpanishTaxId(`${m[1]}${m[2]}${m[3]}`);
    if (check.valid) found.add(check.normalized);
  }
  for (const m of text.matchAll(DNI)) {
    const check = validateSpanishTaxId(`${m[1]}${m[2]}`);
    if (check.valid) found.add(check.normalized);
  }
  return found;
}

/** IBAN españoles que aparecen en un texto normalizado, con o sin espacios ("ES91 2100 0418 …"). */
export function findIbans(normalizedText: string): Set<string> {
  const found = new Set<string>();
  const compact = normalizedText.replace(/ /g, "");
  for (const match of compact.matchAll(/ES[0-9]{22}/g)) found.add(match[0]);
  return found;
}

/**
 * Clave de una regla a partir de un texto: sus primeras palabras significativas, las justas para
 * tener dos y alguna distintiva (hasta tres): "COMPRA TARJ. 5402XXXXXXXX1234 GOOGLE *ADS8246910
 * G.CO/HELPPAY#" → "GOOGLE ADS"; "TRANSF DE RESTAURANT CAN SORRA SL FRA 2026-0051" →
 * "RESTAURANT CAN SORRA". Sin ninguna palabra distintiva, no hay regla que aprender.
 */
export function ruleKey(value: string | null | undefined): string | null {
  const list: string[] = [];
  for (const word of significantWords(value)) {
    if (word.length > 40) continue;
    list.push(word);
    const distinctive = list.some((w) => !GENERIC.has(w));
    if ((distinctive && list.length >= 2) || list.length >= 3) break;
  }
  if (list.length === 0 || list.every((w) => GENERIC.has(w))) return null;
  return list.join(" ");
}

/** ¿Contiene el texto todas las palabras de la regla? */
export function matchesPattern(pattern: string, text: ReadonlySet<string>): boolean {
  const list = pattern.split(" ").filter(Boolean);
  return list.length > 0 && list.every((w) => text.has(w));
}

/** La primera de estas expresiones (en forma normalizada) que aparece como palabras enteras. */
export function findPhrase(normalizedText: string, phrases: readonly string[]): string | null {
  const padded = ` ${normalizedText} `;
  for (const phrase of phrases) if (padded.includes(` ${phrase} `)) return phrase;
  return null;
}
