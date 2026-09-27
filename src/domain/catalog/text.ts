import {
  CATALOG_LIMITS,
  type CatalogLocale,
  type CatalogTexts,
  type CatalogTranslation,
  type CatalogTranslations,
  TRANSLATED_LOCALES,
  type TranslatedLocale,
} from "./types";

/**
 * Textos del catálogo: normalización, validación (gemelas de private.catalog_text_ok y
 * private.catalog_translations_ok), el texto en cada idioma con el castellano de respaldo y la
 * descripción de la línea que sale de un servicio.
 */

export type CatalogTextError = "required" | "tooLong" | "invalid";

/** ¿Lleva caracteres de control? Los que rechaza [[:cntrl:]] en Postgres (categoría Cc de Unicode). */
function hasControl(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0)!;
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

/** Espacios, tabuladores y saltos de línea seguidos → un espacio; sin espacios en los extremos. */
export function normalizeCatalogText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Longitud como la cuenta Postgres (char_length): por caracteres, no por unidades UTF-16. */
function length(value: string): number {
  return [...value].length;
}

/**
 * ¿Vale como texto del catálogo? Gemela de private.catalog_text_ok: de 1 a `max` caracteres, sin
 * espacios en los extremos y sin caracteres de control. null si vale.
 */
export function catalogTextError(value: string, max: number): CatalogTextError | null {
  if (value.length === 0) return "required";
  if (length(value) > max) return "tooLong";
  if (value !== value.replace(/^ +| +$/g, "") || hasControl(value)) return "invalid";
  return null;
}

const FIELD_MAX = { name: CATALOG_LIMITS.name, description: CATALOG_LIMITS.description } as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * ¿Valen como traducciones? Gemela de private.catalog_translations_ok: un objeto con solo `ca` y
 * `en`, cada uno con `name` y/o `description` (textos válidos, nada vacío). null si valen.
 */
export function translationsError(value: unknown): "invalid" | null {
  if (!isRecord(value)) return "invalid";
  for (const [locale, entry] of Object.entries(value)) {
    if (!(TRANSLATED_LOCALES as readonly string[]).includes(locale) || !isRecord(entry)) return "invalid";
    const fields = Object.entries(entry);
    if (fields.length === 0) return "invalid";
    for (const [field, text] of fields) {
      if (field !== "name" && field !== "description") return "invalid";
      if (typeof text !== "string" || catalogTextError(text, FIELD_MAX[field]) !== null) return "invalid";
    }
  }
  return null;
}

/**
 * Traducciones guardadas (jsonb) → las del dominio. La base de datos ya garantiza la forma; aun
 * así, lo que no la tenga se descarta en lugar de romper la pantalla.
 */
export function readTranslations(value: unknown): CatalogTranslations {
  if (!isRecord(value)) return {};
  const out: CatalogTranslations = {};
  for (const locale of TRANSLATED_LOCALES) {
    const entry = value[locale];
    if (!isRecord(entry)) continue;
    const translation: CatalogTranslation = {};
    if (typeof entry.name === "string" && entry.name !== "") translation.name = entry.name;
    if (typeof entry.description === "string" && entry.description !== "") translation.description = entry.description;
    if (translation.name !== undefined || translation.description !== undefined) out[locale] = translation;
  }
  return out;
}

/** Lo escrito en el formulario (vacío = sin traducir) → lo que se guarda: normalizado y sin vacíos. */
export function buildTranslations(
  input: Partial<Record<TranslatedLocale, { name?: string; description?: string }>>,
): CatalogTranslations {
  const out: CatalogTranslations = {};
  for (const locale of TRANSLATED_LOCALES) {
    const name = normalizeCatalogText(input[locale]?.name ?? "");
    const description = normalizeCatalogText(input[locale]?.description ?? "");
    if (!name && !description) continue;
    out[locale] = { ...(name && { name }), ...(description && { description }) };
  }
  return out;
}

/** Nombre y descripción en un idioma: cada uno el traducido o, si no lo hay, el castellano. */
export function localizedTexts(source: CatalogTexts, locale: CatalogLocale): { name: string; description: string | null } {
  if (locale === "es") return { name: source.name, description: source.description };
  const translation = source.translations[locale];
  return {
    name: translation?.name ?? source.name,
    description: translation?.description ?? source.description,
  };
}

/** ¿Tiene algo traducido a ese idioma? (el castellano siempre). */
export function isTranslated(source: CatalogTexts, locale: CatalogLocale): boolean {
  if (locale === "es") return true;
  const translation = source.translations[locale];
  return Boolean(translation?.name || translation?.description);
}

/** Separador entre el nombre y la descripción en la línea. */
export const LINE_SEPARATOR = " — ";

/**
 * Descripción de la línea que sale de un servicio: "Nombre — descripción" (o solo el nombre), en
 * una sola línea. Con los límites del catálogo cabe en los 500 caracteres de una línea.
 */
export function lineDescription(texts: { name: string; description: string | null }): string {
  const name = normalizeCatalogText(texts.name);
  const description = normalizeCatalogText(texts.description ?? "");
  return description ? `${name}${LINE_SEPARATOR}${description}` : name;
}
