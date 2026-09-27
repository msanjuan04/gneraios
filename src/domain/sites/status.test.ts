import { describe, expect, it } from "vitest";
import { deriveSiteStatus, hasProblem, isDownConfirmed, STALE_AFTER_MS } from "./status";

const now = new Date("2026-09-26T10:00:00Z");
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000).toISOString();
const opts = { slowMs: 3000, now };

describe("deriveSiteStatus", () => {
  it("en pausa manda sobre todo lo demás", () => {
    expect(deriveSiteStatus({ isActive: false, lastCheck: { checkedAt: minutesAgo(1), ok: false, responseMs: null } }, opts)).toBe("paused");
    expect(deriveSiteStatus({ isActive: false, lastCheck: null }, opts)).toBe("paused");
  });

  it("sin comprobaciones, o sin ninguna reciente, no se sabe", () => {
    expect(deriveSiteStatus({ isActive: true, lastCheck: null }, opts)).toBe("unknown");
    expect(deriveSiteStatus({ isActive: true, lastCheck: { checkedAt: minutesAgo(31), ok: true, responseMs: 200 } }, opts)).toBe("unknown");
    expect(deriveSiteStatus({ isActive: true, lastCheck: { checkedAt: minutesAgo(29), ok: true, responseMs: 200 } }, opts)).toBe("up");
    expect(deriveSiteStatus({ isActive: true, lastCheck: { checkedAt: "no es una fecha", ok: true, responseMs: 200 } }, opts)).toBe("unknown");
    expect(STALE_AFTER_MS).toBe(30 * 60_000);
    expect(
      deriveSiteStatus({ isActive: true, lastCheck: { checkedAt: minutesAgo(10), ok: true, responseMs: 200 } }, { ...opts, staleAfterMs: 5 * 60_000 }),
    ).toBe("unknown");
  });

  it("caída si la última falló; lenta desde el umbral; si no, funciona", () => {
    expect(deriveSiteStatus({ isActive: true, lastCheck: { checkedAt: minutesAgo(2), ok: false, responseMs: null } }, opts)).toBe("down");
    expect(deriveSiteStatus({ isActive: true, lastCheck: { checkedAt: minutesAgo(2), ok: true, responseMs: 3000 } }, opts)).toBe("slow");
    expect(deriveSiteStatus({ isActive: true, lastCheck: { checkedAt: minutesAgo(2), ok: true, responseMs: 2999 } }, opts)).toBe("up");
    expect(deriveSiteStatus({ isActive: true, lastCheck: { checkedAt: minutesAgo(2), ok: true, responseMs: null } }, opts)).toBe("up");
  });
});

describe("isDownConfirmed y hasProblem", () => {
  it("la caída se confirma con los fallos seguidos de la org", () => {
    expect(isDownConfirmed({ failures: 1, since: minutesAgo(5) }, 2)).toBe(false);
    expect(isDownConfirmed({ failures: 2, since: minutesAgo(10) }, 2)).toBe(true);
    expect(isDownConfirmed({ failures: 0, since: null }, 0)).toBe(false);
  });

  it("pide atención lo caído, lo lento y lo que caduca; no lo pausado ni lo desconocido", () => {
    expect(hasProblem({ status: "down", ssl: "ok", domain: null })).toBe(true);
    expect(hasProblem({ status: "slow", ssl: null, domain: null })).toBe(true);
    expect(hasProblem({ status: "up", ssl: "warning", domain: null })).toBe(true);
    expect(hasProblem({ status: "up", ssl: "ok", domain: "expired" })).toBe(true);
    expect(hasProblem({ status: "up", ssl: "ok", domain: "ok" })).toBe(false);
    expect(hasProblem({ status: "unknown", ssl: null, domain: null })).toBe(false);
    expect(hasProblem({ status: "paused", ssl: "expired", domain: "expired" })).toBe(false);
  });
});
