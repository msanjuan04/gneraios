import type { Bps, Cents } from "../money";

/**
 * Valores tal y como los escribe un socio en un formulario (a la española, con coma decimal) y
 * de vuelta. Lo que sale de aquí lo leen igual los editores de presupuestos, contratos y facturas
 * (parseMoneyInput, sus lectores de porcentajes y de cantidades): sin separador de miles y con
 * coma decimal, que es lo único que todos entienden igual.
 */

const QUANTITY_INPUT = /^(\d{1,9})(?:[.,](\d{1,3}))?$/;
const PERCENT_INPUT = /^(\d{1,3})(?:[.,](\d{1,2}))?$/;
const DECIMAL = /^(\d+)(?:\.(\d+))?$/;

/** 150050 → "1500,50"; 150000 → "1500". Exacto: sin pasar por decimales binarios. */
export function centsToInput(cents: Cents): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const units = Math.floor(abs / 100);
  const rest = abs % 100;
  return rest === 0 ? `${sign}${units}` : `${sign}${units},${String(rest).padStart(2, "0")}`;
}

/** 1250 → "12,5"; 3333 → "33,33"; 5000 → "50"; 0 → "0". */
export function bpsToInput(bps: Bps): string {
  const units = Math.floor(bps / 100);
  const rest = bps % 100;
  if (rest === 0) return String(units);
  return `${units},${String(rest).padStart(2, "0").replace(/0$/, "")}`;
}

/** Un descuento en un formulario: vacío si no hay. */
export function discountToInput(bps: Bps): string {
  return bps === 0 ? "" : bpsToInput(bps);
}

/**
 * Cantidad guardada (numeric: 2, 2.5 o "2.500") → texto canónico con punto decimal ("2", "2.5"),
 * el que guardan las líneas. Lanza si no es un decimal positivo con 3 decimales como mucho.
 */
export function quantityText(value: string | number): string {
  const text = typeof value === "number" ? String(value) : value.trim();
  const match = DECIMAL.exec(text);
  if (!match) throw new Error(`Cantidad no válida: «${String(value)}».`);
  const integer = match[1]!.replace(/^0+(?=\d)/, "");
  const fraction = (match[2] ?? "").replace(/0+$/, "");
  if (fraction.length > 3 || (integer === "0" && fraction === "")) throw new Error(`Cantidad no válida: «${String(value)}».`);
  return fraction ? `${integer}.${fraction}` : integer;
}

/** "2.5" → "2,5"; "2" → "2". */
export function quantityToInput(quantity: string): string {
  return quantity.replace(".", ",");
}

/**
 * Cantidad escrita ("2,5", "2.5", "10") → texto canónico ("2.5"), o null si no es un número
 * mayor que 0 con 3 decimales como mucho (numeric(12,3)). Sin separador de miles.
 */
export function parseQuantityInput(value: string): string | null {
  const match = QUANTITY_INPUT.exec(value.trim());
  if (!match) return null;
  const integer = match[1]!.replace(/^0+(?=\d)/, "");
  const fraction = (match[2] ?? "").replace(/0+$/, "");
  if (integer === "0" && fraction === "") return null;
  return fraction ? `${integer}.${fraction}` : integer;
}

/** "10" → 1000, "12,5" → 1250, "33,33 %" → 3333. null si no está entre 0 y 100 (2 decimales como mucho). */
export function parsePercentInput(value: string): Bps | null {
  const match = PERCENT_INPUT.exec(value.trim().replace(/\s*%$/, ""));
  if (!match) return null;
  const bps = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return bps <= 10_000 ? bps : null;
}

/** Un descuento escrito: vacío es 0. */
export function parseDiscountInput(value: string): Bps | null {
  return value.trim() === "" ? 0 : parsePercentInput(value);
}
