import { describe, expect, it } from "vitest";
import { type TrafficChannel, trafficChannels } from "./channels";
import type { WebDay } from "./metrics";

const day = (date: string, sessions: number, conversions = 0): WebDay => ({ date, sessions, users: sessions, engagedSessions: Math.floor(sessions / 2), conversions });
const range = { from: "2026-09-08", to: "2026-09-14" };
const compare = { from: "2026-09-01", to: "2026-09-07" };

describe("canales de tráfico", () => {
  it("reparte las sesiones por canal, con su peso, su variación y los de pago juntos", () => {
    const byChannel = new Map<TrafficChannel, WebDay[]>([
      ["organic_search", [day("2026-09-02", 50), day("2026-09-09", 60, 2)]],
      ["paid_search", [day("2026-09-03", 10), day("2026-09-10", 30, 3)]],
      ["paid_social", [day("2026-09-10", 10, 1)]],
    ]);
    const out = trafficChannels(byChannel, range, compare)!;
    expect(out.totalSessions).toBe(100);
    expect(out.rows.map((r) => [r.channel, r.sessions, r.share])).toEqual([
      ["organic_search", 60, 0.6],
      ["paid_search", 30, 0.3],
      ["paid_social", 10, 0.1],
    ]);
    expect(out.rows[1]!.change).toBe(2);
    expect(out.paid).toEqual({ sessions: 40, share: 0.4, conversions: 4, change: 3 });
  });

  it("sin desglose (solo total y orgánico, como antes de los canales), nada", () => {
    expect(trafficChannels(new Map([["organic_search", [day("2026-09-09", 60)]]]), range, compare)).toBeNull();
  });

  it("sin comparación no hay variación, y un canal que ya no trae nada sigue saliendo si antes traía", () => {
    const byChannel = new Map<TrafficChannel, WebDay[]>([
      ["direct", [day("2026-09-09", 20)]],
      ["email", [day("2026-09-02", 5)]],
    ]);
    const noCompare = trafficChannels(byChannel, range, null)!;
    expect(noCompare.rows.map((r) => r.channel)).toEqual(["direct"]);
    expect(noCompare.rows[0]!.change).toBeNull();
    const withCompare = trafficChannels(byChannel, range, compare)!;
    expect(withCompare.rows.map((r) => [r.channel, r.sessions, r.previousSessions])).toEqual([
      ["direct", 20, 0],
      ["email", 0, 5],
    ]);
  });
});
