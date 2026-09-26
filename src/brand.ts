/**
 * Marca de GNERAI: única fuente de verdad para la app y los PDFs.
 *
 * Los valores salen de gnerai.com (`gweb/src/app/globals.css` y `layout.tsx`).
 * Un color de marca se cambia aquí y en ningún otro sitio: `brandCss()` genera
 * las variables CSS que consume Tailwind y la plantilla PDF lee este objeto.
 */

export const brand = {
  name: "GNERAI",
  product: "GNERAI OS",
  website: "https://gnerai.com",
  fontFamily: "Manrope",
  palette: {
    black: "#04060a",
    white: "#ffffff",
    blue: "#0114ff",
    blueBright: "#2e80ff",
    blueDeep: "#173697",
    violet: "#7c6fff",
    green: "#05df72",
    amber: "#fcbb00",
    red: "#fb2c36",
  },
  gradients: {
    primary: "linear-gradient(135deg, #173697, #2e80ff)",
    secondary: "linear-gradient(135deg, #7c6fff, #2e80ff)",
  },
  logos: {
    /** Isotipo metálico con transparencia (login, sidebar en oscuro). */
    isotypeMetal: "/brand/gnerai-isotipo-metal.png",
    /** Isotipo + logotipo planos en negro con transparencia (PDF, modo claro). */
    logoFlat: "/brand/gnerai-logo-plano.png",
  },
} as const;

const TOKEN_NAMES = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "success",
  "warning",
  "border",
  "input",
  "ring",
  "glass",
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
  "sidebar",
  "sidebar-foreground",
  "sidebar-primary",
  "sidebar-primary-foreground",
  "sidebar-accent",
  "sidebar-accent-foreground",
  "sidebar-border",
  "sidebar-ring",
] as const;

type ThemeTokens = Record<(typeof TOKEN_NAMES)[number], string>;

const p = brand.palette;

/**
 * Modo oscuro: el de gnerai.com. El texto secundario sube del 40 % de la web
 * al 55 % porque una herramienta diaria usa texto pequeño y debe pasar AA.
 */
const dark: ThemeTokens = {
  background: p.black,
  foreground: p.white,
  card: "#0b0e14",
  "card-foreground": p.white,
  popover: "#0d1017",
  "popover-foreground": p.white,
  primary: p.blueBright,
  "primary-foreground": p.white,
  secondary: "rgba(255, 255, 255, 0.06)",
  "secondary-foreground": p.white,
  muted: "rgba(255, 255, 255, 0.04)",
  "muted-foreground": "rgba(255, 255, 255, 0.55)",
  accent: "rgba(255, 255, 255, 0.06)",
  "accent-foreground": p.white,
  destructive: p.red,
  success: p.green,
  warning: p.amber,
  border: "rgba(255, 255, 255, 0.08)",
  input: "rgba(255, 255, 255, 0.10)",
  ring: p.blueBright,
  glass: "rgba(8, 10, 16, 0.55)",
  "chart-1": p.blueBright,
  "chart-2": p.violet,
  "chart-3": "#90c5ff",
  "chart-4": p.blueDeep,
  "chart-5": p.green,
  sidebar: "#06080d",
  "sidebar-foreground": "rgba(255, 255, 255, 0.72)",
  "sidebar-primary": p.blueBright,
  "sidebar-primary-foreground": p.white,
  "sidebar-accent": "rgba(255, 255, 255, 0.06)",
  "sidebar-accent-foreground": p.white,
  "sidebar-border": "rgba(255, 255, 255, 0.06)",
  "sidebar-ring": p.blueBright,
};

/**
 * Modo claro: la web no lo tiene, así que se deriva. El acento de texto usa el
 * azul profundo porque el azul brillante no llega a AA sobre blanco.
 */
const light: ThemeTokens = {
  background: p.white,
  foreground: p.black,
  card: p.white,
  "card-foreground": p.black,
  popover: p.white,
  "popover-foreground": p.black,
  primary: p.blueDeep,
  "primary-foreground": p.white,
  secondary: "#f1f3f6",
  "secondary-foreground": p.black,
  muted: "#f5f6f8",
  "muted-foreground": "rgba(4, 6, 10, 0.6)",
  accent: "rgba(4, 6, 10, 0.05)",
  "accent-foreground": p.black,
  destructive: "#e40014",
  success: "#0a9f58",
  warning: "#b88700",
  border: "rgba(4, 6, 10, 0.09)",
  input: "rgba(4, 6, 10, 0.14)",
  ring: p.blueBright,
  glass: "rgba(255, 255, 255, 0.72)",
  "chart-1": p.blueBright,
  "chart-2": p.violet,
  "chart-3": p.blueDeep,
  "chart-4": "#90c5ff",
  "chart-5": "#0a9f58",
  sidebar: "#f7f8fa",
  "sidebar-foreground": "rgba(4, 6, 10, 0.72)",
  "sidebar-primary": p.blueDeep,
  "sidebar-primary-foreground": p.white,
  "sidebar-accent": "rgba(4, 6, 10, 0.05)",
  "sidebar-accent-foreground": p.black,
  "sidebar-border": "rgba(4, 6, 10, 0.07)",
  "sidebar-ring": p.blueBright,
};

export const themes = { dark, light } as const;

function declarations(tokens: ThemeTokens): string {
  return TOKEN_NAMES.map((name) => `--${name}:${tokens[name]};`).join("");
}

/** Variables CSS de marca. El modo claro va en `:root` y el oscuro en `.dark`. */
export function brandCss(): string {
  const shared =
    `--radius:0.75rem;` +
    `--gradient-primary:${brand.gradients.primary};` +
    `--gradient-secondary:${brand.gradients.secondary};`;
  return `:root{${shared}${declarations(light)}}.dark{${declarations(dark)}}`;
}
