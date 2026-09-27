import { describe, expect, it } from "vitest";
import { classifyCheckError } from "./errors";
import { asCheckError } from "./types";

/** Como los errores de fetch (undici): "fetch failed" con la causa real dentro. */
function fetchFailed(cause: unknown): Error {
  return new TypeError("fetch failed", { cause });
}

function coded(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

describe("classifyCheckError", () => {
  it("el tiempo límite (AbortSignal.timeout o de conexión)", () => {
    expect(classifyCheckError(new DOMException("The operation was aborted due to timeout", "TimeoutError"))).toBe("timeout");
    expect(classifyCheckError(fetchFailed(coded("Connect Timeout Error", "UND_ERR_CONNECT_TIMEOUT")))).toBe("timeout");
  });

  it("DNS, conexión rechazada y cortada", () => {
    expect(classifyCheckError(fetchFailed(coded("getaddrinfo ENOTFOUND nope.example", "ENOTFOUND")))).toBe("dns");
    expect(classifyCheckError(fetchFailed(new AggregateError([coded("connect ECONNREFUSED ::1:443", "ECONNREFUSED")], "")))).toBe("refused");
    expect(classifyCheckError(fetchFailed(coded("other side closed", "UND_ERR_SOCKET")))).toBe("reset");
    expect(classifyCheckError(fetchFailed(new Error("socket hang up")))).toBe("reset");
  });

  it("certificados caducados o no válidos", () => {
    expect(classifyCheckError(fetchFailed(coded("certificate has expired", "CERT_HAS_EXPIRED")))).toBe("tls_expired");
    expect(classifyCheckError(fetchFailed(coded("self-signed certificate", "DEPTH_ZERO_SELF_SIGNED_CERT")))).toBe("tls_invalid");
    expect(classifyCheckError(fetchFailed(coded("Hostname/IP does not match", "ERR_TLS_CERT_ALTNAME_INVALID")))).toBe("tls_invalid");
    expect(classifyCheckError(fetchFailed(coded("wrong version number", "ERR_SSL_WRONG_VERSION_NUMBER")))).toBe("tls_invalid");
  });

  it("redirecciones sin fin y lo demás", () => {
    expect(classifyCheckError(fetchFailed(new Error("redirect count exceeded")))).toBe("redirects");
    expect(classifyCheckError(fetchFailed(new Error("algo raro")))).toBe("network");
    expect(classifyCheckError("texto")).toBe("network");
    expect(classifyCheckError(null)).toBe("network");
  });

  it("no se cuelga con causas circulares", () => {
    const a: Error & { cause?: unknown } = new Error("a");
    const b: Error & { cause?: unknown } = new Error("b", { cause: a });
    a.cause = b;
    expect(classifyCheckError(a)).toBe("network");
  });
});

describe("asCheckError", () => {
  it("una clave desconocida sigue siendo un fallo", () => {
    expect(asCheckError("timeout")).toBe("timeout");
    expect(asCheckError("algo_nuevo")).toBe("network");
    expect(asCheckError(null)).toBeNull();
    expect(asCheckError("")).toBeNull();
  });
});
