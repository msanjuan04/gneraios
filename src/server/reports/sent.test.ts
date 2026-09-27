import { describe, expect, it } from "vitest";
import { latestSentByMonth } from "./sent";

describe("latestSentByMonth", () => {
  it("un informe por mes (el último envío), del más reciente al más antiguo", () => {
    const sent = latestSentByMonth([
      { report_month: "2026-07-01", sent_at: "2026-08-05T09:00:00Z", report_hours: false, language: "ca" },
      { report_month: "2026-08-01", sent_at: "2026-09-05T09:00:00Z", report_hours: false, language: "es" },
      // Una corrección del mismo mes, con las horas.
      { report_month: "2026-08-01", sent_at: "2026-09-06T10:00:00Z", report_hours: true, language: "es" },
      { report_month: null, sent_at: "2026-09-06T10:00:00Z", report_hours: false, language: "es" },
      { report_month: "2026-06-15", sent_at: "2026-07-05T09:00:00Z", report_hours: false, language: "es" },
      { report_month: "2026-05-01", sent_at: null, report_hours: false, language: "xx" },
    ]);
    expect(sent).toEqual([
      { month: "2026-08-01", sentAt: "2026-09-06T10:00:00Z", includeHours: true, language: "es" },
      { month: "2026-07-01", sentAt: "2026-08-05T09:00:00Z", includeHours: false, language: "ca" },
    ]);
  });
});
