import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Imagen Docker mínima para DigitalOcean App Platform.
  output: "standalone",
  poweredByHeader: false,
  // Abajo a la izquierda tapaba el avatar del usuario en la sidebar.
  devIndicators: { position: "bottom-right" },
};

export default withNextIntl(nextConfig);
