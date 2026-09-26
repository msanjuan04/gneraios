"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * false en el servidor y en la hidratación, true después. Las gráficas de Recharts miden su
 * contenedor en el navegador: hasta entonces se pinta un hueco del mismo tamaño (sin saltos).
 */
export function useMounted(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
