// Periodo de un export para la gestoría: un trimestre natural (el del modelo 303) o un año entero.

import { formatCivil, type CivilDate } from "../dates/civil-date";

export type ExportPeriod = {
  /** "2026-T3" o "2026". */
  key: string;
  year: number;
  /** 1-4, o null si es el año entero. */
  quarter: 1 | 2 | 3 | 4 | null;
  from: CivilDate;
  to: CivilDate;
};

const PERIOD = /^(\d{4})(?:-(?:T|Q)([1-4]))?$/i;

/** "2026-T3" (también "2026-Q3") o "2026" → fechas de inicio y fin. */
export function parseExportPeriod(value: string): ExportPeriod | null {
  const m = PERIOD.exec(value.trim());
  if (!m) return null;
  const year = Number(m[1]);
  if (year < 2000 || year > 2999) return null;
  if (!m[2]) {
    return { key: String(year), year, quarter: null, from: formatCivil({ year, month: 1, day: 1 }), to: formatCivil({ year, month: 12, day: 31 }) };
  }
  const quarter = Number(m[2]) as 1 | 2 | 3 | 4;
  const firstMonth = (quarter - 1) * 3 + 1;
  const lastMonth = firstMonth + 2;
  const lastDay = [31, 30, 30, 31][quarter - 1]!;
  return {
    key: `${year}-T${quarter}`,
    year,
    quarter,
    from: formatCivil({ year, month: firstMonth, day: 1 }),
    to: formatCivil({ year, month: lastMonth, day: lastDay }),
  };
}

/** Trimestre que contiene una fecha. */
export function quarterOf(date: CivilDate): ExportPeriod {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return parseExportPeriod(`${year}-T${Math.ceil(month / 3)}`)!;
}

/** El trimestre anterior al que contiene `date` (el que se presenta ahora). */
export function previousQuarter(date: CivilDate): ExportPeriod {
  const current = quarterOf(date);
  if (current.quarter === 1) return parseExportPeriod(`${current.year - 1}-T4`)!;
  return parseExportPeriod(`${current.year}-T${current.quarter! - 1}`)!;
}
