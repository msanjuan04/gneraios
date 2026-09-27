// Días hábiles de TARGET2, el calendario de los adeudos SEPA: el banco solo carga un recibo en un
// día hábil. Cierra sábados, domingos, 1 de enero, Viernes Santo, Lunes de Pascua, 1 de mayo y
// 25 y 26 de diciembre. Si la fecha de cobro pedida no es hábil, el banco la mueve al siguiente.

import { addDays, type CivilDate, formatCivil, parseCivilDate } from "@/domain/dates/civil-date";

/** Domingo de Pascua (calendario gregoriano, algoritmo anónimo de Meeus/Jones/Butcher). */
export function easterSunday(year: number): CivilDate {
  if (!Number.isInteger(year) || year < 1583) throw new Error(`Año no válido: ${year}`);
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return formatCivil({ year, month, day });
}

/** Día de la semana: 0 domingo … 6 sábado. */
function weekday(date: CivilDate): number {
  const { year, month, day } = parseCivilDate(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** ¿Abre TARGET2 ese día? */
export function isTargetBusinessDay(date: CivilDate): boolean {
  const dow = weekday(date);
  if (dow === 0 || dow === 6) return false;
  const { year, month, day } = parseCivilDate(date);
  if ((month === 1 && day === 1) || (month === 5 && day === 1) || (month === 12 && (day === 25 || day === 26))) return false;
  const easter = easterSunday(year);
  return date !== addDays(easter, -2) && date !== addDays(easter, 1);
}

/** El primer día hábil TARGET2 a partir de `date` (incluido). */
export function nextTargetBusinessDay(date: CivilDate): CivilDate {
  let day = date;
  while (!isTargetBusinessDay(day)) day = addDays(day, 1);
  return day;
}

/**
 * Margen por defecto entre hoy y la fecha de cobro: el esquema básico admite presentar el fichero
 * hasta el día hábil anterior, pero cada banco tiene su hora de corte. Es solo la fecha propuesta;
 * el socio elige otra si su banco lo permite.
 */
export const DEFAULT_COLLECTION_LEAD_DAYS = 3;

/** Fecha de cobro propuesta para una remesa preparada hoy: el primer día hábil tras el margen. */
export function suggestCollectionDate(today: CivilDate, leadDays = DEFAULT_COLLECTION_LEAD_DAYS): CivilDate {
  return nextTargetBusinessDay(addDays(today, leadDays));
}
