// Módulos que una org puede tener apagados (orgs.settings.modules). Puro: lo usan el shell, las
// páginas, la cola de acciones, el resumen semanal y el cron.

/** Lo que el shell necesita saber para pintar el menú. */
export type OrgModules = {
  /** Consejo de agentes: apagado por defecto (gasta en IA y no todas las orgs lo quieren). */
  council: boolean;
};

export const ORG_MODULES_OFF: OrgModules = { council: false };

/**
 * Los módulos activos de una org a partir de lo guardado en `orgs.settings`. Lo que falte o no sea
 * válido queda apagado: un módulo se enciende a propósito, nunca por descuido.
 */
export function readOrgModules(settings: unknown): OrgModules {
  const modules = settings && typeof settings === "object" ? (settings as { modules?: unknown }).modules : null;
  const council = modules && typeof modules === "object" ? (modules as { council?: unknown }).council : null;
  return { council: council === true };
}
