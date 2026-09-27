// «Lo que hemos hecho» y «Próximos pasos». Solo sale lo que un socio ha decidido enseñar al
// cliente: las tareas visibles de sus proyectos visibles (la misma regla que el portal, la de
// getPortalProjects) y las actividades marcadas como visibles. Nada lleva horas, notas ni
// responsables, y los próximos pasos no llevan fecha: es lo que viene, sin prometer cuándo.

import { compareCivil } from "../dates/civil-date";
import { dateInZone } from "../dates/zoned-time";
import { addMonths, monthEnd, type Month } from "../metrics/months";
import type { TaskStatus } from "../projects/types";
import { inMonth } from "./month";
import type {
  ReportActivity,
  ReportActivityFact,
  ReportDoneTask,
  ReportNextStep,
  ReportOpenTaskStatus,
  ReportProjectFact,
} from "./types";

/** Próximos pasos que caben en el informe; del resto se dice cuántos quedan. */
export const NEXT_STEPS_LIMIT = 8;

/** Lo que ya está en marcha va delante de lo que aún no ha empezado. */
const OPEN_ORDER: Record<ReportOpenTaskStatus, number> = { doing: 0, review: 1, todo: 2 };

const isOpen = (status: TaskStatus): status is ReportOpenTaskStatus => status !== "done";

/** Las tareas visibles que se terminaron en el mes (en la zona de la org), en orden de fecha. */
export function doneTasks(projects: readonly ReportProjectFact[], month: Month, timeZone: string): ReportDoneTask[] {
  const done = projects.flatMap((project) =>
    project.tasks.flatMap((task): ReportDoneTask[] => {
      if (task.status !== "done" || !task.completedAt) return [];
      const completedOn = dateInZone(new Date(task.completedAt), timeZone);
      if (!inMonth(completedOn, month)) return [];
      return [
        {
          id: task.id,
          title: task.title.trim(),
          projectId: project.id,
          projectName: project.name.trim(),
          projectKind: project.kind,
          completedOn,
        },
      ];
    }),
  );
  return done.sort(
    (a, b) =>
      compareCivil(a.completedOn, b.completedOn) ||
      a.projectName.localeCompare(b.projectName, "es") ||
      a.title.localeCompare(b.title, "es") ||
      a.id.localeCompare(b.id),
  );
}

/** Las actividades visibles del mes, en orden de fecha. */
export function monthActivities(activities: readonly ReportActivityFact[], month: Month, timeZone: string): ReportActivity[] {
  return activities
    .map((activity) => ({ activity, occurredOn: dateInZone(new Date(activity.occurredAt), timeZone) }))
    .filter(({ occurredOn }) => inMonth(occurredOn, month))
    .sort((a, b) => a.activity.occurredAt.localeCompare(b.activity.occurredAt) || a.activity.id.localeCompare(b.activity.id))
    .map(({ activity, occurredOn }) => ({
      id: activity.id,
      kind: activity.kind,
      title: activity.title.trim(),
      body: activity.body?.trim() || null,
      occurredOn,
    }));
}

/**
 * Los próximos pasos: de los proyectos en marcha o por empezar, las tareas visibles que ya están en
 * curso o en revisión (sea cual sea su fecha) y las pendientes con fecha hasta el final del mes
 * siguiente al del informe (también las que se han quedado atrás) o sin fecha. Primero lo que está
 * en curso, luego lo que se revisa y luego lo pendiente; dentro, por fecha (las que no tienen, al
 * final) y en el orden del tablero.
 */
export function nextSteps(
  projects: readonly ReportProjectFact[],
  month: Month,
  limit = NEXT_STEPS_LIMIT,
): { items: ReportNextStep[]; more: number } {
  const horizon = monthEnd(addMonths(month, 1));
  const open = projects
    .filter((project) => project.status === "active" || project.status === "planned")
    .flatMap((project, projectIndex) =>
      project.tasks.flatMap((task, taskIndex) => {
        const { status } = task;
        if (!isOpen(status)) return [];
        if (status === "todo" && task.dueOn !== null && compareCivil(task.dueOn, horizon) > 0) return [];
        return [{ task, status, projectName: project.name.trim(), projectIndex, taskIndex }];
      }),
    )
    .sort(
      (a, b) =>
        OPEN_ORDER[a.status] - OPEN_ORDER[b.status] ||
        (a.task.dueOn === null ? 1 : 0) - (b.task.dueOn === null ? 1 : 0) ||
        (a.task.dueOn && b.task.dueOn ? compareCivil(a.task.dueOn, b.task.dueOn) : 0) ||
        a.projectIndex - b.projectIndex ||
        a.taskIndex - b.taskIndex,
    );
  const size = Math.max(0, limit);
  return {
    items: open.slice(0, size).map(({ task, status, projectName }) => ({ id: task.id, title: task.title.trim(), projectName, status })),
    more: Math.max(0, open.length - size),
  };
}
