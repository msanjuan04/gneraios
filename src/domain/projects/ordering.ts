// Orden de las tarjetas dentro de una columna del tablero (project_tasks.position, numeric). Índice
// fraccional: mover una tarjeta cambia una sola fila (el punto medio entre sus vecinas) y solo se
// renumera la columna cuando ya no cabe un número entre las dos.

export const POSITION_STEP = 1024;
const MIN_GAP = 1e-6;

export type Positioned = { id: string; position: number };

/** Detrás de todas: la mayor + un paso (o el primer paso en una columna vacía). */
export function positionAtEnd(positions: readonly number[]): number {
  return positions.length === 0 ? POSITION_STEP : Math.max(...positions) + POSITION_STEP;
}

/** Delante de todas. */
export function positionAtStart(positions: readonly number[]): number {
  return positions.length === 0 ? POSITION_STEP : Math.min(...positions) - POSITION_STEP;
}

export type MovePlan = {
  /** Posición nueva de la tarjeta movida. */
  position: number;
  /** Solo si hay que renumerar: las demás tarjetas de la columna que cambian de posición. */
  renumber: Positioned[];
};

/**
 * Dónde queda una tarjeta que se suelta en `index` de una columna. `column` son las demás
 * tarjetas de esa columna, ya en orden y sin la que se mueve.
 */
export function planMove(column: readonly Positioned[], index: number): MovePlan {
  const at = Math.max(0, Math.min(Math.trunc(index), column.length));
  const before = column[at - 1]?.position;
  const after = column[at]?.position;
  if (before === undefined && after === undefined) return { position: POSITION_STEP, renumber: [] };
  if (before === undefined) return { position: after! - POSITION_STEP, renumber: [] };
  if (after === undefined) return { position: before + POSITION_STEP, renumber: [] };
  if (after - before > 2 * MIN_GAP) return { position: (before + after) / 2, renumber: [] };

  // Sin hueco: pasos limpios para toda la columna, con la movida en su sitio.
  const renumber = column
    .map((task, k) => ({ id: task.id, position: (k < at ? k + 1 : k + 2) * POSITION_STEP }))
    .filter((task, k) => task.position !== column[k]!.position);
  return { position: (at + 1) * POSITION_STEP, renumber };
}

/** Orden estable de una columna: por posición y, a igualdad, por id. */
export function comparePositioned(a: Positioned, b: Positioned): number {
  return a.position - b.position || a.id.localeCompare(b.id);
}
