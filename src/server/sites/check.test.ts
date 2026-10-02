import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mapWithConcurrency, probeHttp, readCertificateExpiry, resolvePublicAddress } from "./check";

// Un servidor HTTP local que responde lo que pide cada ruta. La comprobación real va por https,
// pero pedir, seguir redirecciones, cortar por tiempo y clasificar los fallos es lo mismo.
// El servidor vive en 127.0.0.1, que el monitor bloquea: los tests que lo usan lo permiten a propósito.
let server: Server;
let base: string;
let port: number;
const local = { allowLoopback: true };

beforeAll(async () => {
  server = createServer((req, res) => {
    switch (req.url) {
      case "/ok":
        res.writeHead(200, { "content-type": "text/html" }).end("<h1>hola</h1>");
        return;
      case "/down":
        res.writeHead(503).end("mantenimiento");
        return;
      case "/moved":
        res.writeHead(301, { location: "/ok" }).end();
        return;
      case "/loop":
        res.writeHead(302, { location: "/loop" }).end();
        return;
      case "/slow":
        setTimeout(() => res.writeHead(200).end("tarde"), 1_000);
        return;
      default:
        res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

describe("probeHttp", () => {
  it("responde bien: el código y lo que tardó", async () => {
    const result = await probeHttp(`${base}/ok`, undefined, local);
    expect(result).toMatchObject({ ok: true, statusCode: 200, error: null });
    expect(result.responseMs).toBeGreaterThanOrEqual(0);
  });

  it("un código de error es un fallo 'http' con su código", async () => {
    expect(await probeHttp(`${base}/down`, undefined, local)).toMatchObject({ ok: false, statusCode: 503, error: "http" });
    expect(await probeHttp(`${base}/nada`, undefined, local)).toMatchObject({ ok: false, statusCode: 404, error: "http" });
  });

  it("sigue las redirecciones; un bucle es un fallo 'redirects'", async () => {
    expect(await probeHttp(`${base}/moved`, undefined, local)).toMatchObject({ ok: true, statusCode: 200 });
    expect(await probeHttp(`${base}/loop`, undefined, local)).toEqual({ ok: false, statusCode: null, responseMs: null, error: "redirects" });
  });

  it("corta al llegar al tiempo límite", async () => {
    expect(await probeHttp(`${base}/slow`, 150, local)).toEqual({ ok: false, statusCode: null, responseMs: null, error: "timeout" });
  });

  it("un puerto cerrado es una conexión rechazada", async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
    const closedPort = (closed.address() as AddressInfo).port;
    await new Promise((resolve) => closed.close(resolve));
    expect(await probeHttp(`http://127.0.0.1:${closedPort}/`, undefined, local)).toMatchObject({ ok: false, error: "refused" });
  });
});

describe("solo destinos públicos (auditoría A04)", () => {
  it("no conecta a loopback, red privada ni metadatos de la nube: fallo 'blocked' sin tocar la red", async () => {
    const started = performance.now();
    expect(await probeHttp(`${base}/ok`)).toEqual({ ok: false, statusCode: null, responseMs: null, error: "blocked" });
    expect(await probeHttp("http://169.254.169.254/latest/meta-data/", 500)).toMatchObject({ error: "blocked" });
    expect(await probeHttp("http://10.0.0.1/", 500)).toMatchObject({ error: "blocked" });
    expect(await probeHttp("http://[::1]:80/", 500)).toMatchObject({ error: "blocked" });
    expect(performance.now() - started).toBeLessThan(400);
  });

  it("tampoco siguiendo una redirección hacia dentro", async () => {
    const trap = createServer((_req, res) => res.writeHead(302, { location: "http://169.254.169.254/" }).end());
    await new Promise<void>((resolve) => trap.listen(0, "127.0.0.1", resolve));
    const trapPort = (trap.address() as AddressInfo).port;
    try {
      // El primer salto (loopback) se permite en el test; el segundo apunta a metadatos y se bloquea sin conectar.
      const started = performance.now();
      expect(await probeHttp(`http://127.0.0.1:${trapPort}/`, 2_000, local)).toEqual({ ok: false, statusCode: null, responseMs: null, error: "blocked" });
      expect(performance.now() - started).toBeLessThan(1_000);
    } finally {
      trap.closeAllConnections();
      await new Promise((resolve) => trap.close(resolve));
    }
    expect(await probeHttp("ftp://example.com/", 500)).toMatchObject({ error: "blocked" });
  });

  it("un dominio real se resuelve a una dirección pública; un literal privado no", async () => {
    await expect(resolvePublicAddress("127.0.0.1")).rejects.toMatchObject({ name: "BlockedAddressError" });
    await expect(resolvePublicAddress("192.168.0.1")).rejects.toMatchObject({ name: "BlockedAddressError" });
    expect(await resolvePublicAddress("127.0.0.1", true)).toEqual({ address: "127.0.0.1", family: 4 });
    expect(await resolvePublicAddress("93.184.216.34")).toEqual({ address: "93.184.216.34", family: 4 });
  });
});

describe("readCertificateExpiry", () => {
  it("sin TLS (o sin nadie al otro lado) no hay certificado que leer", async () => {
    expect(await readCertificateExpiry("127.0.0.1", port, 2_000, local)).toBeNull();
  });

  it("un destino no público no se conecta", async () => {
    expect(await readCertificateExpiry("127.0.0.1", port, 2_000)).toBeNull();
  });
});

describe("mapWithConcurrency", () => {
  it("respeta el límite y el orden", async () => {
    let running = 0;
    let peak = 0;
    const results = await mapWithConcurrency([5, 1, 4, 2, 3, 0, 6], 3, async (n, i) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, n * 3));
      running -= 1;
      return `${i}:${n}`;
    });
    expect(results).toEqual(["0:5", "1:1", "2:4", "3:2", "4:3", "5:0", "6:6"]);
    expect(peak).toBe(3);
    expect(await mapWithConcurrency([], 5, async () => 1)).toEqual([]);
  });
});
