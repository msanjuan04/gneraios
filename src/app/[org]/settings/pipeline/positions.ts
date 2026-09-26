/**
 * Orden de las listas configurables del pipeline (etapas, fuentes y motivos).
 * Funciones puras: las acciones aplican los cambios que devuelven.
 */

export type Positioned = { id: string; position: number; created_at: string };
export type PositionChange = { id: string; from: number; to: number };
export type Direction = "up" | "down";

/** Orden estable: por posición y, a igualdad, por antigüedad e id. El mismo en la página y en las acciones. */
export function sortByPosition<T extends Positioned>(rows: readonly T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      a.position - b.position ||
      (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/** Posición para añadir al final de la lista (archivadas incluidas, para no repetir posiciones). */
export function nextPosition(rows: readonly Pick<Positioned, "position">[]): number {
  return rows.reduce((max, row) => Math.max(max, row.position), 0) + 1;
}

/**
 * Cambios para subir o bajar un puesto un elemento de `ordered` (ya ordenada).
 * Lo normal es intercambiar dos posiciones; si empatan (filas creadas fuera de
 * esta pantalla), se renumera la lista en el nuevo orden. null si no se puede mover.
 */
export function planMove(ordered: readonly Positioned[], id: string, direction: Direction): PositionChange[] | null {
  const index = ordered.findIndex((row) => row.id === id);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index === -1 || target < 0 || target >= ordered.length) return null;

  const current = ordered[index];
  const neighbour = ordered[target];
  if (current.position !== neighbour.position) {
    return [
      { id: current.id, from: current.position, to: neighbour.position },
      { id: neighbour.id, from: neighbour.position, to: current.position },
    ];
  }

  const reordered = [...ordered];
  reordered[index] = neighbour;
  reordered[target] = current;
  return reordered
    .map((row, i) => ({ id: row.id, from: row.position, to: i + 1 }))
    .filter((change) => change.from !== change.to);
}

/**
 * Hueco para una etapa nueva: la posición de la primera etapa ganada (`active`, ya
 * ordenada), que baja un puesto con todo lo que venga detrás. `all` incluye las
 * archivadas para que el orden histórico del embudo no se mezcle. Los cambios van
 * de la última a la primera, para no repetir posiciones en ningún momento.
 * Sin etapas ganadas, la nueva va al final.
 */
export function planInsertBeforeFirstWon(
  active: readonly (Positioned & { kind: string })[],
  all: readonly Positioned[],
): { position: number; shift: PositionChange[] } {
  const firstWon = active.find((stage) => stage.kind === "won");
  if (!firstWon) return { position: nextPosition(all), shift: [] };

  const at = firstWon.position;
  const shift = all
    .filter((row) => row.position >= at)
    .sort((a, b) => b.position - a.position)
    .map((row) => ({ id: row.id, from: row.position, to: row.position + 1 }));
  return { position: at, shift };
}

/** true si `stageId` es la única etapa activa de su tipo: sin ella faltaría una abierta, una ganada o una perdida. */
export function isOnlyOfKind(active: readonly { id: string; kind: string }[], stageId: string): boolean {
  const stage = active.find((s) => s.id === stageId);
  return Boolean(stage) && !active.some((s) => s.id !== stageId && s.kind === stage?.kind);
}

/** Mismo nombre sin distinguir mayúsculas, acentos ni espacios repetidos ("Meta  ads" = "Meta Ads"). */
export function sameName(a: string, b: string): boolean {
  const normalize = (value: string) => value.trim().replace(/\s+/g, " ");
  return normalize(a).localeCompare(normalize(b), "es", { sensitivity: "base" }) === 0;
}

/** true si otra fila de `rows` (sin contar `exceptId`) ya se llama así. */
export function hasDuplicateName(
  rows: readonly { id: string; name: string }[],
  name: string,
  exceptId?: string,
): boolean {
  return rows.some((row) => row.id !== exceptId && sameName(row.name, name));
}
