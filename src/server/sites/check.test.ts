import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mapWithConcurrency, probeHttp, readCertificateExpiry } from "./check";

// Un servidor HTTP local que responde lo que pide cada ruta. La comprobación real va por https,
// pero pedir, seguir redirecciones, cortar por tiempo y clasificar los fallos es lo mismo.
let server: Server;
let base: string;
let port: number;

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
    const result = await probeHttp(`${base}/ok`);
    expect(result).toMatchObject({ ok: true, statusCode: 200, error: null });
    expect(result.responseMs).toBeGreaterThanOrEqual(0);
  });

  it("un código de error es un fallo 'http' con su código", async () => {
    expect(await probeHttp(`${base}/down`)).toMatchObject({ ok: false, statusCode: 503, error: "http" });
    expect(await probeHttp(`${base}/nada`)).toMatchObject({ ok: false, statusCode: 404, error: "http" });
  });

  it("sigue las redirecciones; un bucle es un fallo 'redirects'", async () => {
    expect(await probeHttp(`${base}/moved`)).toMatchObject({ ok: true, statusCode: 200 });
    expect(await probeHttp(`${base}/loop`)).toEqual({ ok: false, statusCode: null, responseMs: null, error: "redirects" });
  });

  it("corta al llegar al tiempo límite", async () => {
    expect(await probeHttp(`${base}/slow`, 150)).toEqual({ ok: false, statusCode: null, responseMs: null, error: "timeout" });
  });

  it("un puerto cerrado es una conexión rechazada", async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
    const closedPort = (closed.address() as AddressInfo).port;
    await new Promise((resolve) => closed.close(resolve));
    expect(await probeHttp(`http://127.0.0.1:${closedPort}/`)).toMatchObject({ ok: false, error: "refused" });
  });
});

describe("readCertificateExpiry", () => {
  it("sin TLS (o sin nadie al otro lado) no hay certificado que leer", async () => {
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
