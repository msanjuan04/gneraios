// Avance de un proyecto: tareas hechas entre tareas. Se deriva de las tareas; el estado del
// proyecto (una decisión humana) solo cuenta cuando no hay tareas que mirar.

import type { ProjectStatus } from "./types";

export type Progress = {
  done: number;
  total: number;
  /** 0…1, o null si no hay nada que medir. */
  ratio: number | null;
};

export function projectProgress(input: { tasksTotal: number; tasksDone: number; status: ProjectStatus }): Progress {
  const total = Math.max(0, input.tasksTotal);
  const done = Math.min(Math.max(0, input.tasksDone), total);
  if (total > 0) return { done, total, ratio: done / total };
  return { done, total, ratio: input.status === "done" ? 1 : null };
}

/** Porcentaje entero para pintar: 0,666 → 67. */
export function progressPercent(progress: Progress): number | null {
  return progress.ratio === null ? null : Math.round(progress.ratio * 100);
}
