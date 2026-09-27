/**
 * Entregables del portal: nombres de fichero seguros para la ruta de Storage, tamaños legibles y
 * enlaces que se pueden enseñar a un cliente (solo http y https).
 */

/** 50 MB: el límite del bucket client-files. */
export const CLIENT_FILE_MAX_BYTES = 50 * 1024 * 1024;

const MAX_NAME = 100;

/**
 * "Propuesta final (v2).PDF" → "Propuesta-final-v2.pdf": sin acentos, sin espacios ni barras y
 * con la extensión en minúsculas, para que la ruta de Storage no dependa del sistema de quien sube.
 */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10) : "";
  const cleanStem =
    stem
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "")
      .slice(0, MAX_NAME - ext.length - 1) || "archivo";
  return ext ? `${cleanStem}.${ext}` : cleanStem;
}

/** ¿Es un enlace que se puede enseñar? Solo http(s), sin espacios y con host. */
export function isSafeUrl(value: string): boolean {
  const text = value.trim();
  if (text.length > 2000 || /\s/.test(text)) return false;
  try {
    const url = new URL(text);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname.length > 0;
  } catch {
    return false;
  }
}

const UNITS = ["B", "KB", "MB", "GB"] as const;

/** 1536 → "1,5 KB" (es/ca) o "1.5 KB" (en). */
export function formatBytes(bytes: number, intlLocale: string): string {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 10 ? 0 : 1;
  return `${new Intl.NumberFormat(intlLocale, { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(value)} ${UNITS[unit]}`;
}
