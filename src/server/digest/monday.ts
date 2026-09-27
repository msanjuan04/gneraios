import { addDays, type CivilDate, parseCivilDate } from "@/domain/dates/civil-date";

/** El lunes de la semana de `date` (las semanas empiezan en lunes). */
export function mondayOf(date: CivilDate): CivilDate {
  const { year, month, day } = parseCivilDate(date);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0 = domingo
  return addDays(date, -((weekday + 6) % 7));
}
