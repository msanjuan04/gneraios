// "Con retraso" no se guarda: cambia con el calendario sin que nadie escriba nada (ARCHITECTURE §6.4).
// isProjectOverdue es la gemela de projects_overview.is_overdue; tests/db/proyectos.test.ts
// comprueba que dicen lo mismo con los mismos casos.

import { daysBetween, type CivilDate } from "../dates/civil-date";
import { isOpenProjectStatus, type ProjectStatus, type TaskStatus } from "./types";

/** Un proyecto va con retraso si su entrega ya pasó y aún pide trabajo (planificado, en marcha o en pausa). */
export function isProjectOverdue(project: { dueOn: CivilDate | null; status: ProjectStatus }, today: CivilDate): boolean {
  return project.dueOn !== null && daysBetween(project.dueOn, today) > 0 && isOpenProjectStatus(project.status);
}

/** Una tarea va con retraso si su fecha ya pasó y no está hecha. */
export function isTaskOverdue(task: { dueOn: CivilDate | null; status: TaskStatus }, today: CivilDate): boolean {
  return task.dueOn !== null && task.status !== "done" && daysBetween(task.dueOn, today) > 0;
}

/** Días de retraso (0 si no va tarde). */
export function daysLate(dueOn: CivilDate | null, today: CivilDate): number {
  return dueOn === null ? 0 : Math.max(0, daysBetween(dueOn, today));
}
