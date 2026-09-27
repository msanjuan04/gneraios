// Sin "server-only": lo usan también scripts (tsx), no solo Next. Solo se importa desde código de
// servidor (usa node:tls).
import { isIP } from "node:net";
import { connect } from "node:tls";
import { classifyCheckError, parseCertificateDate, type SiteCheck } from "@/domain/sites";

/**
 * Comprobar una web: pedirla (siguiendo redirecciones) con un tiempo límite, medir lo que tarda en
 * responder y, a la vez, leer hasta cuándo vale su certificado SSL. Lo usan el cron (cada 5 minutos)
 * y «Comprobar ahora».
 */

/** Tiempo límite de cada comprobación (la petición y la lectura del certificado van a la vez). */
export const CHECK_TIMEOUT_MS = 10_000;
/** Webs que se comprueban a la vez. */
export const CHECK_CONCURRENCY = 5;

const USER_AGENT = "GNERAI-OS-Monitor/1.0 (+https://gnerai.com)";

type HttpOutcome = Pick<SiteCheck, "ok" | "statusCode" | "responseMs" | "error">;

/** Pide la web y mide hasta que llega la respuesta (sin descargar el cuerpo). Un código ≥ 400 es un fallo. */
export async function probeHttp(url: string, timeoutMs = CHECK_TIMEOUT_MS): Promise<HttpOutcome> {
  const started = performance.now();
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
    });
    const responseMs = Math.round(performance.now() - started);
    // Solo interesa que responda: el cuerpo se descarta sin leerlo.
    await response.body?.cancel().catch(() => undefined);
    const ok = response.status < 400;
    return { ok, statusCode: response.status, responseMs, error: ok ? null : "http" };
  } catch (error) {
    return { ok: false, statusCode: null, responseMs: null, error: classifyCheckError(error) };
  }
}

/**
 * Hasta cuándo vale el certificado que presenta el servidor (ISO), aunque no sea válido (caducado,
 * autofirmado…: eso ya lo dice la petición). null si no se puede leer (sin HTTPS, sin respuesta).
 */
export function readCertificateExpiry(host: string, port = 443, timeoutMs = CHECK_TIMEOUT_MS): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const socket = connect({
      host,
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
export async function checkSite(url: string, opts: { timeoutMs?: number } = {}): Promise<SiteCheck> {
  const timeoutMs = opts.timeoutMs ?? CHECK_TIMEOUT_MS;
  const checkedAt = new Date().toISOString();
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return { checkedAt, ok: false, statusCode: null, responseMs: null, error: "network", tlsExpiresAt: null };
  }
  const [http, tlsExpiresAt] = await Promise.all([
    probeHttp(target.toString(), timeoutMs),
    target.protocol === "https:" ? readCertificateExpiry(target.hostname, Number(target.port || 443), timeoutMs) : Promise.resolve(null),
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
