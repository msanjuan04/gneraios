// Reparto exacto de céntimos en partes proporcionales (método del mayor resto). Lo usa la
// rentabilidad para repartir lo facturado entre proyectos sin perder ni inventar un céntimo: la
// suma de las partes es siempre el total, así que la fila de un cliente es la suma de sus proyectos.

import { assertCents, type Cents } from "../money";

const ZERO = BigInt(0);

function assertWeight(weight: number): bigint {
  if (!Number.isSafeInteger(weight) || weight < 0) {
    throw new Error(`Un peso del reparto debe ser un entero no negativo: ${String(weight)}.`);
  }
  return BigInt(weight);
}

/**
 * Reparte `total` en partes proporcionales a `weights` (enteros ≥ 0, p. ej. minutos). Cada parte es
 * el suelo de su cuota y los céntimos que sobran van, de uno en uno, a los mayores restos (a igualdad,
 * al primero): determinista y exacto. Con todos los pesos a 0, a partes iguales. Un total negativo
 * (una rectificativa) se reparte igual, con el signo cambiado: −total reparte lo contrario que total.
 */
export function allocateCents(total: Cents, weights: readonly number[]): Cents[] {
  assertCents(total);
  if (weights.length === 0) throw new Error("No hay entre quién repartir.");
  const raw = weights.map(assertWeight);
  const sum = raw.reduce((acc, w) => acc + w, ZERO);
  const effective = sum === ZERO ? raw.map(() => BigInt(1)) : raw;
  const denominator = sum === ZERO ? BigInt(raw.length) : sum;

  const sign = total < 0 ? -1 : 1;
  const amount = BigInt(Math.abs(total));
  const parts = effective.map((w) => (amount * w) / denominator);
  const remainders = effective.map((w, index) => ({ index, rest: (amount * w) % denominator }));
  let left = amount - parts.reduce((acc, p) => acc + p, ZERO);
  // Mayor resto primero; a igualdad, el que va antes.
  remainders.sort((a, b) => (a.rest === b.rest ? a.index - b.index : a.rest > b.rest ? -1 : 1));
  for (const { index } of remainders) {
    if (left === ZERO) break;
    parts[index] = parts[index]! + BigInt(1);
    left -= BigInt(1);
  }
  return parts.map((p) => {
    const value = Number(p) * sign;
    return value === 0 ? 0 : value;
  });
}
