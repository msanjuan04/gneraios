import "server-only";
import type { CivilDate } from "@/domain/dates/civil-date";
import { type Progress, type ProjectKind, projectProgress, type ProjectStatus, type TaskStatus } from "@/domain/projects";
import { type Db, fetchAll } from "@/server/billing/context";

/**
 * Proyectos para el portal del cliente ("Tu espacio"): solo los que un socio ha marcado como
 * visibles, y de sus tareas solo las marcadas para el cliente. Se lee con la clave de servidor, así
 * que TODO filtra por la org y el cliente del enlace, y solo se seleccionan columnas publicables:
 * nunca horas, notas, dinero, responsables ni tareas internas. Sin promesas: lo que se está haciendo.
 */

export type PortalProjectTask = {
  id: string;
  title: string;
  status: TaskStatus;
  dueOn: CivilDate | null;
};

export type PortalProject = {
  id: string;
  name: string;
  kind: ProjectKind;
  status: ProjectStatus;
  startsOn: CivilDate | null;
  dueOn: CivilDate | null;
  /** Avance real del proyecto (todas sus tareas, también las internas: solo se enseña el número). */
  progress: Progress;
  /** Las tareas visibles para el cliente, en el orden del tablero. */
  tasks: PortalProjectTask[];
};

const STATUS_ORDER: Record<ProjectStatus, number> = { active: 0, planned: 1, paused: 2, done: 3, cancelled: 4 };
const TASK_ORDER: Record<TaskStatus, number> = { doing: 0, review: 1, todo: 2, done: 3 };

export async function getPortalProjects(admin: Db, orgId: string, clientId: string): Promise<PortalProject[]> {
  const { data: projects, error } = await admin
    .from("projects")
    .select("id, name, kind, status, starts_on, due_on")
    .eq("org_id", orgId)
    .eq("client_id", clientId)
    .eq("portal_visible", true)
    .is("archived_at", null)
    .neq("status", "cancelled");
  if (error) throw error;
  if (!projects || projects.length === 0) return [];

  const tasks = await fetchAll<{ id: string; project_id: string; title: string; status: string; due_on: string | null; position: number; client_visible: boolean }>(
    (from, to) =>
      admin
        .from("project_tasks")
        .select("id, project_id, title, status, due_on, position, client_visible")
        .eq("org_id", orgId)
        .in(
          "project_id",
          projects.map((p) => p.id),
        )
        .order("position")
        .order("id")
        .range(from, to),
    "projects.portal.tasks",
  );

  return projects
    .map((project) => {
      const own = tasks.filter((t) => t.project_id === project.id);
      const status = project.status as ProjectStatus;
      return {
        id: project.id,
        name: project.name,
        kind: project.kind as ProjectKind,
        status,
        startsOn: project.starts_on,
        dueOn: project.due_on,
        progress: projectProgress({ tasksTotal: own.length, tasksDone: own.filter((t) => t.status === "done").length, status }),
        tasks: own
          .filter((t) => t.client_visible)
          .map((t) => ({ id: t.id, title: t.title, status: t.status as TaskStatus, dueOn: t.due_on }))
          .sort((a, b) => TASK_ORDER[a.status] - TASK_ORDER[b.status]),
      };
    })
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.name.localeCompare(b.name, "es"));
}
