import { publicEnv } from "@/lib/env";

/**
 * Dirección absoluta de la app para redirigir desde una ruta del servidor. No se usa
 * `request.url`: detrás de nginx es la interna (http://127.0.0.1:3300) y el navegador acabaría
 * en localhost. En local, NEXT_PUBLIC_APP_URL es la del navegador (http://localhost:3100).
 */
export function publicUrl(path: string): URL {
  return new URL(path, publicEnv.NEXT_PUBLIC_APP_URL);
}

/** Si la app se sirve por HTTPS (y sus cookies deben ser Secure), según su dirección pública. */
export function publicIsHttps(): boolean {
  return publicEnv.NEXT_PUBLIC_APP_URL.startsWith("https://");
}
