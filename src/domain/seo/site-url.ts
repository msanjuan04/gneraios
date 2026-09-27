// Search Console identifica cada web por su propiedad EXACTA: "sc-domain:gnerai.com" (dominio,
// cubre todos los subdominios y protocolos) o un prefijo de URL con barra final
// ("https://www.gnerai.com/"). Lo que se escribe a mano rara vez coincide ("https://gnerai.com")
// y la API responde que no hay permiso. Esto resuelve lo escrito contra las propiedades reales.

/** Host sin protocolo, ruta ni puerto, en minúsculas ("https://www.Gnerai.com/blog" → "www.gnerai.com"). */
function hostOf(input: string): string | null {
  const value = input.trim();
  if (value.startsWith("sc-domain:")) return value.slice("sc-domain:".length).toLowerCase() || null;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return url.hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

/**
 * La propiedad de Search Console que corresponde a `input`, o null si la cuenta no tiene ninguna.
 * Orden de preferencia: la exacta; la de dominio (con y sin "www."); el prefijo https y luego
 * http, con y sin "www.", siempre con barra final.
 */
export function resolveSearchConsoleSite(input: string, siteUrls: readonly string[]): string | null {
  const available = new Set(siteUrls);
  const trimmed = input.trim();
  if (available.has(trimmed)) return trimmed;
  const host = hostOf(trimmed);
  if (!host) return null;
  const bare = host.replace(/^www\./, "");
  const candidates = [
    `sc-domain:${bare}`,
    `sc-domain:${host}`,
    `https://${host}/`,
    `https://www.${bare}/`,
    `https://${bare}/`,
    `http://${host}/`,
    `http://www.${bare}/`,
    `http://${bare}/`,
  ];
  return candidates.find((candidate) => available.has(candidate)) ?? null;
}

/** Host "limpio" de una propiedad o de una web ("sc-domain:gnerai.com" → "gnerai.com"; sin "www."). */
export function siteHost(input: string): string | null {
  return hostOf(input)?.replace(/^www\./, "") ?? null;
}

/**
 * El cliente cuya web coincide con la propiedad de Search Console (mismo dominio, con o sin
 * "www."), o null. Si varios coinciden, ninguno: mejor que lo elija una persona.
 */
export function suggestClientForSite(
  siteUrl: string,
  clients: ReadonlyArray<{ id: string; website: string | null }>,
): string | null {
  const host = siteHost(siteUrl);
  if (!host) return null;
  const matches = clients.filter((c) => c.website && siteHost(c.website) === host);
  return matches.length === 1 ? matches[0]!.id : null;
}
