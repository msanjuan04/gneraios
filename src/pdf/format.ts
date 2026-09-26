import { parseCivilDate, type CivilDate } from "@/domain/dates/civil-date";
import type { PdfLocale, PdfParty } from "./types";

const INTL_LOCALES: Record<PdfLocale, string> = { es: "es-ES", ca: "ca-ES", en: "en-IE" };

/** Locale de `Intl` para cada idioma del documento: el inglés sale en formato europeo (en-IE). */
export function intlLocale(locale: PdfLocale): string {
  return INTL_LOCALES[locale];
}

/**
 * Prepara un texto para la fuente del PDF: lo pasa a NFC (una vocal con tilde combinante
 * se convierte en la letra precompuesta que trae Manrope) y cambia los dos caracteres que
 * la fuente no incluye: el espacio fino (U+202F, que algunas versiones de ICU usan en los
 * números) por un espacio duro, y el guion duro (U+2011) por un guion normal.
 */
export function pdfText(text: string): string {
  return text.normalize("NFC").replace(/ /g, " ").replace(/‑/g, "-");
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** "2026-10-01" → "01/10/2026". El mismo formato en los tres idiomas. */
export function formatPdfDate(date: CivilDate): string {
  const { year, month, day } = parseCivilDate(date);
  return `${pad2(day)}/${pad2(month)}/${year}`;
}

/** "01/10/2026 – 31/10/2026"; si solo hay una de las dos fechas, esa. */
export function formatPeriod(start?: CivilDate | null, end?: CivilDate | null): string | null {
  if (start && end) return `${formatPdfDate(start)} – ${formatPdfDate(end)}`;
  if (start) return formatPdfDate(start);
  if (end) return formatPdfDate(end);
  return null;
}

const DECIMAL = /^-?\d+(?:\.\d+)?$/;
const quantityFormatters = new Map<string, Intl.NumberFormat>();

/**
 * Cantidad (`numeric(12,3)` en texto, "1.500") con hasta 3 decimales y los separadores del
 * idioma: "1,5" en es/ca y "1.5" en en. Si no es un decimal, se imprime tal cual.
 */
export function formatQuantity(quantity: string, locale: PdfLocale): string {
  const text = quantity.trim();
  if (!DECIMAL.test(text)) return text;
  const intl = intlLocale(locale);
  let nf = quantityFormatters.get(intl);
  if (!nf) {
    nf = new Intl.NumberFormat(intl, { maximumFractionDigits: 3, useGrouping: "always" });
    quantityFormatters.set(intl, nf);
  }
  return pdfText(nf.format(text as `${number}`));
}

/** Código postal, población y provincia: "08301 Mataró (Barcelona)". */
export function postalLine(party: PdfParty): string | null {
  const place = [party.postalCode, party.city].map((part) => part?.trim()).filter(Boolean).join(" ");
  const province = party.province?.trim();
  const showProvince = province && province.toLowerCase() !== party.city?.trim().toLowerCase();
  if (!showProvince) return place || null;
  return place ? `${place} (${province})` : province;
}
