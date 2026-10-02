import type { CheckError } from "./types";

// Qué ha fallado al pedir una web, a partir del error de Node (fetch de undici o node:tls). La
// causa real suele venir envuelta ("fetch failed" → cause → código), a veces en un AggregateError
// (IPv4 e IPv6 a la vez). Se recorre la cadena y gana el primer código conocido.

const TIMEOUT = new Set(["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"]);
const DNS = new Set(["ENOTFOUND", "EAI_AGAIN", "EAI_NODATA", "EAI_NONAME", "EAI_FAIL"]);
const REFUSED = new Set(["ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH"]);
const RESET = new Set(["ECONNRESET", "EPIPE", "ECONNABORTED", "UND_ERR_SOCKET", "UND_ERR_CLOSED"]);
const TLS_EXPIRED = new Set(["CERT_HAS_EXPIRED"]);
const TLS_INVALID = new Set([
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "CERT_NOT_YET_VALID",
  "CERT_UNTRUSTED",
  "CERT_REVOKED",
  "CERT_SIGNATURE_FAILURE",
  "HOSTNAME_MISMATCH",
]);

type ErrorLike = { name?: unknown; code?: unknown; message?: unknown; cause?: unknown; errors?: unknown };

function isErrorLike(value: unknown): value is ErrorLike {
  return typeof value === "object" && value !== null;
}

/** El error y todo lo que lleva dentro (cause, errors), como mucho unos pocos niveles. */
function chain(error: unknown): ErrorLike[] {
  const out: ErrorLike[] = [];
  const queue: unknown[] = [error];
  while (queue.length > 0 && out.length < 12) {
    const next = queue.shift();
    if (!isErrorLike(next)) continue;
    out.push(next);
    if (next.cause !== undefined) queue.push(next.cause);
    if (Array.isArray(next.errors)) queue.push(...next.errors);
  }
  return out;
}

/** Clave del fallo (site_checks.error) para un error lanzado al pedir la web. */
export function classifyCheckError(error: unknown): CheckError {
  const links = chain(error);
  for (const link of links) {
    const name = typeof link.name === "string" ? link.name : "";
    const code = typeof link.code === "string" ? link.code : "";
    const message = typeof link.message === "string" ? link.message.toLowerCase() : "";
    if (name === "TimeoutError" || name === "AbortError" || TIMEOUT.has(code)) return "timeout";
    // El dominio (o una redirección) apunta a una dirección que no es pública: no se conecta.
    if (name === "BlockedAddressError") return "blocked";
    if (DNS.has(code)) return "dns";
    if (REFUSED.has(code)) return "refused";
    if (TLS_EXPIRED.has(code)) return "tls_expired";
    if (TLS_INVALID.has(code) || code.startsWith("ERR_SSL_") || code.startsWith("ERR_TLS_")) return "tls_invalid";
    if (RESET.has(code) || message.includes("other side closed") || message.includes("socket hang up")) return "reset";
    if (message.includes("redirect")) return "redirects";
  }
  return "network";
}
