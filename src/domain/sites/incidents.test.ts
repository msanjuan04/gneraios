import { describe, expect, it } from "vitest";
import { currentStreak, findIncidents, incidentMinutes, nextStreak } from "./incidents";
import type { SiteCheck } from "./types";

const at = (minute: number) => new Date(Date.UTC(2026, 8, 26, 10, minute)).toISOString();
const ok = (minute: number): SiteCheck => ({ checkedAt: at(minute), ok: true, statusCode: 200, responseMs: 300, error: null, tlsExpiresAt: null });
const fail = (minute: number, error: SiteCheck["error"] = "timeout", statusCode: number | null = null): SiteCheck => ({
  checkedAt: at(minute),
  ok: false,
  statusCode,
  responseMs: null,
  error,
  tlsExpiresAt: null,
});

describe("findIncidents", () => {
  it("agrupa los fallos seguidos, de la caída más reciente a la más antigua, sin importar el orden de entrada", () => {
    const checks = [ok(0), fail(5), fail(10, "http", 503), ok(15), ok(20), fail(25), ok(30), fail(40, "dns"), fail(45, "dns")];
    expect(findIncidents([...checks].reverse())).toEqual([
      { startedAt: at(40), endedAt: null, failures: 2, error: "dns", statusCode: null },
      { startedAt: at(25), endedAt: at(30), failures: 1, error: "timeout", statusCode: null },
      { startedAt: at(5), endedAt: at(15), failures: 2, error: "http", statusCode: 503 },
    ]);
  });

  it("sin fallos no hay caídas", () => {
    expect(findIncidents([ok(0), ok(5)])).toEqual([]);
    expect(findIncidents([])).toEqual([]);
  });

  it("dura desde el primer fallo hasta la primera buena (o hasta ahora), como mínimo un minuto", () => {
    expect(incidentMinutes({ startedAt: at(5), endedAt: at(15) }, new Date(at(50)))).toBe(10);
    expect(incidentMinutes({ startedAt: at(40), endedAt: null }, new Date(at(52)))).toBe(12);
    expect(incidentMinutes({ startedAt: at(40), endedAt: at(40) }, new Date(at(52)))).toBe(1);
  });
});

describe("rachas", () => {
  it("la racha en curso son los fallos desde la última buena", () => {
    expect(currentStreak([ok(0), fail(5), fail(10)])).toEqual({ failures: 2, since: at(5) });
    expect(currentStreak([fail(10), ok(0), fail(5), ok(15)])).toEqual({ failures: 0, since: null });
    expect(currentStreak([fail(0), fail(5)])).toEqual({ failures: 2, since: at(0) });
    expect(currentStreak([])).toEqual({ failures: 0, since: null });
  });

  it("una comprobación nueva alarga la racha o la corta", () => {
    const first = nextStreak({ failures: 0, since: null }, fail(5));
    expect(first).toEqual({ failures: 1, since: at(5) });
    const second = nextStreak(first, fail(10));
    expect(second).toEqual({ failures: 2, since: at(5) });
    expect(nextStreak(second, ok(15))).toEqual({ failures: 0, since: null });
    // Una racha sin inicio conocido empieza en esta comprobación.
    expect(nextStreak({ failures: 3, since: null }, fail(20))).toEqual({ failures: 4, since: at(20) });
  });

  it("nextStreak encadenado da lo mismo que currentStreak", () => {
    const checks = [ok(0), fail(5), fail(10), ok(15), fail(20), fail(25), fail(30)];
    let streak = { failures: 0, since: null as string | null };
    for (const check of checks) streak = nextStreak(streak, check);
    expect(streak).toEqual(currentStreak(checks));
  });
});
