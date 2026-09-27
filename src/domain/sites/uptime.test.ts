import { describe, expect, it } from "vitest";
import { UPTIME_WINDOWS, uptimeByWindow, uptimeRatio, windowCounts } from "./uptime";

const now = new Date("2026-09-26T10:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();

describe("uptime", () => {
  it("es la proporción de comprobaciones buenas; sin comprobaciones no hay uptime", () => {
    expect(uptimeRatio({ total: 0, ok: 0 })).toBeNull();
    expect(uptimeRatio({ total: 4, ok: 3 })).toBe(0.75);
    expect(uptimeRatio({ total: 2016, ok: 2016 })).toBe(1);
  });

  it("cuenta cada comprobación en las ventanas de 24 h, 7 y 30 días que la contienen, con el borde abierto", () => {
    const checks = [
      { checkedAt: hoursAgo(0), ok: true },
      { checkedAt: hoursAgo(1), ok: false },
      { checkedAt: hoursAgo(23.9), ok: true },
      // Justo en el borde: ya no cuenta en 24 h.
      { checkedAt: hoursAgo(24), ok: false },
      { checkedAt: hoursAgo(48), ok: true },
      { checkedAt: hoursAgo(24 * 7 - 0.1), ok: false },
      { checkedAt: hoursAgo(24 * 7), ok: true },
      { checkedAt: hoursAgo(24 * 29), ok: true },
      { checkedAt: hoursAgo(24 * 30), ok: false },
      { checkedAt: hoursAgo(24 * 45), ok: false },
      // Del futuro (reloj adelantado): no cuenta.
      { checkedAt: hoursAgo(-1), ok: false },
    ];
    const counts = windowCounts(checks, now);
    expect(counts).toEqual({
      day: { total: 3, ok: 2 },
      week: { total: 6, ok: 3 },
      month: { total: 8, ok: 5 },
    });
    expect(uptimeByWindow(counts)).toEqual({ day: 2 / 3, week: 0.5, month: 5 / 8 });
  });

  it("las ventanas son de 24, 168 y 720 horas", () => {
    expect(UPTIME_WINDOWS).toEqual({ day: 24 * 3_600_000, week: 168 * 3_600_000, month: 720 * 3_600_000 });
    expect(uptimeByWindow(windowCounts([], now))).toEqual({ day: null, week: null, month: null });
  });
});
