/**
 * Datos técnicos de la evidencia de una aceptación online: de dónde llegó la petición y con qué
 * navegador. Se guardan tal cual llegan (recortados), sin interpretarlos: la IP «real» es la que
 * pone el proxy de la plataforma (DigitalOcean: do-connecting-ip) y, si no, la primera de
 * X-Forwarded-For; la cadena completa se guarda aparte por si hay que reconstruirla.
 */

export type HeaderGetter = (name: string) => string | null | undefined;

export type RequestEvidence = { ipAddress: string | null; forwardedFor: string | null; userAgent: string | null };

const MAX_IP = 64;
const MAX_CHAIN = 500;
const MAX_UA = 500;

/** Sin caracteres de control y con un máximo de longitud. */
export function cleanHeader(value: string | null | undefined, max: number): string | null {
  if (!value) return null;
  const text = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return text ? text.slice(0, max) : null;
}

const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6 = /^[0-9a-f:.]+$/i;

/** "203.0.113.7", "[2001:db8::1]:443" → "2001:db8::1"; lo que no parece una IP, null. */
export function normalizeIp(value: string | null | undefined): string | null {
  let text = value?.trim();
  if (!text) return null;
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(text);
  if (bracketed) text = bracketed[1]!;
  else if (/^(\d{1,3}\.){3}\d{1,3}:\d+$/.test(text)) text = text.replace(/:\d+$/, "");
  if (IPV4.test(text) && text.split(".").every((part) => Number(part) <= 255)) return text;
  if (text.includes(":") && IPV6.test(text)) return text.slice(0, MAX_IP).toLowerCase();
  return null;
}

export function requestEvidence(get: HeaderGetter): RequestEvidence {
  const chain = cleanHeader(get("x-forwarded-for"), MAX_CHAIN);
  const first = chain?.split(",")[0];
  const ipAddress = normalizeIp(get("do-connecting-ip")) ?? normalizeIp(get("x-real-ip")) ?? normalizeIp(first);
  return { ipAddress, forwardedFor: chain, userAgent: cleanHeader(get("user-agent"), MAX_UA) };
}

/** Email normalizado como lo guarda la evidencia (minúsculas y sin espacios alrededor). */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** Espacios repetidos fuera: "  Laura   Puig " → "Laura Puig". */
export function normalizeName(value: string): string {
  return value.normalize("NFC").replace(/\s+/g, " ").trim();
}
