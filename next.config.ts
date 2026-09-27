import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// Cabeceras de seguridad. Las que prohíben meter la app en un iframe (clickjacking) y fuerzan
// HTTPS solo se envían cuando la app vive en HTTPS (producción): en local rompería la vista previa.
const httpsApp = (process.env.NEXT_PUBLIC_APP_URL ?? "").startsWith("https://");
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(httpsApp
    ? [
        { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
      ]
    : []),
];

const nextConfig: NextConfig = {
  // Imagen Docker mínima para DigitalOcean App Platform.
  output: "standalone",
  poweredByHeader: false,
  // Abajo a la izquierda tapaba el avatar del usuario en la sidebar.
  devIndicators: { position: "bottom-right" },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // Los prompts del consejo se leen del disco al ejecutar (src/council/agents/prompts.ts): que la
  // imagen standalone los lleve siempre, los detecte o no el trazado de ficheros.
  outputFileTracingIncludes: {
    "/api/cron/council": ["./src/council/agents/**/*.md"],
    "/[org]/council": ["./src/council/agents/**/*.md"],
    "/[org]/council/**": ["./src/council/agents/**/*.md"],
  },
};

export default withNextIntl(nextConfig);
