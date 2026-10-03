// Lo que un cliente paga de forma recurrente: cuánto y cada cuánto. Se deriva de las líneas de sus
// contratos vivos (nunca se guarda): una mensualidad o una anualidad que se cancela o termina deja de
// contar sola. Importes sin IVA, como el resto de la contratación.

export type RecurringLine = {
  billingType: "one_off" | "monthly" | "yearly" | "usage";
  /** `numeric(12,3)` ya como número. */
  quantity: number;
  unitPriceCents: number;
  discountBps: number;
  startsOn: string | null;
  endsOn: string | null;
  cancelledOn: string | null;
};

export type Recurrence = { monthlyCents: number; yearlyCents: number; lines: number };

export const NO_RECURRENCE: Recurrence = { monthlyCents: 0, yearlyCents: 0, lines: 0 };

/** Lo que cobra una línea en cada ciclo: cantidad × precio, menos el descuento, redondeado a céntimos. */
export const cycleCents = (line: Pick<RecurringLine, "quantity" | "unitPriceCents" | "discountBps">): number =>
  Math.round(line.quantity * line.unitPriceCents * (1 - line.discountBps / 10_000));

/** ¿Cuenta hoy? Empezó (o no tiene inicio), no ha terminado y no se ha cancelado. */
export function isLiveOn(line: Pick<RecurringLine, "startsOn" | "endsOn" | "cancelledOn">, today: string): boolean {
  if (line.startsOn && line.startsOn > today) return false;
  if (line.endsOn && line.endsOn < today) return false;
  if (line.cancelledOn && line.cancelledOn <= today) return false;
  return true;
}

/**
 * La recurrencia de un cliente: la suma de sus mensualidades y, aparte, la de sus anualidades. No se
 * convierten entre sí (una anualidad no es «mensualidad ÷ 12» a efectos de cobro: entra de golpe).
 */
export function recurrenceOf(lines: readonly RecurringLine[], today: string): Recurrence {
  const result = { ...NO_RECURRENCE };
  for (const line of lines) {
    if ((line.billingType !== "monthly" && line.billingType !== "yearly") || !isLiveOn(line, today)) continue;
    result.lines += 1;
    if (line.billingType === "monthly") result.monthlyCents += cycleCents(line);
    else result.yearlyCents += cycleCents(line);
  }
  return result;
}
