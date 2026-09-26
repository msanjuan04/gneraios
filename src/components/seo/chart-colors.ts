/*
 * Colores de las gráficas de SEO, derivados de los tokens de marca (--chart-*, --foreground, --card).
 *
 * Forma "énfasis": una sola serie en el azul de marca (--chart-1) y el contexto (periodo de
 * comparación, canales que no son SEO) en un gris. No se usan dos azules como series distintas:
 * --chart-1 y --chart-2 (azul y violeta) no se distinguen con daltonismo (ΔE 0,8 en deuteranopía,
 * validado con la skill dataviz).
 *
 * El gris es el texto mezclado al 45 % con la tarjeta, así que cambia solo con el tema:
 * #8e8f91 sobre blanco (3,24:1) y #797a7e sobre #0b0e14 (4,51:1). Frente al azul: ΔE ≥ 18,6 en
 * visión normal, deuteranopía y protanopía, en los dos temas. El azul: 3,72:1 y 5,20:1.
 */

export const SEO_ACCENT = "var(--chart-1)";
export const SEO_MUTED = "color-mix(in oklab, var(--foreground) 45%, var(--card))";
/** Relleno del área: el azul como velo (~10 %), nunca un bloque saturado. */
export const SEO_ACCENT_WASH = "color-mix(in oklab, var(--chart-1) 12%, transparent)";
/** Pista de las barras: el mismo azul, muy rebajado. */
export const SEO_TRACK = "color-mix(in oklab, var(--chart-1) 14%, transparent)";
export const SEO_GRID = "var(--border)";
