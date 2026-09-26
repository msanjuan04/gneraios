/** Solo rutas relativas de esta app: evita redirecciones abiertas a otros dominios. */
export function safeNextPath(value: string | null | undefined): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  return value;
}

export const AUTH_NEXT_COOKIE = "auth_next";
