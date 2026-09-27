// Sin "server-only" ni base de datos: lo que ve el cliente de sus proyectos se decide aquí, puro,
// para poder probarlo. Lo carga src/server/portal/space.ts a partir de getPortalProjects.
import type { SpaceWorkItem, SpaceWorkProject, SpaceWorkTask } from "@/components/portal/types";
import { compareCivil, type CivilDate, daysBetween } from "@/domain/dates/civil-date";
import { projectProgress } from "@/domain/projects";
import { nowInZone } from "@/lib/clock";
import type { PortalProject, PortalProjectTask } from "@/server/projects/portal";

/**
 * «Tu espacio» enseña orden, no promesas: qué se está haciendo, qué viene y qué se ha entregado.
 * Todo sale de las tareas que el socio marca como visibles: el avance cuenta solo esas (nunca las
 * internas) y nada lleva horas, notas ni importes.
 */

/** Tareas sin hacer que se enseñan de cada proyecto en «En qué estamos». */
export const NEXT_TASKS = 3;

/** Días hacia atrás de las tareas terminadas que salen en «Lo que hemos hecho». */
export const DONE_TASK_DAYS = 60;

type OpenTask = PortalProjectTask & { status: SpaceWorkTask["status"] };

const isOpen = (task: PortalProjectTask): task is OpenTask => task.status !== "done";

/**
 * La próxima fecha prevista de un proyecto en marcha o por empezar: la más cercana, de hoy en
 * adelante, entre sus tareas visibles sin hacer y su entrega. Lo que ya pasó no es «próximo», y un
 * proyecto en pausa o terminado no tiene nada previsto.
 */
export function nextDueOn(project: Pick<PortalProject, "status" | "dueOn" | "tasks">, today: CivilDate): CivilDate | null {
  if (project.status !== "active" && project.status !== "planned") return null;
  const dates = [project.dueOn, ...project.tasks.filter(isOpen).map((task) => task.dueOn)].filter(
    (date): date is CivilDate => date !== null && compareCivil(date, today) >= 0,
  );
  return dates.sort(compareCivil)[0] ?? null;
}

/** Un proyecto tal y como lo ve el cliente. Las tareas llegan ya en el orden del tablero. */
export function toSpaceWorkProject(project: PortalProject, today: CivilDate): SpaceWorkProject {
  const open = project.tasks.filter(isOpen);
  return {
    id: project.id,
    name: project.name,
    kind: project.kind,
    status: project.status,
    progress: projectProgress({ tasksTotal: project.tasks.length, tasksDone: project.tasks.length - open.length, status: project.status }),
    nextDueOn: nextDueOn(project, today),
    nextTasks: open.slice(0, NEXT_TASKS).map((task) => ({ id: task.id, title: task.title, status: task.status })),
    moreOpen: Math.max(0, open.length - NEXT_TASKS),
  };
}

/** Una entrada de «Lo que hemos hecho» con su instante exacto, para mezclar actividades y tareas. */
export type DatedWorkItem = { at: string; item: SpaceWorkItem };

/**
 * Las tareas visibles terminadas en los últimos `days` días (hoy incluido, en la zona de la org).
 * `completedAt` dice cuándo se terminó cada una; solo cuentan las que trae `projects`, que son las
 * que el módulo de proyectos deja ver al cliente.
 */
export function completedTaskItems(
  projects: readonly PortalProject[],
  completedAt: ReadonlyMap<string, string>,
  opts: { today: CivilDate; timeZone: string; days?: number },
): DatedWorkItem[] {
  const days = opts.days ?? DONE_TASK_DAYS;
  return projects.flatMap((project) =>
    project.tasks.flatMap((task): DatedWorkItem[] => {
      const at = task.status === "done" ? completedAt.get(task.id) : undefined;
      if (!at) return [];
      const occurredOn = nowInZone(opts.timeZone, new Date(at)).date;
      const age = daysBetween(occurredOn, opts.today);
      if (age < 0 || age > days) return [];
      return [{ at, item: { id: task.id, kind: "task", title: task.title, body: null, project: project.name, occurredOn } }];
    }),
  );
}

/** Actividades y tareas juntas, lo más reciente primero, hasta `limit`. */
export function mergeWorkLog(entries: readonly DatedWorkItem[], limit: number): SpaceWorkItem[] {
  return entries
    .map((entry) => ({ entry, time: Date.parse(entry.at) }))
    .sort((a, b) => b.time - a.time || a.entry.item.id.localeCompare(b.entry.item.id))
    .slice(0, limit)
    .map(({ entry }) => entry.item);
}
