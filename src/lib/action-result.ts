/** Resultado de una acción de ajustes. El error llega ya traducido, listo para un toast. */
export type ActionResult<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };
