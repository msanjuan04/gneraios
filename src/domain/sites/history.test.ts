import { describe, expect, it } from "vitest";
import { averageResponseMs, bucketChecks } from "./history";

const t = (hour: number, minute = 0) => new Date(Date.UTC(2026, 8, 26, hour, minute)).toISOString();

describe("bucketChecks", () => {
  it("agrupa por horas en punto desde el inicio hasta el final, con los tramos vacíos a 0", () => {
    const checks = [
      { checkedAt: t(8, 5), ok: true, responseMs: 200 },
      { checkedAt: t(8, 50), ok: true, responseMs: 400 },
      { checkedAt: t(8, 55), ok: false, responseMs: null },
      { checkedAt: t(10, 0), ok: true, responseMs: 900 },
      // Fuera del rango.
      { checkedAt: t(7, 59), ok: true, responseMs: 10 },
      { checkedAt: t(10, 31), ok: true, responseMs: 10 },
    ];
    expect(bucketChecks(checks, { from: new Date(t(8, 1)), to: new Date(t(10, 30)) })).toEqual([
      { start: t(8), total: 3, ok: 2, avgMs: 300, maxMs: 400 },
      { start: t(9), total: 0, ok: 0, avgMs: null, maxMs: null },
      { start: t(10), total: 1, ok: 1, avgMs: 900, maxMs: 900 },
    ]);
  });

  it("siete días en horas son 168 tramos (o 169 si el rango no empieza en punto)", () => {
    const to = new Date(t(10, 0));
    const from = new Date(to.getTime() - 7 * 24 * 3_600_000);
    expect(bucketChecks([], { from, to })).toHaveLength(169);
    expect(bucketChecks([], { from: new Date(from.getTime() + 3_600_000), to: new Date(to.getTime() - 1) })).toHaveLength(167);
  });

  it("tramos de otro tamaño y rangos vacíos", () => {
    expect(bucketChecks([], { from: new Date(t(10)), to: new Date(t(9)) })).toEqual([]);
    expect(bucketChecks([], { from: new Date(t(0)), to: new Date(t(23, 59)), bucketMs: 6 * 3_600_000 })).toHaveLength(4);
    expect(() => bucketChecks([], { from: new Date(t(0)), to: new Date(t(1)), bucketMs: 0 })).toThrow();
  });
});

describe("averageResponseMs", () => {
  it("solo cuenta las que fueron bien y tienen tiempo", () => {
    expect(
      averageResponseMs([
        { ok: true, responseMs: 100 },
        { ok: true, responseMs: 301 },
        { ok: false, responseMs: 9000 },
        { ok: true, responseMs: null },
      ]),
    ).toBe(201);
    expect(averageResponseMs([])).toBeNull();
  });
});
