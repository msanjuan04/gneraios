// La URL de una web vigilada. Se escribe como sea ("clinicamarblau.com", "http://www.x.com/",
// "HTTPS://X.COM/Blog") y se guarda de una sola forma, así la misma web no se da de alta dos veces:
// https, host en minúsculas (los dominios con acentos, en punycode), sin puerto por defecto, sin la
// barra de la raíz y sin fragmento. La base de datos exige la misma forma (sites.url).

export const SITE_URL_MAX_LENGTH = 2048;

/** Gemela del CHECK de sites.url (supabase/migrations/20260926380000_webs.sql): un test comprueba la paridad. */
export const SITE_URL_PATTERN =
  /^https:\/\/([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?(:[0-9]{1,5})?([/?][^\s#]*)?$/;
const ROOT_WITH_SLASH = /^https:\/\/[^/?]+\/$/;

/** ¿Tiene ya la forma que se guarda? */
export function isNormalizedSiteUrl(value: string): boolean {
  return value.length <= SITE_URL_MAX_LENGTH && SITE_URL_PATTERN.test(value) && !ROOT_WITH_SLASH.test(value);
}

/**
 * Lo escrito → la URL que se guarda, o null si no es una web que se pueda vigilar. Sin protocolo se
 * entiende https; http se pasa a https (se vigila la web segura: si no la tiene, fallará y se verá).
 * Otros protocolos, usuarios y contraseñas en la URL, IPs y nombres sin dominio no valen.
 */
export function normalizeSiteUrl(input: string): string | null {
  let value = input.trim();
  if (value === "" || value.length > SITE_URL_MAX_LENGTH) return null;
  if (/^http:\/\//i.test(value)) value = `https://${value.slice("http://".length)}`;
  else if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = `https://${value.replace(/^\/+/, "")}`;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "") return null;
  const host = url.hostname.replace(/\.$/, "");
  const port = url.port === "" ? "" : `:${url.port}`;
  const path = url.pathname === "/" ? "" : url.pathname;
  const normalized = `https://${host}${port}${path}${url.search}`;
  return isNormalizedSiteUrl(normalized) ? normalized : null;
}

/** Host de la URL guardada ("https://www.x.com/es" → "www.x.com"). */
export function siteHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** Lo que se lee en las listas: sin "https://" ("https://www.x.com/es" → "www.x.com/es"). */
export function siteDisplayUrl(url: string): string {
  return url.replace(/^https:\/\//, "");
}

/** Nombre de una web: su etiqueta o, sin ella, lo que se lee de la URL. */
export function siteName(site: { label: string | null; url: string }): string {
  const label = site.label?.trim();
  return label ? label : siteDisplayUrl(site.url);
}

/** Tope de webs por pegado en el alta en bloque. */
export const BULK_MAX_SITES = 200;

export type ParsedSiteList = {
  /** Las URLs ya normalizadas, sin repetir, en el orden en que se pegaron. */
  urls: string[];
  /** Lo que no es una web válida, tal cual se escribió. */
  invalid: string[];
  /** Cuántas líneas repetían una web ya pegada más arriba. */
  repeated: number;
};

/**
 * Varias webs pegadas de golpe: una por línea (también valen comas, puntos y comas o espacios).
 * Las líneas vacías y las que empiezan por "#" se ignoran.
 */
export function parseSiteList(text: string): ParsedSiteList {
  const result: ParsedSiteList = { urls: [], invalid: [], repeated: 0 };
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().startsWith("#")) continue;
    for (const token of line.split(/[\s,;]+/)) {
      if (token === "") continue;
      const url = normalizeSiteUrl(token);
      if (!url) {
        result.invalid.push(token);
      } else if (seen.has(url)) {
        result.repeated += 1;
      } else {
        seen.add(url);
        result.urls.push(url);
      }
    }
  }
  return result;
}
