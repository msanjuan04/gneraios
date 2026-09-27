import { describe, expect, it } from "vitest";
import { type AlertInput, detectSiteAlerts, DOWN_ALERT_GRACE_CHECKS, type SiteAlert } from "./alerts";
import { nextStreak } from "./incidents";
import type { FailureStreak, SiteCheck } from "./types";

const site = { id: "site-1", name: "Clínica Mar Blau" };
const thresholds = { sslWarnDays: 14, domainWarnDays: 30, slowMs: 3000, downAfterFailures: 2 };
const base = new Date("2026-09-26T10:00:00Z");
const at = (minute: number) => new Date(base.getTime() + minute * 60_000).toISOString();
const ok = (minute: number, tlsExpiresAt: string | null = "2027-01-01T00:00:00Z"): SiteCheck => ({
  checkedAt: at(minute),
  ok: true,
  statusCode: 200,
  responseMs: 420,
  error: null,
  tlsExpiresAt,
});
const fail = (minute: number, error: SiteCheck["error"] = "http", statusCode: number | null = 503): SiteCheck => ({
  checkedAt: at(minute),
  ok: false,
  statusCode,
  responseMs: null,
  error,
  tlsExpiresAt: null,
});

function input(previous: FailureStreak, check: SiteCheck, extra: Partial<AlertInput> = {}): AlertInput {
  return {
    site,
    previous,
    check,
    domainExpiresOn: null,
    thresholds,
    now: new Date(check.checkedAt),
    timeZone: "Europe/Madrid",
    today: "2026-09-26",
    ...extra,
  };
}

/** Pasa una serie de comprobaciones como lo haría el cron y devuelve los avisos, sin repetir claves. */
function run(checks: SiteCheck[], extra: Partial<AlertInput> = {}): SiteAlert[] {
  const sent = new Map<string, SiteAlert>();
  let streak: FailureStreak = { failures: 0, since: null };
  for (const check of checks) {
    for (const alert of detectSiteAlerts(input(streak, check, extra))) if (!sent.has(alert.key)) sent.set(alert.key, alert);
    streak = nextStreak(streak, check);
  }
  return [...sent.values()];
}

describe("caídas y vueltas", () => {
  it("un fallo suelto no avisa", () => {
    expect(run([ok(0), fail(5), ok(10), ok(15)])).toEqual([]);
  });

  it("al segundo fallo seguido avisa una sola vez, y al volver avisa con lo que duró", () => {
    const alerts = run([ok(0), fail(5), fail(10), fail(15), fail(20), fail(25), ok(30), ok(35)]);
    expect(alerts).toEqual([
      { kind: "site_down", key: `site_down:site-1:${at(5)}`, params: { site: site.name, error: "http", status: 503 } },
      { kind: "site_up", key: `site_up:site-1:${at(5)}`, params: { site: site.name, minutes: 25 } },
    ]);
  });

  it("sin código HTTP, el estado va a 0 y el fallo dice qué fue", () => {
    const [down] = detectSiteAlerts(input({ failures: 1, since: at(0) }, fail(5, "timeout", null)));
    expect(down).toMatchObject({ kind: "site_down", params: { error: "timeout", status: 0 } });
  });

  it("el umbral es el de la org (1 = al primer fallo)", () => {
    const alerts = run([ok(0), fail(5), ok(10)], { thresholds: { ...thresholds, downAfterFailures: 1 } });
    expect(alerts.map((a) => a.kind)).toEqual(["site_down", "site_up"]);
  });

  it("volver después de una caída sin confirmar no avisa", () => {
    expect(detectSiteAlerts(input({ failures: 1, since: at(0) }, ok(5)))).toEqual([]);
  });

  it("la misma decisión da la misma clave aunque el instante venga con otro formato (Postgres o JS)", () => {
    const fromDb = detectSiteAlerts(input({ failures: 1, since: "2026-09-26 10:00:00+00" }, fail(5)));
    const fromJs = detectSiteAlerts(input({ failures: 1, since: "2026-09-26T10:00:00.000Z" }, fail(5)));
    expect(fromDb[0]!.key).toBe(fromJs[0]!.key);
    expect(fromDb[0]!.key).toBe("site_down:site-1:2026-09-26T10:00:00.000Z");
  });

  it("si se pasa el umbral sin avisar (dos comprobaciones a la vez), aún avisa unas cuantas comprobaciones; después ya no", () => {
    const late = (failures: number) => detectSiteAlerts(input({ failures, since: at(0) }, fail(60)));
    expect(late(2)).toHaveLength(1);
    expect(late(1 + DOWN_ALERT_GRACE_CHECKS)).toHaveLength(1);
    expect(late(2 + DOWN_ALERT_GRACE_CHECKS)).toHaveLength(0);
    // Una web caída semanas: la poda mueve el inicio de la racha, pero no vuelve a avisar.
    expect(detectSiteAlerts(input({ failures: 8000, since: at(5) }, fail(60)))).toEqual([]);
  });

  it("la vuelta de una caída larga se avisa aunque la racha sea enorme", () => {
    const [up] = detectSiteAlerts(input({ failures: 8000, since: at(0) }, ok(600)));
    expect(up).toMatchObject({ kind: "site_up", params: { minutes: 600 } });
  });
});

describe("certificado y dominio", () => {
  it("el certificado avisa al entrar en los días de aviso, una vez por fecha de caducidad", () => {
    const checks = [ok(0, "2026-10-20T00:00:00Z"), ok(5, "2026-10-10T08:00:00Z"), ok(10, "2026-10-10T08:00:00Z"), ok(15, "2026-12-24T08:00:00Z")];
    expect(run(checks)).toEqual([
      { kind: "ssl_expiring", key: "ssl_expiring:site-1:2026-10-10", params: { site: site.name, days: 14, date: "2026-10-10" } },
    ]);
  });

  it("un certificado caducado avisa con días negativos; sin certificado leído no se sabe y no avisa", () => {
    const [expired] = detectSiteAlerts(input({ failures: 0, since: null }, ok(0, "2026-09-25T08:00:00Z")));
    expect(expired).toMatchObject({ kind: "ssl_expiring", params: { days: -1, date: "2026-09-25" } });
    expect(detectSiteAlerts(input({ failures: 0, since: null }, ok(0, null)))).toEqual([]);
  });

  it("caduca hoy más tarde: 0 días", () => {
    const [today] = detectSiteAlerts(input({ failures: 0, since: null }, ok(0, "2026-09-26T20:00:00Z")));
    expect(today).toMatchObject({ kind: "ssl_expiring", params: { days: 0 } });
  });

  it("el dominio avisa dentro de sus días de aviso (y caducado), una vez por fecha", () => {
    expect(detectSiteAlerts(input({ failures: 0, since: null }, ok(0), { domainExpiresOn: "2026-10-27" }))).toEqual([]);
    expect(detectSiteAlerts(input({ failures: 0, since: null }, ok(0), { domainExpiresOn: "2026-10-26" }))).toEqual([
      { kind: "domain_expiring", key: "domain_expiring:site-1:2026-10-26", params: { site: site.name, days: 30, date: "2026-10-26" } },
    ]);
    const [expired] = detectSiteAlerts(input({ failures: 0, since: null }, ok(0), { domainExpiresOn: "2026-09-20" }));
    expect(expired).toMatchObject({ kind: "domain_expiring", params: { days: -6 } });
  });

  it("una web caída con el dominio a punto de caducar da los dos avisos", () => {
    const alerts = detectSiteAlerts(input({ failures: 1, since: at(0) }, fail(5, "dns", null), { domainExpiresOn: "2026-09-30" }));
    expect(alerts.map((a) => a.kind)).toEqual(["site_down", "domain_expiring"]);
  });
});
