/*
 * Colores de las gráficas del embudo, derivados de los tokens de marca (--chart-*).
 *
 * - Serie única (tasas de cierre, motivos de pérdida): --chart-1, el azul de marca.
 *   Contraste 3,72:1 sobre la tarjeta clara (#ffffff) y 5,20:1 sobre la oscura (#0b0e14).
 * - Etapas del embudo: una rampa ordinal de un solo azul, de la primera etapa (la que menos
 *   destaca) a Ganado (la que más). La marca intercambia --chart-3 y --chart-4 entre temas
 *   (azul profundo y azul claro), así que la misma expresión va de claro a profundo en el
 *   tema claro y de profundo a claro en el oscuro, que es lo que pide una rampa en cada uno.
 *   Validada con el validador ordinal de la skill dataviz (L monótona, ΔL ≥ 0,06 entre pasos,
 *   extremo más cercano a la superficie ≥ 2:1): pasa hasta 6 etapas en los dos temas (7 en el
 *   claro). Con más etapas los pasos se acercan, pero cada barra lleva su etiqueta.
 */

export const SERIES_COLOR = "var(--chart-1)";

/** Pista de las barras de tasa: el mismo azul, muy rebajado. */
export const TRACK_COLOR = "color-mix(in oklab, var(--chart-1) 16%, transparent)";

const RAMP_START = "color-mix(in oklab, var(--chart-1) 25%, var(--chart-4))";
const RAMP_MID = "color-mix(in oklab, var(--chart-1) 80%, var(--chart-3))";
const RAMP_END = "var(--chart-3)";

const percent = (value: number) => `${Math.round(value * 10_000) / 100}%`;

/** Color CSS de la etapa `index` (0 = la primera) de una secuencia de `count` etapas. */
export function stageColor(index: number, count: number): string {
  if (count <= 1) return RAMP_END;
  const t = Math.min(1, Math.max(0, index / (count - 1)));
  return t <= 0.5
    ? `color-mix(in oklab, ${RAMP_MID} ${percent(t * 2)}, ${RAMP_START})`
    : `color-mix(in oklab, ${RAMP_END} ${percent(t * 2 - 1)}, ${RAMP_MID})`;
}
