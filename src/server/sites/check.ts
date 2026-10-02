// Sin "server-only": lo usan también scripts (tsx), no solo Next. Solo se importa desde código de
// servidor (usa node:dns, node:http(s) y node:tls).
import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { connect } from "node:tls";
import { classifyCheckError, isLoopbackAddress, isPublicAddress, parseCertificateDate, type SiteCheck } from "@/domain/sites";

/**
 * Comprobar una web: pedirla (siguiendo redirecciones) con un tiempo límite, medir lo que tarda en
 * responder y, a la vez, leer hasta cuándo vale su certificado SSL. Lo usan el cron (cada 5 minutos)
 * y «Comprobar ahora».
 *
 * El monitor sale a Internet desde el servidor, así que solo conecta a direcciones públicas: antes
 * de cada salto se resuelve el dominio, se comprueba que TODAS sus direcciones son públicas y se
 * conecta a la dirección ya comprobada (no se vuelve a resolver: nada de cambiar el DNS entre
 * medias). Un dominio que apunte a la red interna, a loopback o a la dirección de metadatos de la
 * nube queda como error «blocked», también si llega por una redirección.
 */

/** Tiempo límite de cada comprobación (la petición y la lectura del certificado van a la vez). */
export const CHECK_TIMEOUT_MS = 10_000;
/** Webs que se comprueban a la vez. */
export const CHECK_CONCURRENCY = 5;
/** Redirecciones que se siguen antes de darlo por bucle. */
const MAX_REDIRECTS = 10;

const USER_AGENT = "GNERAI-OS-Monitor/1.0 (+https://gnerai.com)";

type HttpOutcome = Pick<SiteCheck, "ok" | "statusCode" | "responseMs" | "error">;

export type CheckOptions = {
  timeoutMs?: number;
  /** Solo para tests: deja conectar a loopback (un servidor local). Nunca en la app. */
  allowLoopback?: boolean;
};

/** El destino no es una dirección pública: no se conecta. */
export class BlockedAddressError extends Error {
  override readonly name = "BlockedAddressError";
}

type Address = { address: string; family: 4 | 6 };

/** Sin corchetes de IPv6 ni el punto final de un FQDN. */
const bareHostname = (url: URL) => url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");

/**
 * La dirección a la que conectar para ese host. Un host literal tiene que ser público; un dominio,
 * todas sus direcciones (A y AAAA): si alguna no lo es, se bloquea entero.
 */
export async function resolvePublicAddress(host: string, allowLoopback = false): Promise<Address> {
  const literal = isIP(host);
  const candidates: Address[] = literal
    ? [{ address: host, family: literal as 4 | 6 }]
    : (await lookup(host, { all: true })).map((r) => ({ address: r.address, family: r.family as 4 | 6 }));
  if (candidates.length === 0) {
    throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: "ENOTFOUND" });
  }
  if (candidates.some((c) => !(isPublicAddress(c.address) || (allowLoopback && isLoopbackAddress(c.address))))) {
    throw new BlockedAddressError(`${host} apunta a una dirección que no es pública`);
  }
  return candidates[0]!;
}

/** Un `lookup` que siempre devuelve la dirección ya comprobada: la conexión no vuelve a resolver el DNS. */
function pinnedLookup(target: Address): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) callback(null, [{ address: target.address, family: target.family }]);
    else callback(null, target.address, target.family);
  };
}

/** Una petición GET a una URL, conectando a la dirección ya comprobada; devuelve el código y la redirección. */
function requestOnce(url: URL, target: Address, timeoutMs: number): Promise<{ statusCode: number; location: string | null }> {
  return new Promise((resolve, reject) => {
    const secure = url.protocol === "https:";
    const hostname = bareHostname(url);
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const req = (secure ? httpsRequest : httpRequest)(
      {
        host: hostname,
        port: Number(url.port || (secure ? 443 : 80)),
        path: `${url.pathname}${url.search}` || "/",
        method: "GET",
        headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
        // SNI y cabecera Host con el nombre; la conexión, a la dirección comprobada.
        ...(secure && isIP(hostname) === 0 ? { servername: hostname } : {}),
        lookup: pinnedLookup(target),
      },
      (res) => {
        const statusCode = res.statusCode ?? 0;
        const location = typeof res.headers.location === "string" ? res.headers.location : null;
        // Solo interesa que responda: el cuerpo se descarta sin leerlo.
        res.resume();
        finish(() => {
          req.destroy();
          resolve({ statusCode, location });
        });
      },
    );
    const timer = setTimeout(() => finish(() => {
      req.destroy();
      reject(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }));
    }), timeoutMs);
    req.on("error", (error) => finish(() => reject(error)));
    req.end();
  });
}

/** Pide la web y mide hasta que llega la respuesta (sin descargar el cuerpo). Un código ≥ 400 es un fallo. */
export async function probeHttp(url: string, timeoutMs = CHECK_TIMEOUT_MS, opts: Pick<CheckOptions, "allowLoopback"> = {}): Promise<HttpOutcome> {
  const started = performance.now();
  const deadline = started + timeoutMs;
  try {
    let current = new URL(url);
    for (let hop = 0; ; hop += 1) {
      if (hop > MAX_REDIRECTS) throw Object.assign(new Error("too many redirects"), { code: "ERR_TOO_MANY_REDIRECTS" });
      if (current.protocol !== "http:" && current.protocol !== "https:") {
        throw new BlockedAddressError(`${current.protocol} no es http(s)`);
      }
      const target = await resolvePublicAddress(bareHostname(current), opts.allowLoopback);
      const remaining = deadline - performance.now();
      if (remaining <= 0) throw Object.assign(new Error("timeout"), { code: "ETIMEDOUT" });
      const { statusCode, location } = await requestOnce(current, target, remaining);
      if (statusCode >= 300 && statusCode < 400 && location) {
        current = new URL(location, current);
        continue;
      }
      const responseMs = Math.round(performance.now() - started);
      const ok = statusCode < 400;
      return { ok, statusCode, responseMs, error: ok ? null : "http" };
    }
  } catch (error) {
    return { ok: false, statusCode: null, responseMs: null, error: classifyCheckError(error) };
  }
}

/**
 * Hasta cuándo vale el certificado que presenta el servidor (ISO), aunque no sea válido (caducado,
 * autofirmado…: eso ya lo dice la petición). null si no se puede leer (sin HTTPS, sin respuesta,
 * destino no público).
 */
export async function readCertificateExpiry(host: string, port = 443, timeoutMs = CHECK_TIMEOUT_MS, opts: Pick<CheckOptions, "allowLoopback"> = {}): Promise<string | null> {
  let target: Address;
  try {
    target = await resolvePublicAddress(host, opts.allowLoopback);
  } catch {
    return null;
  }
  return new Promise((resolve) => {
    let settled = false;
    const socket = connect({
      host: target.address,
      port,
      // SNI: sin él, un servidor con varias webs enseña el certificado que no es. No vale para IPs.
      servername: isIP(host) === 0 ? host : undefined,
      rejectUnauthorized: false,
      ALPNProtocols: ["http/1.1"],
    });
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs, () => finish(null));
    socket.once("secureConnect", () => {
      try {
        finish(parseCertificateDate(socket.getPeerCertificate()?.valid_to));
      } catch {
        finish(null);
      }
    });
    socket.once("error", () => finish(null));
    socket.once("close", () => finish(null));
  });
}

/** Una comprobación completa de una web (URL ya normalizada: https). */
export async function checkSite(url: string, opts: CheckOptions = {}): Promise<SiteCheck> {
  const timeoutMs = opts.timeoutMs ?? CHECK_TIMEOUT_MS;
  const checkedAt = new Date().toISOString();
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return { checkedAt, ok: false, statusCode: null, responseMs: null, error: "network", tlsExpiresAt: null };
  }
  const [http, tlsExpiresAt] = await Promise.all([
    probeHttp(target.toString(), timeoutMs, opts),
    target.protocol === "https:"
      ? readCertificateExpiry(bareHostname(target), Number(target.port || 443), timeoutMs, opts)
      : Promise.resolve(null),
  ]);
  return { checkedAt, ...http, tlsExpiresAt };
}

/** `fn` sobre cada elemento, como mucho `limit` a la vez; los resultados, en el mismo orden. */
export async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index]!, index);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}
