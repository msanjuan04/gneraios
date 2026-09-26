import { describe, expect, it } from "vitest";
import { cronHealth, type JobRunRow } from "./health";

const run = (startedAt: string, status: JobRunRow["status"], finishedAt: string | null = startedAt): JobRunRow => ({
  status,
  startedAt,
  finishedAt,
  error: status === "failed" ? "boom" : null,
});

const NOW = Date.parse("2026-09-26T12:00:00Z");

describe("salud del cron", () => {
  it("ok si el último OK tiene menos de 26 h", () => {
    const health = cronHealth([run("2026-09-25T05:00:00Z", "succeeded"), run("2026-09-26T05:00:00Z", "succeeded")], NOW);
    expect(health).toMatchObject({ state: "ok", lastSuccessAt: "2026-09-26T05:00:00Z", hoursSinceSuccess: 7 });
  });

  it("avisa si el último OK es viejo aunque después haya fallos", () => {
    const health = cronHealth([run("2026-09-25T05:00:00Z", "succeeded"), run("2026-09-26T05:00:00Z", "failed")], NOW);
    expect(health.state).toBe("stale");
    expect(health.hoursSinceSuccess).toBe(31);
    expect(health.lastRun?.status).toBe("failed");
  });

  it("nunca ha terminado bien", () => {
    expect(cronHealth([], NOW)).toMatchObject({ state: "never", lastRun: null });
    expect(cronHealth([run("2026-09-26T05:00:00Z", "running", null)], NOW)).toMatchObject({ state: "never" });
  });
});
