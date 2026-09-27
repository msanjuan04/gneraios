// Plantillas de proyecto: una lista de tareas con su estimación, a cuántos días del inicio tocan y
// si el cliente las ve. La validación de verdad está en SQL (private.template_tasks_valid); esto
// solo resume una plantilla para enseñarla.

export type TemplateTask = {
  title: string;
  estimate_minutes?: number | null;
  offset_days?: number | null;
  client_visible?: boolean | null;
};

export type TemplateSummary = {
  tasks: number;
  /** Suma de las estimaciones (null si ninguna tarea tiene). */
  estimateMinutes: number | null;
  /** Días desde el inicio hasta la última tarea con fecha (null si ninguna tiene). */
  spanDays: number | null;
};

export function templateSummary(tasks: readonly TemplateTask[]): TemplateSummary {
  const estimates = tasks.map((t) => t.estimate_minutes).filter((m): m is number => typeof m === "number");
  const offsets = tasks.map((t) => t.offset_days).filter((d): d is number => typeof d === "number");
  return {
    tasks: tasks.length,
    estimateMinutes: estimates.length === 0 ? null : estimates.reduce((sum, m) => sum + m, 0),
    spanDays: offsets.length === 0 ? null : Math.max(...offsets),
  };
}

/** Lee la columna jsonb tal y como llega: lo que no tenga forma de tarea se descarta. */
export function readTemplateTasks(value: unknown): TemplateTask[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || typeof (item as { title?: unknown }).title !== "string") return [];
    const t = item as Record<string, unknown>;
    return [
      {
        title: String(t.title),
        estimate_minutes: typeof t.estimate_minutes === "number" ? t.estimate_minutes : null,
        offset_days: typeof t.offset_days === "number" ? t.offset_days : null,
        client_visible: t.client_visible === true,
      },
    ];
  });
}
