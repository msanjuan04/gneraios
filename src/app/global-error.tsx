"use client";

import { brand } from "@/brand";
import es from "@/i18n/messages/es/errors.json";

// Si falla el propio layout raíz no hay proveedor de traducciones ni estilos globales: una página
// mínima y autónoma, con los colores de la marca y los textos del catálogo en español.
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const t = es.errorBoundary;
  return (
    <html lang="es">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: brand.palette.black,
          color: brand.palette.white,
          fontFamily: `${brand.fontFamily}, -apple-system, Segoe UI, Roboto, sans-serif`,
          textAlign: "center",
          padding: 24,
        }}
      >
        <title>{brand.product}</title>
        <div style={{ maxWidth: 420 }}>
          <p style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.08em", color: brand.palette.blueBright, margin: 0 }}>{brand.product}</p>
          <h1 style={{ fontSize: 26, margin: "16px 0 8px" }}>{t.globalTitle}</h1>
          <p style={{ color: "rgb(255 255 255 / 0.65)", margin: 0 }}>{t.globalBody}</p>
          {error.digest && <p style={{ fontFamily: "monospace", fontSize: 12, color: "rgb(255 255 255 / 0.45)" }}>{error.digest}</p>}
          <button
            type="button"
            onClick={() => retry()}
            style={{
              marginTop: 24,
              padding: "12px 22px",
              borderRadius: 999,
              border: 0,
              background: brand.gradients.primary,
              color: brand.palette.white,
              fontWeight: 700,
              fontSize: 15,
              cursor: "pointer",
            }}
          >
            {t.retry}
          </button>
        </div>
      </body>
    </html>
  );
}
