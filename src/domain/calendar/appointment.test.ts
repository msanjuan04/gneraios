import { describe, expect, it } from "vitest";
import { appointmentCalendarEvents, type AppointmentRow } from "./appointment";

const base: AppointmentRow = {
  id: "entry-1", member_id: "member-1", title: "Viaje", description: "",
  starts_at: "2026-10-31T00:00:00.000Z", ends_at: "2026-11-03T00:00:00.000Z", all_day: true,
};

describe("citas que ocupan varios días", () => {
  it("muestra días dentro del rango, con el mismo origen y fecha original para editar", () => {
    const events = appointmentCalendarEvents(base, "2026-11-01", "2026-11-30", "Europe/Madrid", new Date("2026-10-01"));
    expect(events.map((event) => event.date)).toEqual(["2026-11-01", "2026-11-02"]);
    expect(events.map((event) => event.source.id)).toEqual(["entry-1", "entry-1"]);
    expect(events[0]?.appointmentStart).toEqual({ date: "2026-10-31", time: null });
    expect(events[0]?.id).not.toBe(events[1]?.id);
  });

  it("respeta día local de citas con hora que cruzan medianoche", () => {
    const events = appointmentCalendarEvents({
      ...base, all_day: false, starts_at: "2026-10-31T22:30:00.000Z", ends_at: "2026-11-01T01:00:00.000Z",
    }, "2026-10-31", "2026-11-01", "Europe/Madrid", new Date("2026-10-01"));
    expect(events.map((event) => event.date)).toEqual(["2026-10-31", "2026-11-01"]);
    expect(events[0]?.time).toBe("23:30");
    expect(events[1]?.time).toBeNull();
    expect(events[1]?.appointmentStart).toEqual({ date: "2026-10-31", time: "23:30" });
  });
});
