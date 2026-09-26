/**
 * Formato de numeración de una serie. Tokens:
 * - `{yyyy}`: año con 4 cifras · `{yy}`: año con 2 cifras
 * - `{n}`: número sin relleno · `{n:4}`: número con ceros a la izquierda hasta 4 cifras
 * Ejemplo: `{yyyy}-{n:4}` → `2026-0038`, el formato que ya usa la app de facturas.
 */

const NUMBER_TOKEN = /\{n(?::([1-9]))?\}/;
const YEAR_TOKEN = /\{yy(?:yy)?\}/;

export function isValidSeriesFormat(format: string, resetYearly: boolean): boolean {
  return NUMBER_TOKEN.test(format) && (!resetYearly || YEAR_TOKEN.test(format));
}

export function formatInvoiceNumber(format: string, year: number, sequence: number): string {
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error("El número de factura debe ser un entero positivo");
  if (!Number.isInteger(year) || year < 2000 || year > 2999) throw new Error("Año fuera de rango");
  return format
    .replaceAll("{yyyy}", String(year))
    .replaceAll("{yy}", String(year).slice(-2))
    .replace(/\{n(?::([1-9]))?\}/g, (_, width?: string) => String(sequence).padStart(width ? Number(width) : 0, "0"));
}
