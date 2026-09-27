// "Mis tareas": lo que tiene asignado un socio en todos sus proyectos, agrupado por cuándo toca.
// La semana va de lunes a domingo: el domingo, "esta semana" ya es solo hoy.

import { compareCivil, daysBetween, type CivilDate } from "../dates/civil-date";
import { weekEnd } from "./series";
import { priorityRank, type TaskPriority, type TaskStatus } from "./types";

export const MY_TASK_GROUPS = ["overdue", "today", "thisWeek", "later", "noDate"] as const;
export type MyTaskGroup = (typeof MY_TASK_GROUPS)[number];

export function myTaskGroup(dueOn: CivilDate | null, today: CivilDate): MyTaskGroup {
  if (dueOn === null) return "noDate";
  const days = daysBetween(today, dueOn);
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  return compareCivil(dueOn, weekEnd(today)) <= 0 ? "thisWeek" : "later";
}

type GroupableTask = { dueOn: CivilDate | null; status: TaskStatus; priority: TaskPriority; title: string };

/** Por fecha, luego lo más urgente y luego por título. */
export function compareByDue(a: GroupableTask, b: GroupableTask): number {
  if (a.dueOn !== b.dueOn) {
    if (a.dueOn === null) return 1;
    if (b.dueOn === null) return -1;
    const byDate = compareCivil(a.dueOn, b.dueOn);
    if (byDate !== 0) return byDate;
  }
  return priorityRank(a.priority) - priorityRank(b.priority) || a.title.localeCompare(b.title, "es");
}

/** Las tareas sin hacer, en sus grupos y en orden. Siempre salen los cinco grupos (la pantalla decide cuáles pinta). */
export function groupMyTasks<T extends GroupableTask>(tasks: readonly T[], today: CivilDate): { group: MyTaskGroup; tasks: T[] }[] {
  const groups = new Map<MyTaskGroup, T[]>(MY_TASK_GROUPS.map((g) => [g, []]));
  for (const task of tasks) {
    if (task.status === "done") continue;
    groups.get(myTaskGroup(task.dueOn, today))!.push(task);
  }
  return MY_TASK_GROUPS.map((group) => ({ group, tasks: groups.get(group)!.sort(compareByDue) }));
}
