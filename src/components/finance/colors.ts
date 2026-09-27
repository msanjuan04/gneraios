/*
 * Colores de las gráficas de Finanzas, derivados de los tokens de marca (--chart-*), como los del
 * dashboard (src/components/dashboard/colors.ts):
 *
 * - Ingresos: el azul de marca (--chart-1), el mismo que el recurrente del dashboard.
 * - Gastos: un neutro (tinta al 34 % sobre la tarjeta): se lee como coste y contrasta con el azul
 *   en los dos temas (≥ 2:1 con la superficie, como las rampas del dashboard).
 * - Margen: la tinta de texto con halo del color de la tarjeta (se lee al cruzar las barras).
 * - Saldo previsto: el azul de marca; por debajo de cero, el rojo de estado.
 * Cada serie lleva leyenda y vista de tabla: la identidad nunca depende solo del color.
 */

export { AXIS_TEXT, GRID, SURFACE } from "@/components/dashboard/colors";

export const REVENUE = "var(--chart-1)";
export const EXPENSES = "color-mix(in oklab, var(--foreground) 34%, var(--card))";
export const MARGIN = "var(--foreground)";
export const BALANCE = "var(--chart-1)";
export const NEGATIVE = "var(--destructive)";
