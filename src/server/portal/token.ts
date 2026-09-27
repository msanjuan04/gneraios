// Sin "server-only": lo usan también los tests de base de datos. Solo tiene sentido en el
// servidor de todas formas (node:crypto).
import { createHash, randomBytes } from "node:crypto";

/**
 * Tokens de los enlaces públicos (ARCHITECTURE.md §5): 32 bytes aleatorios en base64url, que
 * solo existen en el enlace que se comparte. La base de datos guarda su SHA-256 en hex y nunca el
 * token: quien lea la tabla (o una copia de seguridad) no puede reconstruir ningún enlace.
 */

export const PORTAL_TOKEN_BYTES = 32;

/** 32 bytes en base64url sin relleno: 43 caracteres de [A-Za-z0-9_-]. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** ¿Tiene forma de token? Descarta lo que no puede serlo sin tocar la base de datos. */
export function isPortalToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}

/** SHA-256 en hex (64 caracteres), el formato de `public_links.token_hash`. */
export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Huella de un token: lo único que se guarda y lo único con lo que se busca un enlace. */
export function hashPortalToken(token: string): string {
  if (!isPortalToken(token)) throw new Error("Token de enlace mal formado");
  return sha256Hex(token);
}

/** Token nuevo y su huella. El token se enseña una vez (al crear el enlace) y no se guarda. */
export function newPortalToken(): { token: string; hash: string } {
  const token = randomBytes(PORTAL_TOKEN_BYTES).toString("base64url");
  return { token, hash: sha256Hex(token) };
}
