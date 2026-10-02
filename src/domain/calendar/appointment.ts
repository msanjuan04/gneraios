import { addDays, compareCivil, type CivilDate } from "@/domain/dates/civil-date";
import { dateInZone, toDateTimeLocal } from "@/domain/dates/zoned-time";
import type { CalendarEvent } from "./types";

export type AppointmentRow = {
  id: string;
  member_id: string;
  title: string;
  description: string;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
};

/** La cita conserva un único origen editable, pero aparece cada día que ocupa. */
export function appointmentCalendarEvents(row: AppointmentRow, from: CivilDate, to: CivilDate, timeZone: string, now: Date): CalendarEvent[] {
  const start = new Date(row.starts_at);
  const lastInstant = new Date(new Date(row.ends_at).getTime() - 1);
  const firstDay = row.all_day ? row.starts_at.slice(0, 10) : dateInZone(start, timeZone);
  const lastDay = row.all_day ? lastInstant.toISOString().slice(0, 10) : dateInZone(lastInstant, timeZone);
  const time = row.all_day ? null : toDateTimeLocal(start, timeZone).slice(11, 16);
  const result: CalendarEvent[] = [];
  for (let day = firstDay; compareCivil(day, lastDay) <= 0; day = addDays(day, 1)) {
    if (compareCivil(day, from) < 0 || compareCivil(day, to) > 0) continue;
    result.push({
      id: `appointment:${row.id}:${day}`,
      type: "appointment",
      kind: row.all_day ? "all_day" : "timed",
      date: day,
      time: day === firstDay ? time : null,
      startsAt: day === firstDay && !row.all_day ? row.starts_at : null,
      endsAt: row.ends_at,
      appointmentStart: { date: firstDay, time },
      description: row.description,
      title: row.title,
      subtitle: null,
      amountCents: null,
      amountPeriod: null,
      amountBasis: null,
      status: new Date(row.ends_at).getTime() < now.getTime() ? "past" : "scheduled",
      ownerMemberId: row.member_id,
      href: null,
      source: { table: "calendar_entries", id: row.id },
      movable: false,
      facts: [],
      links: [],
    });
  }
  return result;
}
