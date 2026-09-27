import { themes } from "@/brand";

/**
 * Tema de las páginas públicas. La app usa el tema que elige cada socio (next-themes, oscuro por
 * defecto); el cliente, en cambio, ve el de su sistema. Por eso aquí los tokens de marca se
 * declaran en `.portal-root` según `prefers-color-scheme`, y los componentes públicos solo usan
 * utilidades de tokens (bg-background, text-foreground…), nunca la variante `dark:`.
 */

const declarations = (tokens: Record<string, string>) =>
  Object.entries(tokens)
    .map(([name, value]) => `--${name}:${value};`)
    .join("");

const DARK = "@media (prefers-color-scheme: dark)";

export const portalThemeCss = [
  `.portal-root{${declarations(themes.light)}color-scheme:light;}`,
  `${DARK}{.portal-root{${declarations(themes.dark)}color-scheme:dark;}}`,
  // Lo que queda fuera (el rebote del scroll en móvil) con el mismo fondo.
  `html:has(.portal-root),html:has(.portal-root) body{background:${themes.light.background};color-scheme:light;}`,
  `${DARK}{html:has(.portal-root),html:has(.portal-root) body{background:${themes.dark.background};color-scheme:dark;}}`,
  // El logo plano es negro: en oscuro, blanco.
  `.portal-logo{filter:none}${DARK}{.portal-logo{filter:invert(1)}}`,
  // Estrellas de gnerai.com solo en oscuro, y solo detrás del saludo.
  `.portal-stars{display:none}${DARK}{.portal-stars{display:block}}`,
  // La fase en curso late (salvo que se pida menos movimiento).
  `@keyframes portal-pulse{0%{box-shadow:0 0 0 0 color-mix(in oklab,var(--primary) 50%,transparent)}70%{box-shadow:0 0 0 10px transparent}100%{box-shadow:0 0 0 0 transparent}}`,
  `.portal-pulse{animation:portal-pulse 2.4s ease-out infinite}`,
  `@keyframes portal-rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}`,
  `.portal-rise{animation:portal-rise .5s cubic-bezier(.2,.7,.2,1) both}`,
  `@media (prefers-reduced-motion: reduce){.portal-pulse,.portal-rise{animation:none}}`,
  `.portal-root [id]{scroll-margin-top:5.5rem}`,
  // Firma tecleada: una letra manuscrita del sistema.
  `.portal-signature{font-family:"Snell Roundhand","Segoe Script","Brush Script MT","Apple Chancery",cursive;}`,
].join("");
