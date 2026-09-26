/*
 * Colores de las gráficas del dashboard, derivados de los tokens de marca (--chart-*): cambian
 * solos con el tema porque la marca intercambia --chart-3 y --chart-4 (azul profundo y azul
 * claro) entre claro y oscuro.
 *
 * - Ingresos (recurrente → uso → one-off): una rampa ordinal del azul de marca, de lo más
 *   previsible (recurrente, el azul de la web) a lo menos. Validada con el validador ordinal
 *   de la skill dataviz en los dos temas: L monótona, ΔL ≥ 0,06 entre pasos y el paso más
 *   cercano a la superficie ≥ 2:1 (oscuro #2e80ff → #2460d2 → #1b46ad, 2,32:1 sobre #0b0e14;
 *   claro #2e80ff → #599eff → #7bb7ff, 2,09:1 sobre #ffffff). Cada serie lleva leyenda y
 *   la vista de tabla, así que la identidad nunca depende solo del color.
 * - MRR: tinta de texto (blanco / negro) sobre un halo del color de la tarjeta, para que la
 *   línea se lea al cruzar las barras (contraste ≥ 3,7:1 con todos los rellenos).
 * - Movimientos de MRR: divergente, azul lo que suma y rojo lo que resta, con dos
 *   intensidades por lado; cada barra lleva su nombre y su cifra.
 */

export const SERIES = {
  recurring: "var(--chart-1)",
  usage: "color-mix(in oklab, var(--chart-1) 58%, var(--chart-4))",
  oneOff: "color-mix(in oklab, var(--chart-1) 22%, var(--chart-4))",
} as const;

export const MRR_LINE = "var(--foreground)";
export const SURFACE = "var(--card)";

export const MOVEMENT = {
  level: "color-mix(in oklab, var(--foreground) 40%, var(--card))",
  new: "var(--chart-1)",
  expansion: "color-mix(in oklab, var(--chart-1) 50%, var(--chart-4))",
  contraction: "color-mix(in oklab, var(--destructive) 62%, var(--card))",
  churn: "var(--destructive)",
  adjustment: "color-mix(in oklab, var(--foreground) 22%, var(--card))",
} as const;

export const GRID = "var(--border)";
export const AXIS_TEXT = "var(--muted-foreground)";
/** Pista de medidores y barras de reparto: el azul de marca muy rebajado. */
export const TRACK = "color-mix(in oklab, var(--chart-1) 14%, transparent)";
