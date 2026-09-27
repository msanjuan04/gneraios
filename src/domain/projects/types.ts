// Valores de los enums de proyectos (supabase/migrations/20260926280000_proyectos.sql), en el orden
// en que se ofrecen en la interfaz. Las etiquetas salen de i18n (`projects.*`).

export const PROJECT_KINDS = ["web", "seo", "ads", "branding", "social", "maintenance", "internal", "other"] as const;
export type ProjectKind = (typeof PROJECT_KINDS)[number];

/** Decisión humana. "Con retraso" no es un estado: se deriva (overdue.ts). */
export const PROJECT_STATUSES = ["planned", "active", "paused", "done", "cancelled"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/** Estados en los que un proyecto aún pide trabajo (y puede ir con retraso). */
export const OPEN_PROJECT_STATUSES = ["planned", "active", "paused"] as const satisfies readonly ProjectStatus[];

export const TASK_STATUSES = ["todo", "doing", "review", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export function isOpenProjectStatus(status: ProjectStatus): boolean {
  return (OPEN_PROJECT_STATUSES as readonly ProjectStatus[]).includes(status);
}

/** Urgente primero: para ordenar tareas con la misma fecha. */
export function priorityRank(priority: TaskPriority): number {
  return TASK_PRIORITIES.length - 1 - TASK_PRIORITIES.indexOf(priority);
}
