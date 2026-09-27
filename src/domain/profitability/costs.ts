// Coste interno por hora de cada miembro (tabla member_costs): cada fila vale desde su fecha hasta
// la siguiente de la misma persona. El coste de un registro de horas se deriva, nunca se guarda:
// el de la fecha más reciente que no pasa del día trabajado; sin ninguna, el de la org
// (orgs.settings.profitability.default_hourly_cost_cents).

import { type CivilDate, parseCivilDate } from "../dates/civil-date";
import { assertCents, type Cents, divRoundHalfAwayFromZero } from "../money";

export type MemberCost = {
  memberId: string;
  /** Vigente desde este día (incluido). */
  validFrom: CivilDate;
  hourlyCostCents: Cents;
};

/** Historial de costes por miembro, de la fecha más antigua a la más reciente. */
export type CostBook = ReadonlyMap<string, readonly MemberCost[]>;

const MINUTES_PER_HOUR = BigInt(60);

/** Agrupa los costes por miembro y los ordena por fecha. Lanza si una fecha o un importe no son válidos. */
export function costBook(rows: readonly MemberCost[]): CostBook {
  const book = new Map<string, MemberCost[]>();
  for (const row of rows) {
    parseCivilDate(row.validFrom);
    assertCents(row.hourlyCostCents);
    if (row.hourlyCostCents < 0) throw new Error(`Un coste por hora no puede ser negativo: ${row.hourlyCostCents}.`);
    const list = book.get(row.memberId) ?? [];
    list.push(row);
    book.set(row.memberId, list);
  }
  // Las fechas civiles YYYY-MM-DD ya validadas se ordenan como texto.
  for (const list of book.values()) list.sort((a, b) => (a.validFrom < b.validFrom ? -1 : a.validFrom > b.validFrom ? 1 : 0));
  return book;
}

/** El coste vigente en `on` de un historial ordenado (el de la fecha más reciente que no pasa de `on`), o null. */
export function costInForce<T extends MemberCost>(history: readonly T[], on: CivilDate): T | null {
  let found: T | null = null;
  for (const row of history) {
    if (row.validFrom > on) break;
    found = row;
  }
  return found;
}

export type HourlyCost = {
  cents: Cents;
  /** Sin coste propio ese día: se usa el de la org. */
  fromDefault: boolean;
};

/** Coste por hora de un miembro en un día; sin coste propio vigente, el de la org. */
export function hourlyCostOn(book: CostBook, memberId: string, on: CivilDate, defaultCents: Cents): HourlyCost {
  const row = costInForce(book.get(memberId) ?? [], on);
  return row ? { cents: row.hourlyCostCents, fromDefault: false } : { cents: defaultCents, fromDefault: true };
}

/**
 * Lo que cuestan unos minutos: minutos × coste por hora ÷ 60, redondeado una sola vez (la mitad se
 * aleja de cero). Para sumar muchos registros, acumula `costMinuteCents` y divide al final.
 */
export function minutesCostCents(minutes: number, hourlyCostCents: Cents): Cents {
  return Number(divRoundHalfAwayFromZero(costMinuteCents(minutes, hourlyCostCents), MINUTES_PER_HOUR));
}

/** Minutos × céntimos por hora, exacto (sin dividir): lo que se acumula antes de redondear. */
export function costMinuteCents(minutes: number, hourlyCostCents: Cents): bigint {
  if (!Number.isSafeInteger(minutes) || minutes < 0) throw new Error(`Minutos no válidos: ${String(minutes)}.`);
  return BigInt(minutes) * BigInt(assertCents(hourlyCostCents));
}

/** Céntimos-minuto acumulados → céntimos, redondeado (la mitad se aleja de cero). */
export function centMinutesToCents(value: bigint): Cents {
  return Number(divRoundHalfAwayFromZero(value, MINUTES_PER_HOUR));
}

export type CostStatus<T extends MemberCost = MemberCost> = {
  /** El vigente hoy, o null si aún no tiene ninguno (se usa el de la org). */
  current: T | null;
  /** El siguiente cambio ya programado (fecha futura), si lo hay. */
  next: T | null;
};

/** Qué coste tiene hoy un miembro y cuál es el próximo cambio programado (historial de más antiguo a más reciente). */
export function costStatus<T extends MemberCost>(history: readonly T[], today: CivilDate): CostStatus<T> {
  const current = costInForce(history, today);
  const next = history.find((row) => row.validFrom > today) ?? null;
  return { current, next };
}
